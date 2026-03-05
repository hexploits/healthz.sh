import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  type CheckConfig,
  type CheckRecord,
  slugify,
  parseTimeout,
} from "@healthz/types";

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    ...(process.env.DYNAMODB_ENDPOINT && {
      endpoint: process.env.DYNAMODB_ENDPOINT,
    }),
  }),
);
const TABLE_NAME = process.env.TABLE_NAME!;
const REGION = process.env.AWS_REGION!;
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || "90", 10);

export async function handler(event: CheckConfig): Promise<void> {
  const checkId = slugify(event.name);
  const timeoutMs = parseTimeout(event.timeout);
  const now = new Date();

  let statusCode = 0;
  let latencyMs = 0;
  let healthy = false;
  let error: string | undefined;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const start = performance.now();
    const res = await fetch(event.url, {
      method: event.method || "GET",
      headers: event.headers,
      signal: controller.signal,
    });
    latencyMs = Math.round(performance.now() - start);
    clearTimeout(timer);

    statusCode = res.status;
    healthy = statusCode === event.expected_status;
  } catch (err: unknown) {
    error = err instanceof Error ? err.message : "Unknown error";
  }

  const record: CheckRecord = {
    checkId,
    sk: `${now.toISOString()}#${REGION}`,
    url: event.url,
    region: REGION,
    statusCode,
    latencyMs,
    healthy,
    ...(error && { error }),
    ttl: Math.floor(now.getTime() / 1000) + RETENTION_DAYS * 86400,
  };

  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: record }));
}

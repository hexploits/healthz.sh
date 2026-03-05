import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";
import { slugify } from "@healthz/types";
import type { HealthzConfig, CheckRecord } from "@healthz/types";

const ENDPOINT = "http://localhost:8000";

const client = new DynamoDBClient({
  endpoint: ENDPOINT,
  region: "us-east-1",
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
});
const ddb = DynamoDBDocumentClient.from(client);

const config: HealthzConfig = yaml.parse(
  fs.readFileSync(path.resolve(__dirname, "../healthz.yaml"), "utf-8"),
);

const TABLE = config.settings.table_name;

const REGION_PROFILES: Record<string, { base: number; jitter: number }> = {
  "us-east-1": { base: 42, jitter: 18 },
  "us-west-2": { base: 68, jitter: 22 },
  "eu-west-1": { base: 115, jitter: 30 },
  "eu-central-1": { base: 105, jitter: 28 },
  "ap-southeast-1": { base: 190, jitter: 40 },
  "ap-northeast-1": { base: 165, jitter: 35 },
};

async function ensureTable() {
  try {
    await client.send(new DescribeTableCommand({ TableName: TABLE }));
    console.log(`Table ${TABLE} exists, dropping...`);
    await client.send(new DeleteTableCommand({ TableName: TABLE }));
    await new Promise((r) => setTimeout(r, 500));
  } catch {
    // table doesn't exist
  }

  await client.send(
    new CreateTableCommand({
      TableName: TABLE,
      KeySchema: [
        { AttributeName: "checkId", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      AttributeDefinitions: [
        { AttributeName: "checkId", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
  console.log(`Created table ${TABLE}`);
}

function generateRecords(): CheckRecord[] {
  const records: CheckRecord[] = [];
  const now = Date.now();
  const intervalMs = 5 * 60 * 1000;
  const points = 288; // 24 hours at 5-minute intervals

  for (const check of config.checks) {
    const checkId = slugify(check.name);

    for (let i = 0; i < points; i++) {
      const timestamp = new Date(now - (points - i) * intervalMs);
      const hour = timestamp.getUTCHours();

      // simulate slightly higher latency during business hours (12-20 UTC)
      const loadFactor = hour >= 12 && hour <= 20 ? 1.3 : 1.0;

      for (const region of config.regions) {
        const profile = REGION_PROFILES[region] || { base: 100, jitter: 30 };
        const baseLatency = profile.base * loadFactor;
        const noise = (Math.random() - 0.5) * 2 * profile.jitter;
        let latencyMs = Math.round(baseLatency + noise);

        // occasional latency spike (~3% chance)
        if (Math.random() < 0.03) {
          latencyMs = Math.round(latencyMs * (2 + Math.random() * 3));
        }

        // occasional failure (~1.5% chance)
        const isError = Math.random() < 0.015;

        records.push({
          checkId,
          sk: `${timestamp.toISOString()}#${region}`,
          url: check.url,
          region,
          statusCode: isError ? (Math.random() < 0.5 ? 500 : 503) : 200,
          latencyMs: isError ? 0 : Math.max(1, latencyMs),
          healthy: !isError,
          ...(isError && {
            error:
              Math.random() < 0.5
                ? "Internal Server Error"
                : "Service Unavailable",
          }),
          ttl: Math.floor(timestamp.getTime() / 1000) + 90 * 86400,
        });
      }
    }
  }

  return records;
}

async function batchWrite(records: CheckRecord[]) {
  // DynamoDB BatchWrite limit is 25 items
  for (let i = 0; i < records.length; i += 25) {
    const batch = records.slice(i, i + 25);
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE]: batch.map((item) => ({ PutRequest: { Item: item } })),
        },
      }),
    );
  }
}

async function main() {
  await ensureTable();

  const records = generateRecords();
  console.log(`Generated ${records.length} records, writing...`);

  await batchWrite(records);

  const checksCount = config.checks.length;
  const regionsCount = config.regions.length;
  console.log(
    `Seeded ${records.length} records (${checksCount} checks x ${regionsCount} regions x 288 points)`,
  );
}

main().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});

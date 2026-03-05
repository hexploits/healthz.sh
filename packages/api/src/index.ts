import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { type CheckConfig, type CheckRecord, slugify } from "@healthz/types";

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    ...(process.env.DYNAMODB_ENDPOINT && {
      endpoint: process.env.DYNAMODB_ENDPOINT,
    }),
  }),
);
const TABLE_NAME = process.env.TABLE_NAME!;
const CHECK_CONFIGS: CheckConfig[] = JSON.parse(
  process.env.CHECK_CONFIGS || "[]",
);

function json(body: unknown, status = 200): APIGatewayProxyResult {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function queryRecords(
  checkId: string,
  from?: string,
  to?: string,
): Promise<CheckRecord[]> {
  const expressionValues: Record<string, string> = { ":id": checkId };
  let keyCondition = "checkId = :id";

  if (from && to) {
    keyCondition += " AND sk BETWEEN :from AND :to";
    expressionValues[":from"] = from;
    expressionValues[":to"] = to;
  } else if (from) {
    keyCondition += " AND sk >= :from";
    expressionValues[":from"] = from;
  }

  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: keyCondition,
      ExpressionAttributeValues: expressionValues,
      ScanIndexForward: false,
    }),
  );

  return (result.Items || []) as CheckRecord[];
}

function periodToMs(period: string): number {
  const map: Record<string, number> = {
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "14d": 14 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "90d": 90 * 24 * 60 * 60 * 1000,
    "180d": 180 * 24 * 60 * 60 * 1000,
  };
  return map[period] || map["24h"];
}

async function getChecks(): Promise<APIGatewayProxyResult> {
  const checks = await Promise.all(
    CHECK_CONFIGS.map(async (cfg) => {
      const checkId = slugify(cfg.name);
      const records = await queryRecords(checkId);

      const regionMap = new Map<string, CheckRecord>();
      for (const rec of records) {
        if (!regionMap.has(rec.region)) {
          regionMap.set(rec.region, rec);
        }
      }

      return {
        checkId,
        name: cfg.name,
        url: cfg.url,
        regions: Array.from(regionMap.values()).map((r) => ({
          region: r.region,
          healthy: r.healthy,
          statusCode: r.statusCode,
          latencyMs: r.latencyMs,
          lastChecked: r.sk.split("#")[0],
        })),
      };
    }),
  );

  return json({ checks });
}

async function getHistory(
  checkId: string,
  params: Record<string, string | undefined> | null,
): Promise<APIGatewayProxyResult> {
  const from = params?.from;
  const to = params?.to;
  const region = params?.region;

  let records = await queryRecords(checkId, from, to);
  if (region) {
    records = records.filter((r) => r.region === region);
  }

  return json({ checkId, records });
}

async function getUptime(
  checkId: string,
  params: Record<string, string | undefined> | null,
): Promise<APIGatewayProxyResult> {
  const period = params?.period || "24h";
  const from = new Date(Date.now() - periodToMs(period)).toISOString();
  const records = await queryRecords(checkId, from);

  const total = records.length;
  const healthy = records.filter((r) => r.healthy).length;

  return json({
    checkId,
    period,
    uptimePercent:
      total > 0 ? Math.round((healthy / total) * 10000) / 100 : 0,
    totalChecks: total,
    healthyChecks: healthy,
  });
}

async function getOverview(): Promise<APIGatewayProxyResult> {
  const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const checks = await Promise.all(
    CHECK_CONFIGS.map(async (cfg) => {
      const checkId = slugify(cfg.name);
      const records = await queryRecords(checkId, from);

      const regionMap = new Map<string, CheckRecord>();
      for (const rec of records) {
        if (!regionMap.has(rec.region)) {
          regionMap.set(rec.region, rec);
        }
      }

      const total = records.length;
      const healthy = records.filter((r) => r.healthy).length;

      return {
        checkId,
        name: cfg.name,
        url: cfg.url,
        regions: Array.from(regionMap.values()).map((r) => ({
          region: r.region,
          healthy: r.healthy,
          statusCode: r.statusCode,
          latencyMs: r.latencyMs,
          lastChecked: r.sk.split("#")[0],
        })),
        uptimePercent:
          total > 0 ? Math.round((healthy / total) * 10000) / 100 : 0,
      };
    }),
  );

  return json({ checks });
}

async function getAggregate(
  params: Record<string, string | undefined> | null,
): Promise<APIGatewayProxyResult> {
  const chartPeriod = params?.period || "24h";
  const now = Date.now();
  const periods = ["24h", "7d", "14d", "30d", "90d", "180d"] as const;
  const periodBoundaries = periods.map((p) => ({
    period: p,
    from: new Date(now - periodToMs(p)).toISOString(),
  }));

  // Query the longest period once per check — shorter periods are subsets
  const longestFrom = periodBoundaries[periodBoundaries.length - 1].from;

  const allRecords: CheckRecord[] = [];
  await Promise.all(
    CHECK_CONFIGS.map(async (cfg) => {
      const records = await queryRecords(slugify(cfg.name), longestFrom);
      allRecords.push(...records);
    }),
  );

  const uptimes = periodBoundaries.map(({ period, from }) => {
    const periodRecords = allRecords.filter((r) => r.sk >= from);
    const total = periodRecords.length;
    const healthy = periodRecords.filter((r) => r.healthy).length;
    return {
      period,
      uptimePercent:
        total > 0 ? Math.round((healthy / total) * 10000) / 100 : 0,
      totalChecks: total,
      healthyChecks: healthy,
    };
  });

  const chartFrom = new Date(now - periodToMs(chartPeriod)).toISOString();
  const recentRecords = allRecords
    .filter((r) => r.sk >= chartFrom)
    .sort((a, b) => a.sk.localeCompare(b.sk));

  return json({ uptimes, recentRecords });
}

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const { path, httpMethod } = event;

  if (httpMethod !== "GET") return json({ error: "Method not allowed" }, 405);
  if (path === "/api/aggregate") return getAggregate(event.queryStringParameters);
  if (path === "/api/overview") return getOverview();
  if (path === "/api/checks") return getChecks();

  const historyMatch = path.match(/^\/api\/checks\/([^/]+)\/history$/);
  if (historyMatch)
    return getHistory(historyMatch[1], event.queryStringParameters);

  const uptimeMatch = path.match(/^\/api\/checks\/([^/]+)\/uptime$/);
  if (uptimeMatch)
    return getUptime(uptimeMatch[1], event.queryStringParameters);

  return json({ error: "Not found" }, 404);
}

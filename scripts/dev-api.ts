import http from "http";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";
import type { HealthzConfig } from "@healthz/types";

const config: HealthzConfig = yaml.parse(
  fs.readFileSync(path.resolve(__dirname, "../healthz.yaml"), "utf-8"),
);

// Set env vars BEFORE importing the API handler (it reads them at module scope)
process.env.DYNAMODB_ENDPOINT = "http://localhost:8000";
process.env.AWS_REGION = "us-east-1";
process.env.AWS_ACCESS_KEY_ID = "local";
process.env.AWS_SECRET_ACCESS_KEY = "local";
process.env.TABLE_NAME = config.settings.table_name;
process.env.CHECK_CONFIGS = JSON.stringify(config.checks);

async function start() {
  const { handler } = await import("../packages/api/src/index.js");

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost:3001");

    const event = {
      path: url.pathname,
      httpMethod: req.method || "GET",
      queryStringParameters: Object.fromEntries(url.searchParams),
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k, String(v)]),
      ),
      body: null,
      isBase64Encoded: false,
    };

    try {
      const result = await handler(event as any);
      res.writeHead(result.statusCode, result.headers as any);
      res.end(result.body);
    } catch (err) {
      console.error("Handler error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
  });

  server.listen(3001, () => {
    console.log("API server running on http://localhost:3001");
  });
}

start().catch((err) => {
  console.error("Failed to start API server:", err);
  process.exit(1);
});

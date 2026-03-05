export interface CheckConfig {
  name: string;
  url: string;
  interval: string;
  timeout: string;
  expected_status: number;
  method?: string;
  headers?: Record<string, string>;
}

export interface HealthzConfig {
  checks: CheckConfig[];
  regions: string[];
  settings: {
    primary_region: string;
    retention_days: number;
    table_name: string;
  };
  domain?: {
    names: string[];
    certificate_arn?: string;
    hosted_zone_id?: string;
    zone_name?: string;
  };
}

export interface CheckRecord {
  checkId: string;
  sk: string;
  url: string;
  region: string;
  statusCode: number;
  latencyMs: number;
  healthy: boolean;
  error?: string;
  ttl: number;
}

export interface RegionStatus {
  region: string;
  healthy: boolean;
  statusCode: number;
  latencyMs: number;
  lastChecked: string;
}

export interface CheckStatus {
  checkId: string;
  name: string;
  url: string;
  regions: RegionStatus[];
}

export interface CheckHistoryResponse {
  checkId: string;
  records: CheckRecord[];
}

export interface UptimeResponse {
  checkId: string;
  period: string;
  uptimePercent: number;
  totalChecks: number;
  healthyChecks: number;
}

export interface OverviewCheck extends CheckStatus {
  uptimePercent: number;
}

export interface OverviewResponse {
  checks: OverviewCheck[];
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function parseInterval(interval: string): number {
  const match = interval.match(/^(\d+)(m|h|s)$/);
  if (!match) return 300;
  const [, val, unit] = match;
  const n = parseInt(val, 10);
  if (unit === "h") return n * 3600;
  if (unit === "m") return n * 60;
  return n;
}

export function parseTimeout(timeout: string): number {
  const match = timeout.match(/^(\d+)(s|ms)$/);
  if (!match) return 10000;
  const [, val, unit] = match;
  return unit === "s" ? parseInt(val, 10) * 1000 : parseInt(val, 10);
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface RegionStatus {
  region: string;
  healthy: boolean;
  statusCode: number;
  latencyMs: number;
  lastChecked: string;
}

interface OverviewCheck {
  checkId: string;
  name: string;
  url: string;
  regions: RegionStatus[];
  uptimePercent: number;
}

interface UptimeData {
  period: string;
  uptimePercent: number;
  totalChecks: number;
  healthyChecks: number;
}

interface CheckRecord {
  checkId: string;
  sk: string;
  url: string;
  region: string;
  statusCode: number;
  latencyMs: number;
  healthy: boolean;
}

interface AggregateData {
  uptimes: UptimeData[];
  recentRecords: CheckRecord[];
}

const CHART_PERIODS = ["24h", "7d", "14d", "30d", "90d", "180d", "365d"] as const;

type HealthStatus = "ok" | "degraded" | "down";

interface BucketStats {
  latencies: number[];
  healthy: number;
  total: number;
}

import { regionLabel, getColor } from "./regions";

const STATUS_COLORS: Record<HealthStatus, string> = {
  ok: "#4ade80",
  degraded: "#fb923c",
  down: "#f87171",
};

function uptimeColor(pct: number): string {
  if (pct >= 99.9) return "text-green-400";
  if (pct >= 99) return "text-yellow-400";
  return "text-red-400";
}

function getOverallStatus(
  checks: OverviewCheck[],
): { label: string; color: string; dotClass: string } {
  const allRegions = checks.flatMap((c) => c.regions);
  const totalRegions = allRegions.length;
  const healthyRegions = allRegions.filter((r) => r.healthy).length;
  const avgUptime =
    checks.length > 0
      ? checks.reduce((a, c) => a + c.uptimePercent, 0) / checks.length
      : 100;

  if (totalRegions === 0) {
    return { label: "No Data", color: "text-gray-500", dotClass: "bg-gray-400" };
  }
  if (healthyRegions === totalRegions && avgUptime >= 99.9) {
    return { label: "All Systems Operational", color: "text-green-600 dark:text-green-400", dotClass: "bg-green-400" };
  }
  if (healthyRegions === 0) {
    return { label: "Major Outage", color: "text-red-600 dark:text-red-400", dotClass: "bg-red-400" };
  }
  if (healthyRegions < totalRegions * 0.5 || avgUptime < 95) {
    return { label: "Partial Outage", color: "text-red-600 dark:text-red-400", dotClass: "bg-red-400" };
  }
  if (avgUptime < 99.9) {
    return { label: "Degraded Performance", color: "text-yellow-600 dark:text-yellow-400", dotClass: "bg-yellow-400" };
  }
  return { label: "All Systems Operational", color: "text-green-600 dark:text-green-400", dotClass: "bg-green-400" };
}

function getBucketMinutes(period: string): number {
  const map: Record<string, number> = {
    "24h": 30,
    "7d": 180,
    "14d": 360,
    "30d": 720,
    "90d": 1440,
    "180d": 2880,
    "365d": 5760,
  };
  return map[period] || 30;
}

function bucketRecords(records: CheckRecord[], period = "24h") {
  const buckets = new Map<string, Map<string, BucketStats>>();
  const bucketMs = getBucketMinutes(period) * 60 * 1000;

  for (const rec of records) {
    const ts = new Date(rec.sk.split("#")[0]).getTime();
    const bucketed = new Date(Math.floor(ts / bucketMs) * bucketMs);
    const key = bucketed.toISOString();

    if (!buckets.has(key)) buckets.set(key, new Map());
    const regionMap = buckets.get(key)!;
    if (!regionMap.has(rec.region)) {
      regionMap.set(rec.region, { latencies: [], healthy: 0, total: 0 });
    }
    const stats = regionMap.get(rec.region)!;
    stats.total++;
    if (rec.healthy) {
      stats.healthy++;
      stats.latencies.push(rec.latencyMs);
    }
  }

  return buckets;
}

function computeMedianLatency(
  records: CheckRecord[],
  region: string,
): number {
  const values = records
    .filter((r) => r.region === region && r.healthy)
    .map((r) => r.latencyMs)
    .sort((a, b) => a - b);
  if (values.length === 0) return 100;
  return values[Math.floor(values.length / 2)];
}

function getHealthStatus(
  stats: BucketStats,
  medianLatency: number,
): HealthStatus {
  if (stats.healthy < stats.total) return "down";
  const avgLatency =
    stats.latencies.length > 0
      ? stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length
      : 0;
  if (avgLatency > medianLatency * 2.5) return "degraded";
  return "ok";
}

function buildLatencyChartData(
  buckets: Map<string, Map<string, BucketStats>>,
) {
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, regionMap]) => {
      const entry: Record<string, string | number> = { time };
      for (const [region, stats] of regionMap) {
        if (stats.latencies.length > 0) {
          entry[region] = Math.round(
            stats.latencies.reduce((a, b) => a + b, 0) /
              stats.latencies.length,
          );
        }
      }
      return entry;
    });
}

function buildHealthData(
  records: CheckRecord[],
  regions: string[],
  buckets: Map<string, Map<string, BucketStats>>,
) {
  const sortedTimes = Array.from(buckets.keys()).sort();
  const medians = new Map<string, number>();
  for (const region of regions) {
    medians.set(region, computeMedianLatency(records, region));
  }

  return {
    sortedTimes,
    medians,
    getStatus(time: string, region: string): HealthStatus {
      const stats = buckets.get(time)?.get(region);
      if (!stats) return "ok";
      return getHealthStatus(stats, medians.get(region)!);
    },
  };
}

function StatusPanel({
  records,
  regions,
  buckets,
  chartData,
  chartPeriod,
  onPeriodChange,
  title,
  subtitle,
}: {
  records: CheckRecord[];
  regions: string[];
  buckets: Map<string, Map<string, BucketStats>>;
  chartData: Record<string, string | number>[];
  chartPeriod: string;
  onPeriodChange: (period: string) => void;
  title?: string;
  subtitle?: string;
}) {
  const health = buildHealthData(records, regions, buckets);

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden mb-8">
      <div className="px-5 pt-5 pb-2 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold mb-1">
            {title || "Latency by Location"}
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            {subtitle || "Response times as seen from each monitoring location"}
          </p>
        </div>
        <select
          value={chartPeriod}
          onChange={(e) => onPeriodChange(e.target.value)}
          className="text-sm bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 text-gray-700 dark:text-gray-300 cursor-pointer"
        >
          {CHART_PERIODS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <div className="px-2">
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart
            data={chartData}
            margin={{ top: 0, right: 12, left: 0, bottom: 0 }}
          >
            <defs>
              {regions.map((region) => (
                <linearGradient
                  key={region}
                  id={`grad-${region}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor={getColor(region)}
                    stopOpacity={0.25}
                  />
                  <stop
                    offset="100%"
                    stopColor={getColor(region)}
                    stopOpacity={0}
                  />
                </linearGradient>
              ))}
            </defs>
            <XAxis
              dataKey="time"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--chart-tick)", fontSize: 10 }}
              tickFormatter={(t: string) => {
                const d = new Date(t);
                if (chartPeriod === "24h") {
                  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                }
                return d.toLocaleDateString([], { month: "short", day: "numeric" });
              }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--chart-tick)", fontSize: 10 }}
              tickFormatter={(v: number) => `${v}ms`}
              width={48}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--chart-tooltip-bg)",
                border: "1px solid var(--chart-tooltip-border)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--chart-tooltip-text)",
              }}
              labelFormatter={(l: string) => new Date(l).toLocaleString()}
              formatter={(value: number, name: string) => [
                `${value}ms`,
                regionLabel(name),
              ]}
            />
            {regions.map((region) => (
              <Area
                key={region}
                type="monotone"
                dataKey={region}
                name={region}
                stroke={getColor(region)}
                fill={`url(#grad-${region})`}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0 }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Health strips */}
      <div className="px-5 pb-5 pt-3 space-y-2">
        {regions.map((region) => (
          <div key={region} className="flex items-center gap-3">
            <span className="text-xs text-gray-500 dark:text-gray-400 w-28 shrink-0 truncate">
              {regionLabel(region)}
            </span>
            <div className="flex flex-1 gap-px h-5 items-stretch">
              {health.sortedTimes.map((time) => {
                const status = health.getStatus(time, region);
                return (
                  <div
                    key={time}
                    className="flex-1 rounded-[2px] min-w-[2px] transition-opacity hover:opacity-80"
                    style={{
                      backgroundColor: STATUS_COLORS[status],
                      opacity: status === "ok" ? 0.4 : 1,
                    }}
                    title={`${regionLabel(region)} - ${new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} - ${
                      status === "ok"
                        ? "Healthy"
                        : status === "degraded"
                          ? "High latency"
                          : "Unreachable"
                    }`}
                  />
                );
              })}
            </div>
          </div>
        ))}

        <div className="flex items-center gap-3 pt-1">
          <span className="w-28 shrink-0" />
          <div className="flex-1 flex justify-between text-[10px] text-gray-400 dark:text-gray-600">
            <span>
              {health.sortedTimes.length > 0 &&
                new Date(health.sortedTimes[0]).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
            </span>
            <span>
              {health.sortedTimes.length > 0 &&
                new Date(
                  health.sortedTimes[health.sortedTimes.length - 1],
                ).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-5 pt-2 border-t border-gray-200 dark:border-gray-800">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {regions.map((region) => (
              <span
                key={region}
                className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400"
              >
                <span
                  className="inline-block w-2.5 h-[3px] rounded-full"
                  style={{ backgroundColor: getColor(region) }}
                />
                {regionLabel(region)}
              </span>
            ))}
          </div>
          <span className="text-gray-300 dark:text-gray-700 text-xs">|</span>
          <div className="flex gap-3">
            {(
              [
                ["ok", "Healthy"],
                ["degraded", "High Latency"],
                ["down", "Unreachable"],
              ] as const
            ).map(([status, label]) => (
              <span
                key={status}
                className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400"
              >
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{
                    backgroundColor: STATUS_COLORS[status],
                    opacity: status === "ok" ? 0.4 : 1,
                  }}
                />
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function OverviewPage() {
  const [checks, setChecks] = useState<OverviewCheck[]>([]);
  const [aggregate, setAggregate] = useState<AggregateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartPeriod, setChartPeriod] = useState<string>("24h");

  useEffect(() => {
    Promise.all([
      fetch("/api/overview").then((r) => r.json()),
      fetch(`/api/aggregate?period=${chartPeriod}`).then((r) => r.json()),
    ])
      .then(([overviewData, aggregateData]) => {
        setChecks(overviewData.checks || []);
        setAggregate(aggregateData);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [chartPeriod]);

  if (loading) {
    return <p className="text-gray-500 dark:text-gray-400">Loading...</p>;
  }

  if (checks.length === 0) {
    return <p className="text-gray-500 dark:text-gray-400">No checks configured.</p>;
  }

  const status = getOverallStatus(checks);
  const regions = aggregate
    ? [...new Set(aggregate.recentRecords.map((r) => r.region))]
    : [];
  const buckets = aggregate
    ? bucketRecords(aggregate.recentRecords, chartPeriod)
    : new Map();
  const chartData = buildLatencyChartData(buckets);

  return (
    <div>
      {/* Status badge in header area */}
      <div className="flex items-center justify-between mb-6">
        <div />
        <div className="flex items-center gap-2">
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full animate-pulse-dot ${status.dotClass}`}
          />
          <span className={`text-sm font-medium ${status.color}`}>
            {status.label}
          </span>
        </div>
      </div>

      {/* Aggregate uptime cards */}
      {aggregate && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 sm:gap-4 mb-6">
          {aggregate.uptimes.map((u) => (
            <div
              key={u.period}
              className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-3 sm:p-4 text-center"
            >
              <p className="text-[10px] sm:text-xs text-gray-500 uppercase mb-1">
                {u.period} uptime
              </p>
              <p
                className={`text-xl sm:text-2xl font-bold font-mono ${uptimeColor(u.uptimePercent)}`}
              >
                {u.uptimePercent.toFixed(2)}%
              </p>
              <p className="text-[10px] sm:text-xs text-gray-400 dark:text-gray-600 mt-1">
                {u.healthyChecks}/{u.totalChecks}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Consolidated chart panel */}
      {aggregate && chartData.length > 0 && (
        <StatusPanel
          records={aggregate.recentRecords}
          regions={regions}
          buckets={buckets}
          chartData={chartData}
          chartPeriod={chartPeriod}
          onPeriodChange={setChartPeriod}
        />
      )}

      {/* Per-check grid */}
      <h2 className="text-lg font-semibold mb-4">Services</h2>
      <div className="grid gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {checks.map((check) => {
          const checkHealthy =
            check.regions.length > 0 &&
            check.regions.every((r) => r.healthy);
          return (
            <Link
              key={check.checkId}
              href={`/checks/${check.checkId}`}
              className="block bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 sm:p-5 hover:border-gray-300 dark:hover:border-gray-700 transition-colors"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block w-2.5 h-2.5 rounded-full ${
                      checkHealthy ? "bg-green-400" : "bg-red-400"
                    }`}
                  />
                  <h3 className="font-semibold">{check.name}</h3>
                </div>
                <span
                  className={`text-sm font-mono ${uptimeColor(check.uptimePercent)}`}
                >
                  {check.uptimePercent.toFixed(2)}%
                </span>
              </div>


              <div className="flex gap-1.5 flex-wrap">
                {check.regions.map((r) => (
                  <span
                    key={r.region}
                    className={`text-xs px-1.5 py-0.5 rounded ${
                      r.healthy
                        ? "bg-green-400/10 text-green-600 dark:text-green-400"
                        : "bg-red-400/10 text-red-600 dark:text-red-400"
                    }`}
                  >
                    {regionLabel(r.region)} &middot; {r.latencyMs}ms
                  </span>
                ))}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

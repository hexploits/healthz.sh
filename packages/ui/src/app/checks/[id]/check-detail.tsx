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

interface CheckRecord {
  checkId: string;
  sk: string;
  url: string;
  region: string;
  statusCode: number;
  latencyMs: number;
  healthy: boolean;
  error?: string;
}

interface UptimeData {
  period: string;
  uptimePercent: number;
  totalChecks: number;
  healthyChecks: number;
}

type HealthStatus = "ok" | "degraded" | "down";

interface BucketStats {
  latencies: number[];
  healthy: number;
  total: number;
}

import { regionLabel, getColor } from "../../regions";

const STATUS_COLORS: Record<HealthStatus, string> = {
  ok: "#4ade80",
  degraded: "#fb923c",
  down: "#f87171",
};

const PERIODS = ["24h", "7d", "14d", "30d", "90d", "180d"] as const;

const PERIOD_MS: Record<string, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "14d": 14 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
  "180d": 180 * 24 * 60 * 60 * 1000,
};

function getBucketMinutes(period: string): number {
  const map: Record<string, number> = {
    "24h": 30, "7d": 180, "14d": 360, "30d": 720, "90d": 1440, "180d": 2880,
  };
  return map[period] || 30;
}

function bucketRecords(records: CheckRecord[], period: string) {
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

function computeMedianLatency(records: CheckRecord[], region: string): number {
  const values = records
    .filter((r) => r.region === region && r.healthy)
    .map((r) => r.latencyMs)
    .sort((a, b) => a - b);
  if (values.length === 0) return 100;
  return values[Math.floor(values.length / 2)];
}

function getHealthStatus(stats: BucketStats, medianLatency: number): HealthStatus {
  if (stats.healthy < stats.total) return "down";
  const avgLatency =
    stats.latencies.length > 0
      ? stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length
      : 0;
  if (avgLatency > medianLatency * 2.5) return "degraded";
  return "ok";
}

function buildLatencyChartData(buckets: Map<string, Map<string, BucketStats>>) {
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, regionMap]) => {
      const entry: Record<string, string | number> = { time };
      for (const [region, stats] of regionMap) {
        if (stats.latencies.length > 0) {
          entry[region] = Math.round(
            stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length,
          );
        }
      }
      return entry;
    });
}

export default function CheckDetail({ id }: { id: string }) {
  const [records, setRecords] = useState<CheckRecord[]>([]);
  const [uptimes, setUptimes] = useState<UptimeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartPeriod, setChartPeriod] = useState<string>("24h");

  useEffect(() => {
    const from = new Date(Date.now() - (PERIOD_MS[chartPeriod] || PERIOD_MS["24h"])).toISOString();

    Promise.all([
      fetch(`/api/checks/${id}/history?from=${from}`).then((r) => r.json()),
      ...PERIODS.map((p) =>
        fetch(`/api/checks/${id}/uptime?period=${p}`).then((r) => r.json()),
      ),
    ])
      .then(([historyData, ...uptimeData]) => {
        setRecords(historyData.records || []);
        setUptimes(uptimeData);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id, chartPeriod]);

  if (loading)
    return <p className="text-gray-500 dark:text-gray-400">Loading...</p>;

  const regions = [...new Set(records.map((r) => r.region))];
  const buckets = bucketRecords(records, chartPeriod);
  const chartData = buildLatencyChartData(buckets);

  const sortedTimes = Array.from(buckets.keys()).sort();
  const medians = new Map<string, number>();
  for (const region of regions) {
    medians.set(region, computeMedianLatency(records, region));
  }

  return (
    <div>
      <Link
        href="/"
        className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 mb-4 inline-block"
      >
        &larr; Back to overview
      </Link>

      <h1 className="text-2xl font-bold mb-6">{id}</h1>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        {uptimes.map((u) => (
          <div
            key={u.period}
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 text-center"
          >
            <p className="text-xs text-gray-500 uppercase mb-1">
              {u.period} uptime
            </p>
            <p
              className={`text-2xl font-bold font-mono ${
                u.uptimePercent >= 99.9
                  ? "text-green-400"
                  : u.uptimePercent >= 99
                    ? "text-yellow-400"
                    : "text-red-400"
              }`}
            >
              {u.uptimePercent.toFixed(2)}%
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-600 mt-1">
              {u.healthyChecks}/{u.totalChecks} checks
            </p>
          </div>
        ))}
      </div>

      {/* Latency + health chart */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden mb-8">
        <div className="px-5 pt-5 pb-2 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold mb-1">Latency by Location</h2>
            <p className="text-xs text-gray-500 mb-4">
              Response times as seen from each monitoring location
            </p>
          </div>
          <select
            value={chartPeriod}
            onChange={(e) => setChartPeriod(e.target.value)}
            className="text-sm bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 text-gray-700 dark:text-gray-300 cursor-pointer"
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div className="px-2">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={chartData} margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  {regions.map((region) => (
                    <linearGradient
                      key={region}
                      id={`detail-grad-${region}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor={getColor(region)} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={getColor(region)} stopOpacity={0} />
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
                    fill={`url(#detail-grad-${region})`}
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={{ r: 3, strokeWidth: 0 }}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-gray-500 text-sm px-3 pb-4">No data available yet.</p>
          )}
        </div>

        {/* Health strips */}
        <div className="px-5 pb-5 pt-3 space-y-2">
          {regions.map((region) => (
            <div key={region} className="flex items-center gap-3">
              <span className="text-xs text-gray-500 dark:text-gray-400 w-28 shrink-0 truncate">
                {regionLabel(region)}
              </span>
              <div className="flex flex-1 gap-px h-5 items-stretch">
                {sortedTimes.map((time) => {
                  const stats = buckets.get(time)?.get(region);
                  const status: HealthStatus = stats
                    ? getHealthStatus(stats, medians.get(region)!)
                    : "ok";
                  return (
                    <div
                      key={time}
                      className="flex-1 rounded-[2px] min-w-[2px] transition-opacity hover:opacity-80"
                      style={{
                        backgroundColor: STATUS_COLORS[status],
                        opacity: status === "ok" ? 0.4 : 1,
                      }}
                      title={`${regionLabel(region)} - ${new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} - ${
                        status === "ok" ? "Healthy" : status === "degraded" ? "High latency" : "Unreachable"
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
                {sortedTimes.length > 0 &&
                  new Date(sortedTimes[0]).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
              <span>
                {sortedTimes.length > 0 &&
                  new Date(sortedTimes[sortedTimes.length - 1]).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-5 pt-2 border-t border-gray-200 dark:border-gray-800">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {regions.map((region) => (
                <span key={region} className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                  <span className="inline-block w-2.5 h-[3px] rounded-full" style={{ backgroundColor: getColor(region) }} />
                  {regionLabel(region)}
                </span>
              ))}
            </div>
            <span className="text-gray-300 dark:text-gray-700 text-xs">|</span>
            <div className="flex gap-3">
              {([["ok", "Healthy"], ["degraded", "High Latency"], ["down", "Unreachable"]] as const).map(
                ([status, label]) => (
                  <span key={status} className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-sm"
                      style={{ backgroundColor: STATUS_COLORS[status], opacity: status === "ok" ? 0.4 : 1 }}
                    />
                    {label}
                  </span>
                ),
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Recent checks table */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
        <h2 className="text-lg font-semibold p-5 pb-3">Recent Checks</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-t border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400">
                <th className="text-left px-5 py-2 font-medium">Time</th>
                <th className="text-left px-5 py-2 font-medium">Location</th>
                <th className="text-left px-5 py-2 font-medium">Status</th>
                <th className="text-right px-5 py-2 font-medium">Latency</th>
                <th className="text-left px-5 py-2 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {records.slice(0, 100).map((rec, i) => (
                <tr
                  key={i}
                  className="border-t border-gray-100 dark:border-gray-800/50"
                >
                  <td className="px-5 py-2 text-gray-700 dark:text-gray-300 font-mono text-xs">
                    {new Date(rec.sk.split("#")[0]).toLocaleString()}
                  </td>
                  <td className="px-5 py-2 text-gray-700 dark:text-gray-300">
                    {regionLabel(rec.region)}
                  </td>
                  <td className="px-5 py-2">
                    <span
                      className={`inline-flex items-center gap-1.5 ${
                        rec.healthy
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          rec.healthy ? "bg-green-400" : "bg-red-400"
                        }`}
                      />
                      {rec.statusCode || "ERR"}
                    </span>
                  </td>
                  <td className="px-5 py-2 text-right font-mono text-gray-700 dark:text-gray-300">
                    {rec.latencyMs}ms
                  </td>
                  <td className="px-5 py-2 text-red-500 dark:text-red-400 text-xs truncate max-w-xs">
                    {rec.error || ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

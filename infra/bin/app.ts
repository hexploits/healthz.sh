#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";
import type { HealthzConfig } from "@healthz/types";
import { GlobalTableStack } from "../lib/global-table-stack";
import { CheckerStack } from "../lib/checker-stack";
import { DashboardStack } from "../lib/dashboard-stack";

const config: HealthzConfig = yaml.parse(
  fs.readFileSync(path.resolve(__dirname, "../../healthz.yaml"), "utf-8"),
);

const app = new cdk.App();

new GlobalTableStack(app, "HealthzGlobalTable", {
  env: { region: config.settings.primary_region },
  config,
});

for (const region of config.regions) {
  new CheckerStack(app, `HealthzChecker-${region}`, {
    env: { region },
    config,
    tableName: config.settings.table_name,
  });
}

new DashboardStack(app, "HealthzDashboard", {
  env: { region: config.settings.primary_region },
  config,
  tableName: config.settings.table_name,
});

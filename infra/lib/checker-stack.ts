import * as cdk from "aws-cdk-lib";
import * as nodeLambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";
import * as path from "path";
import {
  type HealthzConfig,
  slugify,
  parseInterval,
} from "@healthz/types";

interface CheckerStackProps extends cdk.StackProps {
  config: HealthzConfig;
  tableName: string;
}

export class CheckerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CheckerStackProps) {
    super(scope, id, props);

    const { config, tableName } = props;

    const fn = new nodeLambda.NodejsFunction(this, "CheckerFn", {
      entry: path.join(__dirname, "../../packages/checker/src/index.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        TABLE_NAME: tableName,
        RETENTION_DAYS: String(config.settings.retention_days),
      },
      bundling: {
        minify: true,
        sourceMap: false,
        target: "node22",
      },
      logGroup: new logs.LogGroup(this, "CheckerLogs", {
        retention: logs.RetentionDays.ONE_DAY,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:PutItem"],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${tableName}`,
        ],
      }),
    );

    for (const check of config.checks) {
      const intervalSeconds = parseInterval(check.interval);
      const intervalMinutes = Math.max(1, Math.floor(intervalSeconds / 60));
      const slug = slugify(check.name);

      new events.Rule(this, `Rule-${slug}`, {
        schedule: events.Schedule.rate(
          cdk.Duration.minutes(intervalMinutes),
        ),
        targets: [
          new targets.LambdaFunction(fn, {
            event: events.RuleTargetInput.fromObject(check),
          }),
        ],
      });
    }
  }
}

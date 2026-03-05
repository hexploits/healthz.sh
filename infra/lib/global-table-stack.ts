import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import type { Construct } from "constructs";
import type { HealthzConfig } from "@healthz/types";

interface GlobalTableStackProps extends cdk.StackProps {
  config: HealthzConfig;
}

export class GlobalTableStack extends cdk.Stack {
  public readonly table: dynamodb.TableV2;

  constructor(scope: Construct, id: string, props: GlobalTableStackProps) {
    super(scope, id, props);

    const { config } = props;
    const replicaRegions = config.regions
      .filter((r) => r !== config.settings.primary_region)
      .map((region) => ({ region }));

    this.table = new dynamodb.TableV2(this, "HealthzTable", {
      tableName: config.settings.table_name,
      partitionKey: {
        name: "checkId",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      timeToLiveAttribute: "ttl",
      replicas: replicaRegions,
    });
  }
}

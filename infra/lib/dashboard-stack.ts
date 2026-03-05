import * as cdk from "aws-cdk-lib";
import * as nodeLambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";
import * as path from "path";
import type { HealthzConfig } from "@healthz/types";

interface DashboardStackProps extends cdk.StackProps {
  config: HealthzConfig;
  tableName: string;
}

export class DashboardStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DashboardStackProps) {
    super(scope, id, props);

    const { config, tableName } = props;

    const apiFn = new nodeLambda.NodejsFunction(this, "ApiFn", {
      entry: path.join(__dirname, "../../packages/api/src/index.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        TABLE_NAME: tableName,
        CHECK_CONFIGS: JSON.stringify(config.checks),
      },
      bundling: {
        minify: true,
        sourceMap: false,
        target: "node22",
      },
      logGroup: new logs.LogGroup(this, "ApiLogs", {
        retention: logs.RetentionDays.ONE_DAY,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:Query", "dynamodb:Scan"],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${tableName}`,
        ],
      }),
    );

    const api = new apigateway.LambdaRestApi(this, "HealthzApi", {
      handler: apiFn,
      proxy: true,
      cloudWatchRole: false,
      deployOptions: {
        loggingLevel: apigateway.MethodLoggingLevel.OFF,
      },
    });

    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const domainConfig = config.domain;
    let certificate: acm.ICertificate | undefined;
    let hostedZone: route53.IHostedZone | undefined;

    if (domainConfig?.hosted_zone_id && domainConfig.zone_name) {
      // Route53 path: create cert and auto-validate
      hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
        hostedZoneId: domainConfig.hosted_zone_id,
        zoneName: domainConfig.zone_name,
      });
      certificate = new acm.DnsValidatedCertificate(this, "Cert", {
        domainName: domainConfig.names[0],
        subjectAlternativeNames: domainConfig.names.slice(1),
        hostedZone,
        region: "us-east-1",
      });
    } else {
      // External DNS path: cert ARN from context (deploy script) or config
      const certArn =
        this.node.tryGetContext("certificateArn") ||
        domainConfig?.certificate_arn;
      if (certArn && domainConfig) {
        certificate = acm.Certificate.fromCertificateArn(
          this,
          "Cert",
          certArn,
        );
      }
    }

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy:
          cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: {
        "/api/*": {
          origin: new origins.RestApiOrigin(api),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        },
      },
      defaultRootObject: "index.html",
      ...(domainConfig &&
        certificate && {
          domainNames: domainConfig.names,
          certificate,
        }),
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
        },
      ],
    });

    // Route53: create alias records pointing to CloudFront
    if (hostedZone && domainConfig) {
      for (const name of domainConfig.names) {
        const recordId = name.replace(/\./g, "-");
        new route53.ARecord(this, `Alias-${recordId}`, {
          zone: hostedZone,
          recordName: name,
          target: route53.RecordTarget.fromAlias(
            new route53Targets.CloudFrontTarget(distribution),
          ),
        });
      }
    }

    new s3deploy.BucketDeployment(this, "DeploySite", {
      sources: [
        s3deploy.Source.asset(
          path.join(__dirname, "../../packages/ui/out"),
        ),
      ],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ["/*"],
    });

    new cdk.CfnOutput(this, "DashboardUrl", {
      value: domainConfig
        ? `https://${domainConfig.names[0]}`
        : `https://${distribution.distributionDomainName}`,
    });

    new cdk.CfnOutput(this, "CloudFrontDomain", {
      value: distribution.distributionDomainName,
    });

    new cdk.CfnOutput(this, "ApiUrl", {
      value: api.url,
    });
  }
}

import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cr from 'aws-cdk-lib/custom-resources';
import { NagSuppressions } from 'cdk-nag';
import type { Construct } from 'constructs';

export interface WhyStackProps extends StackProps {
  /** Directory with the built web page (npm run web:build). */
  readonly webDir?: string;
}

const MODEL_ID = 'us.amazon.nova-2-lite-v1:0';
const TIME_ZONE = 'America/Mexico_City';
const root = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));

export class WhyStack extends Stack {
  constructor(scope: Construct, id: string, props: WhyStackProps = {}) {
    super(scope, id, props);
    const ctx = (k: string) => this.node.tryGetContext(k) as string | undefined;
    const ownerEmail = ctx('ownerEmail');
    if (!ownerEmail) throw new Error('missing context: -c ownerEmail=<email>');
    const repos = ctx('repos') ?? '';
    const beeMode = ctx('beeMode') === 'http' ? 'http' : 'cli';
    const beeBaseUrl = ctx('beeBaseUrl') ?? '';

    const key = new kms.Key(this, 'Key', { enableKeyRotation: true, removalPolicy: RemovalPolicy.DESTROY, description: 'Why data key' });
    const table = new dynamodb.TableV2(this, 'Table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      encryption: dynamodb.TableEncryptionV2.customerManagedKey(key),
      timeToLiveAttribute: 'ttl',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false },
      deletionProtection: false,
      removalPolicy: RemovalPolicy.DESTROY
    });

    const novaArns = [
      `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.amazon.nova-2-lite-v1:0`,
      'arn:aws:bedrock:*::foundation-model/amazon.nova-2-lite-v1:0'
    ];
    const bedrock = new iam.PolicyStatement({ actions: ['bedrock:InvokeModel'], resources: novaArns });
    const polly = new iam.PolicyStatement({ actions: ['polly:SynthesizeSpeech'], resources: ['*'] });

    const fn = (name: string, entry: string, timeout: Duration, environment: Record<string, string>) => {
      const logGroup = new logs.LogGroup(this, `${name}Logs`, { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY });
      return new nodejs.NodejsFunction(this, name, {
        entry: root(entry), handler: 'handler', runtime: lambda.Runtime.NODEJS_24_X, architecture: lambda.Architecture.ARM_64,
        memorySize: 512, timeout, logGroup, environment: { TABLE: table.tableName, MODEL_ID, TIME_ZONE, ...environment },
        bundling: {
          forceDockerBundling: false, format: nodejs.OutputFormat.ESM, target: 'node24', minify: true, sourceMap: false,
          mainFields: ['module', 'main'], externalModules: [],
          // Bundled CommonJS dependencies may call require(); ESM output needs it defined.
          banner: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"
        }
      });
    };

    // Cognito: one owner, invited by the stack, TOTP required.
    const userPool = new cognito.UserPool(this, 'Users', {
      selfSignUpEnabled: false, signInAliases: { email: true }, autoVerify: { email: true },
      mfa: cognito.Mfa.REQUIRED, mfaSecondFactor: { otp: true, sms: false },
      passwordPolicy: { minLength: 14, requireLowercase: true, requireUppercase: true, requireDigits: true, requireSymbols: true, tempPasswordValidity: Duration.days(3) },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY, featurePlan: cognito.FeaturePlan.LITE,
      removalPolicy: RemovalPolicy.DESTROY
    });
    const domain = userPool.addDomain('Domain', { cognitoDomain: { domainPrefix: `why-${this.account}` } });
    const authFlows = { userSrp: true };
    // The real callback (the distribution's address) is set by SetCallback below: putting it here
    // would make a cycle (client -> distribution -> function URL -> function env CLIENT_ID -> client).
    const client = userPool.addClient('Web', {
      generateSecret: false, authFlows, preventUserExistenceErrors: true,
      oAuth: { flows: { authorizationCodeGrant: true }, scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL], callbackUrls: ['https://localhost/'], logoutUrls: ['https://localhost/'] },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO]
    });
    new cognito.CfnUserPoolUser(this, 'Owner', {
      userPoolId: userPool.userPoolId, username: ownerEmail, desiredDeliveryMediums: ['EMAIL'],
      userAttributes: [{ name: 'email', value: ownerEmail }, { name: 'email_verified', value: 'true' }]
    });

    // Functions.
    const api = fn('Api', 'src/handlers/api.ts', Duration.seconds(30), { REPOS: repos, BEE_MODE: beeMode, USER_POOL_ID: userPool.userPoolId, CLIENT_ID: client.userPoolClientId });
    table.grantReadWriteData(api);
    api.addToRolePolicy(bedrock);
    api.addToRolePolicy(polly);

    const demo = fn('Demo', 'src/handlers/demo.ts', Duration.seconds(30), {});
    demo.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query'], resources: [table.tableArn],
      conditions: { 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['PUB#*'] } }
    }));
    demo.addToRolePolicy(new iam.PolicyStatement({ actions: ['kms:Decrypt'], resources: [key.keyArn] }));
    demo.addToRolePolicy(bedrock);
    demo.addToRolePolicy(polly);

    let alarmFn: lambda.IFunction = api;
    let alarmMetric = api.metricErrors({ period: Duration.hours(1), statistic: 'Sum' });
    let alarmShape = { threshold: 5, evaluationPeriods: 1 };
    let secret: secretsmanager.Secret | undefined;
    if (beeMode === 'http') {
      secret = new secretsmanager.Secret(this, 'BeeToken', { secretName: 'why/bee-token', encryptionKey: key, removalPolicy: RemovalPolicy.DESTROY });
      const sync = fn('Sync', 'src/handlers/sync.ts', Duration.minutes(5), { REPOS: repos, BEE_MODE: beeMode, BEE_BASE_URL: beeBaseUrl, BEE_SECRET_ARN: secret.secretArn });
      secret.grantRead(sync);
      table.grantReadWriteData(sync);
      sync.addToRolePolicy(bedrock);
      const schedulerRole = new iam.Role(this, 'SyncSchedulerRole', { assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com') });
      sync.grantInvoke(schedulerRole);
      new scheduler.CfnSchedule(this, 'SyncSchedule', {
        scheduleExpression: 'rate(30 minutes)', flexibleTimeWindow: { mode: 'OFF' },
        target: { arn: sync.functionArn, roleArn: schedulerRole.roleArn, retryPolicy: { maximumRetryAttempts: 0 } }
      });
      alarmFn = sync;
      alarmMetric = sync.metricErrors({ period: Duration.minutes(30), statistic: 'Sum' });
      alarmShape = { threshold: 1, evaluationPeriods: 6 };
    }

    const topic = new sns.Topic(this, 'Alerts', { enforceSSL: true });
    topic.addSubscription(new subs.EmailSubscription(ownerEmail));
    const alarm = new cloudwatch.Alarm(this, 'Failures', {
      alarmDescription: `Errors in ${alarmFn === api ? 'the private API' : 'the Bee sync'}`, metric: alarmMetric, ...alarmShape, datapointsToAlarm: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD, treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    alarm.addAlarmAction(new cwActions.SnsAction(topic));

    // Site and API behind one CloudFront distribution.
    const bucket = new s3.Bucket(this, 'Site', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, enforceSSL: true, encryption: s3.BucketEncryption.S3_MANAGED,
      autoDeleteObjects: true, removalPolicy: RemovalPolicy.DESTROY
    });
    const apiUrl = api.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.AWS_IAM });
    const demoUrl = demo.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.AWS_IAM });
    // OAC signs the request and overwrites Authorization, so the JWT travels in x-why-token.
    const forward = new cloudfront.OriginRequestPolicy(this, 'ApiForward', {
      comment: 'Why API: query string, token, body hash and content type only',
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList('x-why-token', 'x-amz-content-sha256', 'content-type'),
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.none()
    });
    const headers = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      securityHeadersBehavior: {
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), includeSubdomains: true, override: true },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
        contentSecurityPolicy: { contentSecurityPolicy: "frame-ancestors 'none'", override: true }
      }
    });
    const apiBehavior = (url: lambda.IFunctionUrl): cloudfront.BehaviorOptions => ({
      origin: origins.FunctionUrlOrigin.withOriginAccessControl(url),
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: forward, responseHeadersPolicy: headers
    });
    const distribution = new cloudfront.Distribution(this, 'Cdn', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS, responseHeadersPolicy: headers
      },
      additionalBehaviors: { '/api/demo/*': apiBehavior(demoUrl), '/api/*': apiBehavior(apiUrl) },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100
    });
    // Function URLs with IAM auth also need lambda:InvokeFunction for the caller (via the URL only).
    for (const [name, f] of [['Api', api], ['Demo', demo]] as const) {
      new lambda.CfnPermission(this, `Invoke${name}ViaUrl`, {
        action: 'lambda:InvokeFunction', principal: 'cloudfront.amazonaws.com', functionName: f.functionArn,
        sourceArn: distribution.distributionArn, invokedViaFunctionUrl: true
      });
    }

    const siteUrl = `https://${distribution.distributionDomainName}/`;
    const setCallback = new cr.AwsCustomResource(this, 'SetCallback', {
      onUpdate: {
        service: 'CognitoIdentityProvider', action: 'UpdateUserPoolClient',
        parameters: {
          UserPoolId: userPool.userPoolId, ClientId: client.userPoolClientId,
          CallbackURLs: [siteUrl], LogoutURLs: [siteUrl], AllowedOAuthFlows: ['code'], AllowedOAuthScopes: ['openid', 'email'],
          AllowedOAuthFlowsUserPoolClient: true, SupportedIdentityProviders: ['COGNITO'],
          ExplicitAuthFlows: ['ALLOW_USER_SRP_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'], PreventUserExistenceErrors: 'ENABLED', EnableTokenRevocation: true
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${id}-callback`)
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: [userPool.userPoolArn] }),
      installLatestAwsSdk: false
    });
    setCallback.node.addDependency(client);

    new s3deploy.BucketDeployment(this, 'Deploy', {
      destinationBucket: bucket, distribution, distributionPaths: ['/*'],
      sources: [
        s3deploy.Source.asset(props.webDir ?? root('dist-web')),
        s3deploy.Source.jsonData('config.json', { domain: `${domain.domainName}.auth.${this.region}.amazoncognito.com`, clientId: client.userPoolClientId, redirect: siteUrl })
      ]
    });

    new CfnOutput(this, 'SiteUrl', { value: siteUrl });
    new CfnOutput(this, 'DemoUrl', { value: `${siteUrl}?demo` });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'ClientId', { value: client.userPoolClientId });
    new CfnOutput(this, 'TableName', { value: table.tableName });
    if (secret) new CfnOutput(this, 'BeeSecretArn', { value: secret.secretArn });

    this.suppress();
  }

  /** cdk-nag findings accepted on purpose, each with its reason. */
  private suppress() {
    NagSuppressions.addStackSuppressions(this, [
      { id: 'AwsSolutions-IAM4', reason: 'Lambda functions (ours and the CDK custom-resource handlers) use the AWS managed AWSLambdaBasicExecutionRole only for writing their own CloudWatch logs.' },
      { id: 'AwsSolutions-IAM5', reason: 'Wildcards are scoped: KMS GenerateDataKey*/ReEncrypt* and DynamoDB index/* come from CDK grants on our own key and table; Bedrock foundation-model ARN must allow any region for the cross-region Nova inference profile; Polly SynthesizeSpeech has no resource to scope to; the scheduler role lambda:InvokeFunction grant covers the versions of the sync function (:*); the CDK BucketDeployment handler needs s3:*Object* on our bucket and CloudFront invalidation.' },
      { id: 'AwsSolutions-L1', reason: 'Our functions use Node.js 24 (latest); the CDK-owned custom-resource handlers pick their own runtime.' },
      { id: 'AwsSolutions-SMG4', reason: 'The Bee token is a personal token pasted by the owner; Bee offers no rotation API.' },
      { id: 'AwsSolutions-COG8', reason: 'Cognito threat protection needs the Plus feature plan, which is out of the budget; this single-owner pool has self sign-up disabled and TOTP MFA required on the Lite plan.' },
      { id: 'AwsSolutions-S1', reason: 'Server access logging is off for cost; the bucket only holds the public static web build.' },
      { id: 'AwsSolutions-CFR1', reason: 'No geo restriction: the demo is meant for hackathon judges anywhere.' },
      { id: 'AwsSolutions-CFR2', reason: 'AWS WAF is out of the $15 budget; the API rate-limits per IP and the private API requires a Cognito token.' },
      { id: 'AwsSolutions-CFR3', reason: 'CloudFront access logging is off for cost and to avoid storing viewer IPs.' },
      { id: 'AwsSolutions-CFR4', reason: 'The default cloudfront.net certificate is used (no custom domain), so the minimum TLS version cannot be raised.' }
    ]);
  }
}

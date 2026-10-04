import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, Names, RemovalPolicy, Stack, Token, type StackProps } from 'aws-cdk-lib';
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
import { NagSuppressions, type NagPackSuppressionAppliesTo } from 'cdk-nag';
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
    // cdk-nag IAM5 is suppressed per role and per finding (appliesTo), so any new wildcard fails synth.
    const allow = (target: lambda.IFunction | iam.IRole, appliesTo: NagPackSuppressionAppliesTo[], reason: string) => {
      const role = 'role' in target ? target.role : target;
      if (role) NagSuppressions.addResourceSuppressions(role, [{ id: 'AwsSolutions-IAM5', appliesTo, reason }], true);
    };
    const kmsGrant = (f: lambda.IFunction) => allow(f, ['Action::kms:GenerateDataKey*', 'Action::kms:ReEncrypt*'],
      'CDK table grant on our own customer-managed key only (the Resource is the key ARN).');
    const bedrockAny = (f: lambda.IFunction) => allow(f, ['Resource::arn:aws:bedrock:*::foundation-model/amazon.nova-2-lite-v1:0'],
      'The us. cross-region inference profile routes Nova 2 Lite to several US regions, so the foundation-model ARN needs a region wildcard; the model id is fixed.');
    const pollyAny = (f: lambda.IFunction) => allow(f, ['Resource::*'],
      'polly:SynthesizeSpeech has no resource to scope to (only lexicons, which we do not use); this is the only Resource * statement in the role.');
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
    // Cognito domain prefixes are global: a short deterministic hash instead of the account id.
    const domainSeed = Token.isUnresolved(this.account) ? Names.uniqueId(this) : `${this.account}/${this.stackName}`;
    const domainPrefix = `why-${createHash('sha256').update(domainSeed).digest('hex').slice(0, 8)}`;
    const domain = userPool.addDomain('Domain', { cognitoDomain: { domainPrefix } });
    // One source for the client settings: the CloudFormation client and the SetCallback request
    // below are both built from it, so they cannot drift. UpdateUserPoolClient resets every field
    // it is not given, which is why SetCallback resends all of them.
    const clientSettings = {
      ClientName: 'why-web', AllowedOAuthFlows: ['code'], AllowedOAuthScopes: ['openid', 'email'], AllowedOAuthFlowsUserPoolClient: true,
      SupportedIdentityProviders: ['COGNITO'], ExplicitAuthFlows: ['ALLOW_USER_SRP_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'],
      PreventUserExistenceErrors: 'ENABLED', EnableTokenRevocation: true
    };
    const placeholder = ['https://localhost/'];
    // The real callback (the distribution's address) is set by SetCallback below: putting it here
    // would make a cycle (client -> distribution -> function URL -> function env CLIENT_ID -> client).
    const cfnClient = new cognito.CfnUserPoolClient(this, 'WebClient', {
      userPoolId: userPool.userPoolId, generateSecret: false, clientName: clientSettings.ClientName,
      allowedOAuthFlows: clientSettings.AllowedOAuthFlows, allowedOAuthScopes: clientSettings.AllowedOAuthScopes,
      allowedOAuthFlowsUserPoolClient: clientSettings.AllowedOAuthFlowsUserPoolClient, supportedIdentityProviders: clientSettings.SupportedIdentityProviders,
      explicitAuthFlows: clientSettings.ExplicitAuthFlows, preventUserExistenceErrors: clientSettings.PreventUserExistenceErrors,
      enableTokenRevocation: clientSettings.EnableTokenRevocation, callbackUrLs: placeholder, logoutUrLs: placeholder
    });
    // Changes whenever the client's settings change, so SetCallback runs again right after
    // CloudFormation updates the client (which puts the placeholder callback back).
    const clientHash = createHash('sha256').update(JSON.stringify({ ...clientSettings, GenerateSecret: false, placeholder })).digest('hex').slice(0, 16);
    const client = { userPoolClientId: cfnClient.ref };
    new cognito.CfnUserPoolUser(this, 'Owner', {
      userPoolId: userPool.userPoolId, username: ownerEmail, desiredDeliveryMediums: ['EMAIL'],
      userAttributes: [{ name: 'email', value: ownerEmail }, { name: 'email_verified', value: 'true' }]
    });

    // Functions.
    const api = fn('Api', 'src/handlers/api.ts', Duration.seconds(30), { REPOS: repos, BEE_MODE: beeMode, USER_POOL_ID: userPool.userPoolId, CLIENT_ID: client.userPoolClientId });
    table.grantReadWriteData(api);
    kmsGrant(api); bedrockAny(api); pollyAny(api);
    api.addToRolePolicy(bedrock);
    api.addToRolePolicy(polly);

    const demo = fn('Demo', 'src/handlers/demo.ts', Duration.seconds(30), {});
    demo.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query'], resources: [table.tableArn],
      conditions: { 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['PUB#*'] } }
    }));
    demo.addToRolePolicy(new iam.PolicyStatement({
      actions: ['kms:Decrypt'], resources: [key.keyArn],
      conditions: { StringEquals: { 'kms:ViaService': `dynamodb.${this.region}.amazonaws.com` } }
    }));
    demo.addToRolePolicy(bedrock);
    demo.addToRolePolicy(polly);
    bedrockAny(demo); pollyAny(demo);

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
      kmsGrant(sync); bedrockAny(sync);
      const schedulerRole = new iam.Role(this, 'SyncSchedulerRole', { assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com') });
      sync.grantInvoke(schedulerRole);
      allow(schedulerRole, [`Resource::<${this.getLogicalId(sync.node.defaultChild as lambda.CfnFunction)}.Arn>:*`],
        'CDK grantInvoke also covers the versions and aliases of the sync function (ARN:*); nothing else.');
      new scheduler.CfnSchedule(this, 'SyncSchedule', {
        scheduleExpression: 'rate(30 minutes)', flexibleTimeWindow: { mode: 'OFF' },
        target: { arn: sync.functionArn, roleArn: schedulerRole.roleArn, retryPolicy: { maximumRetryAttempts: 0 } }
      });
      alarmFn = sync;
      alarmMetric = sync.metricErrors({ period: Duration.minutes(30), statistic: 'Sum' });
      alarmShape = { threshold: 1, evaluationPeriods: 6 };
    }

    if (beeMode === 'cli') {
      // Unattended sync on the owner's PC: an SSO session expires after ~8 h, so the scheduled task
      // uses this user's access key instead. The key is created by the owner in the IAM console and
      // lives only in ~/.aws/credentials (profile why-sync); CDK never creates it.
      const syncUser = new iam.User(this, 'SyncUser');
      syncUser.addToPolicy(new iam.PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:Query', 'dynamodb:Scan'],
        resources: [table.tableArn]
      }));
      syncUser.addToPolicy(new iam.PolicyStatement({
        actions: ['kms:Decrypt', 'kms:Encrypt', 'kms:GenerateDataKey'], resources: [key.keyArn],
        conditions: { StringEquals: { 'kms:ViaService': `dynamodb.${this.region}.amazonaws.com` } }
      }));
      syncUser.addToPolicy(bedrock);
      NagSuppressions.addResourceSuppressions(syncUser, [{
        id: 'AwsSolutions-IAM5', appliesTo: ['Resource::arn:aws:bedrock:*::foundation-model/amazon.nova-2-lite-v1:0'],
        reason: 'The us. cross-region inference profile routes Nova 2 Lite to several US regions, so the foundation-model ARN needs a region wildcard; the model id is fixed.'
      }], true);
      new CfnOutput(this, 'SyncUserName', { value: syncUser.userName });
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
    // OAC signs the request and overwrites Authorization, so the JWT travels in x-why-token. CloudFront
    // forwards the viewer's x-amz-content-sha256 to OAC Lambda origins on its own and rejects it in a policy.
    const forward = new cloudfront.OriginRequestPolicy(this, 'ApiForward', {
      comment: 'Why API: query string, token and content type only (CloudFront adds x-amz-content-sha256 for OAC itself)',
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList('x-why-token', 'content-type'),
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

    // Own log groups (1 month) for the CDK helper functions too. Their functions reference the group, so
    // CloudFormation deletes the group only after the function on teardown or rollback. The S3
    // auto-delete provider has no log group option; it keeps Lambda's default group, which it can create
    // itself (AWSLambdaBasicExecutionRole).
    const helperLogs = (name: string) => new logs.LogGroup(this, name, { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY });
    const siteUrl = `https://${distribution.distributionDomainName}/`;
    const setCallback = new cr.AwsCustomResource(this, 'SetCallback', {
      onUpdate: {
        service: '@aws-sdk/client-cognito-identity-provider', action: 'UpdateUserPoolClient',
        parameters: { UserPoolId: userPool.userPoolId, ClientId: client.userPoolClientId, ...clientSettings, CallbackURLs: [siteUrl], LogoutURLs: [siteUrl] },
        physicalResourceId: cr.PhysicalResourceId.of(`${id}-callback-${clientHash}`)
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: [userPool.userPoolArn] }),
      installLatestAwsSdk: false,
      logGroup: helperLogs('SetCallbackLogs')
    });
    setCallback.node.addDependency(cfnClient);

    new s3deploy.BucketDeployment(this, 'Deploy', {
      destinationBucket: bucket, distribution, distributionPaths: ['/*'], logGroup: helperLogs('DeployLogs'),
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

    const deployHandler = 'Custom::CDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C';
    NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/${deployHandler}/ServiceRole/DefaultPolicy/Resource`, [{
      id: 'AwsSolutions-IAM5', reason: 'CDK BucketDeployment handler: copies the web build from the CDK assets bucket into our site bucket and invalidates our distribution (CloudFront invalidation has no resource-level scoping).',
      appliesTo: ['Action::s3:Abort*', 'Action::s3:DeleteObject*', 'Action::s3:GetBucket*', 'Action::s3:GetObject*', 'Action::s3:List*', 'Resource::*',
        `Resource::<${this.getLogicalId(bucket.node.defaultChild as s3.CfnBucket)}.Arn>/*`, { regex: '/^Resource::arn:<AWS::Partition>:s3:::cdk-[a-z0-9]+-assets-.+\/\*$/' }]
    }]);
    NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/${deployHandler}/Resource`, [{
      id: 'AwsSolutions-L1', reason: 'The BucketDeployment handler is owned by the CDK, which picks its Python runtime; our functions use Node.js 24.'
    }]);
    this.suppress();
  }

  /** cdk-nag findings accepted on purpose, each with its reason. */
  private suppress() {
    NagSuppressions.addStackSuppressions(this, [
      { id: 'AwsSolutions-IAM4', appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'], reason: 'Lambda functions (ours and the CDK custom-resource handlers) use the AWS managed AWSLambdaBasicExecutionRole only for writing their own CloudWatch logs.' },
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

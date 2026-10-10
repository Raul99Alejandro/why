import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { WhyStack } from '../../infra/lib/why-stack.js';

const webDir = mkdtempSync(join(tmpdir(), 'why-web-'));
writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>Why</title>');

const build = (beeMode: 'http' | 'cli') => Template.fromStack(new WhyStack(new App({ context: { ownerEmail: 'owner@example.com', repos: 'o/r', beeMode, beeBaseUrl: 'https://bee.example' } }), 'Test', { env: { account: '111111111111', region: 'us-east-1' }, webDir }));
const template = () => build('http');
const fnId = (t: Template, prefix: string) => Object.keys(t.findResources('AWS::Lambda::Function')).find(id => id.startsWith(prefix))!;
const fnUrlId = (t: Template, prefix: string) => Object.keys(t.findResources('AWS::Lambda::Url')).find(id => id.startsWith(prefix))!;

describe('Why stack', () => {
  const t = template();
  it('encrypts the table with its own key and expires raw transcripts', () => {
    t.hasResourceProperties('AWS::DynamoDB::GlobalTable', { SSESpecification: { SSEEnabled: true, SSEType: 'KMS' }, TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true } });
  });
  it('lets nobody sign up and requires MFA', () => {
    t.hasResourceProperties('AWS::Cognito::UserPool', { AdminCreateUserConfig: { AllowAdminCreateUserOnly: true }, MfaConfiguration: 'ON' });
  });
  it('keeps the bucket private and the API behind CloudFront', () => {
    t.hasResourceProperties('AWS::S3::Bucket', { PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true } });
    t.hasResourceProperties('AWS::Lambda::Url', { AuthType: 'AWS_IAM' });
  });
  it('lets only the sync function read the Bee token', () => {
    const policies = t.findResources('AWS::IAM::Policy');
    const readers = Object.values(policies).filter(p => JSON.stringify(p).includes('secretsmanager:GetSecretValue'));
    expect(readers).toHaveLength(1);
    expect(JSON.stringify(readers[0])).toMatch(/Sync/);
  });
  it('lets the demo function read only published keys, and never scan or write', () => {
    const policies = Object.entries(t.findResources('AWS::IAM::Policy')).filter(([id]) => /Demo/.test(id)).map(([, p]) => JSON.stringify(p));
    expect(policies).toHaveLength(1);
    expect(policies[0]).toContain('dynamodb:LeadingKeys');
    expect(policies[0]).toContain('PUB#*');
    expect(policies[0]).not.toMatch(/dynamodb:(Scan|PutItem|UpdateItem|DeleteItem|BatchWriteItem)|secretsmanager/);
  });
  it('limits Bedrock to Nova 2 Lite', () => {
    const json = JSON.stringify(t.findResources('AWS::IAM::Policy'));
    expect(json).toContain('inference-profile/us.amazon.nova-2-lite-v1:0');
    type Statement = { Action: string | string[]; Resource: unknown };
    const statements = Object.values(t.findResources('AWS::IAM::Policy')).flatMap(p => p.Properties.PolicyDocument.Statement as Statement[]);
    const bedrock = statements.filter(st => [st.Action].flat().some(a => a.startsWith('bedrock:')));
    expect(bedrock.length).toBeGreaterThan(0);
    for (const st of bedrock) {
      expect([st.Action].flat()).toEqual(['bedrock:InvokeModel']);
      expect([st.Resource].flat()).not.toContain('*');
    }
  });
  it('runs the sync every 30 minutes and alarms on failures', () => {
    t.hasResourceProperties('AWS::Scheduler::Schedule', { ScheduleExpression: 'rate(30 minutes)' });
    t.resourceCountIs('AWS::CloudWatch::Alarm', 1);
  });
  it('has no load balancer, NAT or container', () => {
    for (const type of ['AWS::ElasticLoadBalancingV2::LoadBalancer', 'AWS::EC2::NatGateway', 'AWS::ECS::Service']) t.resourceCountIs(type, 0);
  });
  it('lets only this distribution invoke the function URLs', () => {
    const distribution = Object.keys(t.findResources('AWS::CloudFront::Distribution'))[0];
    const perms = Object.values(t.findResources('AWS::Lambda::Permission', { Properties: { Action: 'lambda:InvokeFunctionUrl', Principal: 'cloudfront.amazonaws.com' } }));
    expect(perms).toHaveLength(2);
    for (const p of perms) expect(JSON.stringify(p.Properties.SourceArn)).toContain(distribution);
  });
  it('also lets this distribution invoke both functions, only through their URLs', () => {
    const distribution = Object.keys(t.findResources('AWS::CloudFront::Distribution'))[0]!;
    const perms = Object.values(t.findResources('AWS::Lambda::Permission', { Properties: { Action: 'lambda:InvokeFunction', Principal: 'cloudfront.amazonaws.com' } }));
    expect(perms).toHaveLength(2);
    const fns = Object.keys(t.findResources('AWS::Lambda::Function')).filter(id => /^(Api|Demo)/.test(id));
    for (const p of perms) {
      expect(p.Properties.InvokedViaFunctionUrl).toBe(true);
      expect(JSON.stringify(p.Properties.SourceArn)).toContain(`:distribution/",{"Ref":"${distribution}"}`);
    }
    expect(perms.map(p => p.Properties.FunctionName['Fn::GetAtt'][0]).sort()).toEqual(fns.sort());
  });
  it('points the Cognito callback at the distribution, after every client change', () => {
    const distribution = Object.keys(t.findResources('AWS::CloudFront::Distribution'))[0]!;
    const crs = Object.values(t.findResources('Custom::AWS'));
    expect(crs).toHaveLength(1);
    // Rebuild the SDK call from its Fn::Join, standing in DIST for the distribution's domain.
    const parts = crs[0]!.Properties.Update['Fn::Join'][1] as unknown[];
    const call = JSON.parse(parts.map(x => typeof x === 'string' ? x
      : JSON.stringify(x) === JSON.stringify({ 'Fn::GetAtt': [distribution, 'DomainName'] }) ? 'DIST' : 'TOKEN').join(''));
    expect(call.service).toBe('@aws-sdk/client-cognito-identity-provider');
    expect(call.action).toBe('UpdateUserPoolClient');
    const cbPolicy = Object.entries(t.findResources('AWS::IAM::Policy')).find(([id]) => id.startsWith('SetCallback'))![1];
    expect(cbPolicy.Properties.PolicyDocument.Statement).toEqual([{ Action: 'cognito-idp:UpdateUserPoolClient', Effect: 'Allow', Resource: { 'Fn::GetAtt': [Object.keys(t.findResources('AWS::Cognito::UserPool'))[0], 'Arn'] } }]);
    expect(call.parameters.CallbackURLs).toEqual(['https://DIST/']);
    expect(call.parameters.LogoutURLs).toEqual(['https://DIST/']);
    // The physical id carries a hash of the client settings, so a client change re-runs the call.
    expect(call.physicalResourceId.id).toMatch(/^Test-callback-[0-9a-f]{16}$/);
    const client = Object.values(t.findResources('AWS::Cognito::UserPoolClient'))[0]!.Properties;
    for (const k of ['ClientName', 'AllowedOAuthFlows', 'AllowedOAuthScopes', 'AllowedOAuthFlowsUserPoolClient', 'SupportedIdentityProviders', 'ExplicitAuthFlows', 'PreventUserExistenceErrors', 'EnableTokenRevocation'])
      expect(call.parameters[k]).toEqual(client[k]);
  });
  it('lets the demo decrypt only through DynamoDB, and keeps the account id out of the Cognito domain', () => {
    const demo = JSON.stringify(Object.entries(t.findResources('AWS::IAM::Policy')).find(([id]) => /Demo/.test(id))![1]);
    expect(demo).toContain('"kms:ViaService":"dynamodb.us-east-1.amazonaws.com"');
    t.hasResourceProperties('AWS::Cognito::UserPoolDomain', { Domain: Match.stringLikeRegexp('^why-[0-9a-f]{8}$') });
    expect(JSON.stringify(t.findResources('AWS::Cognito::UserPoolDomain'))).not.toContain('111111111111');
  });
  it('forwards only the token and content type to the API origins (CloudFront adds the body hash itself), never Host', () => {
    t.hasResourceProperties('AWS::CloudFront::OriginRequestPolicy', { OriginRequestPolicyConfig: Match.objectLike({
      HeadersConfig: { HeaderBehavior: 'whitelist', Headers: ['x-why-token', 'content-type'] },
      QueryStringsConfig: { QueryStringBehavior: 'all' }, CookiesConfig: { CookieBehavior: 'none' }
    }) });
  });
  it('lists no header CloudFront refuses in a policy (Authorization, Host, X-Amz-*)', () => {
    const headers = ['AWS::CloudFront::OriginRequestPolicy', 'AWS::CloudFront::CachePolicy', 'AWS::CloudFront::ResponseHeadersPolicy']
      .flatMap(type => [...JSON.stringify(t.findResources(type)).matchAll(/"Headers?":\[([^\]]*)\]/g)].flatMap(m => JSON.parse(`[${m[1]}]`) as unknown[]))
      .filter((h): h is string => typeof h === 'string');
    expect(headers.length).toBeGreaterThan(0);
    for (const h of headers) expect(h.toLowerCase()).not.toMatch(/^(authorization|host|x-amz-.*)$/);
  });
  it('routes /api/demo/* before /api/*, and /mcp, uncached', () => {
    const dist = Object.values(t.findResources('AWS::CloudFront::Distribution'))[0]!;
    const behaviors = dist.Properties.DistributionConfig.CacheBehaviors as { PathPattern: string; CachePolicyId: string }[];
    expect(behaviors.map(b => b.PathPattern)).toEqual(['/api/demo/*', '/api/*', '/mcp']);
    for (const b of behaviors) expect(b.CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
  });
  it('lets every function, CDK helpers included, write its logs, with 1-month retention where we own the group', () => {
    const roles = t.findResources('AWS::IAM::Role');
    for (const [id, fn] of Object.entries(t.findResources('AWS::Lambda::Function'))) {
      const role = roles[fn.Properties.Role['Fn::GetAtt'][0]];
      expect(JSON.stringify(role?.Properties.ManagedPolicyArns), id).toContain('AWSLambdaBasicExecutionRole');
      const group = fn.Properties.LoggingConfig?.LogGroup?.Ref;
      if (group) {
        expect(t.findResources('AWS::Logs::LogGroup')[group]?.Properties.RetentionInDays, id).toBe(30);
        // The function depends on its group, so on delete or rollback the group outlives the function.
      }
    }
    const withGroup = Object.entries(t.findResources('AWS::Lambda::Function')).filter(([, f]) => f.Properties.LoggingConfig).map(([id]) => id);
    expect(withGroup.some(id => id.startsWith('AWS679f53fac'))).toBe(true);
    expect(withGroup.some(id => id.startsWith('CustomCDKBucketDeployment'))).toBe(true);
  });
  it('serves the Alexa skill from a function that reads only published keys and cannot scan, write or read secrets', () => {
    const policy = JSON.stringify(Object.entries(t.findResources('AWS::IAM::Policy')).find(([id]) => /Alexa/.test(id))![1]);
    expect(policy).toContain('PUB#*');
    expect(policy).toContain('"kms:ViaService":"dynamodb.us-east-1.amazonaws.com"');
    expect(policy).not.toMatch(/dynamodb:(Scan|PutItem|UpdateItem|DeleteItem|BatchWriteItem)|secretsmanager|polly/);
    const urls = Object.values(t.findResources('AWS::Lambda::Url', { Properties: { AuthType: 'NONE' } }));
    expect(urls.map(u => u.Properties.TargetFunctionArn['Fn::GetAtt'][0]).sort()).toEqual([fnId(t, 'Alexa'), fnId(t, 'Mcp')]);
    const alexa = Object.entries(t.findResources('AWS::Lambda::Function')).find(([id]) => id.startsWith('Alexa'))![1];
    expect(alexa.Properties.Timeout).toBe(8);
  });
  it('serves MCP from a function that reads only published keys and cannot scan, write, speak or read secrets', () => {
    type Statement = { Action: string | string[]; Condition?: unknown };
    const policies = Object.entries(t.findResources('AWS::IAM::Policy')).filter(([id]) => /^Mcp/.test(id));
    expect(policies).toHaveLength(1);
    const statements = policies[0]![1].Properties.PolicyDocument.Statement as Statement[];
    const ddb = statements.filter(st => [st.Action].flat().some(a => a.startsWith('dynamodb:')));
    expect(ddb.length).toBeGreaterThan(0);
    for (const st of ddb) {
      expect([st.Action].flat().sort()).toEqual(['dynamodb:GetItem', 'dynamodb:Query']);
      expect(st.Condition).toEqual({ 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['PUB#*'] } });
    }
    const json = JSON.stringify(statements);
    expect(json).toContain('"kms:ViaService":"dynamodb.us-east-1.amazonaws.com"');
    expect(json).toContain('bedrock:InvokeModel');
    expect(json).not.toMatch(/dynamodb:(Scan|PutItem|UpdateItem|DeleteItem|BatchWriteItem)|secretsmanager|polly/);
  });
  it('sends /mcp to the MCP function URL without OAC, forwarding the MCP headers, and outputs its address', () => {
    const dist = Object.values(t.findResources('AWS::CloudFront::Distribution'))[0]!.Properties.DistributionConfig;
    const mcp = (dist.CacheBehaviors as { PathPattern: string; TargetOriginId: string; AllowedMethods: string[]; ViewerProtocolPolicy: string; OriginRequestPolicyId: { Ref: string } }[]).find(b => b.PathPattern === '/mcp')!;
    expect(mcp.AllowedMethods).toContain('POST');
    expect(mcp.ViewerProtocolPolicy).toBe('https-only');
    const origin = (dist.Origins as { Id: string; DomainName: unknown; OriginAccessControlId?: unknown }[]).find(o => o.Id === mcp.TargetOriginId)!;
    expect(origin.OriginAccessControlId).toBeUndefined();
    expect(JSON.stringify(origin.DomainName)).toContain(fnUrlId(t, 'Mcp'));
    const policy = t.findResources('AWS::CloudFront::OriginRequestPolicy')[mcp.OriginRequestPolicyId.Ref]!;
    expect(policy.Properties.OriginRequestPolicyConfig.HeadersConfig.Headers.sort()).toEqual(['accept', 'content-type', 'mcp-protocol-version']);
    expect(policy.Properties.OriginRequestPolicyConfig.CookiesConfig).toEqual({ CookieBehavior: 'none' });
    expect(JSON.stringify(t.toJSON().Outputs.McpUrl.Value)).toContain('mcp');
    const fn = t.findResources('AWS::Lambda::Function')[fnId(t, 'Mcp')]!;
    expect(fn.Properties.Timeout).toBe(30);
  });
  it('lets only CloudFront reach the MCP function: a generated origin secret, passed as a dynamic reference', () => {
    const secrets = Object.entries(t.findResources('AWS::SecretsManager::Secret')).filter(([id]) => id.startsWith('McpOriginSecret'));
    expect(secrets).toHaveLength(1);
    const [secretId, secret] = secrets[0]!;
    expect(secret.Properties.SecretString).toBeUndefined();
    expect(secret.Properties.GenerateSecretString).toMatchObject({ PasswordLength: 32, ExcludePunctuation: true });
    const ref = JSON.stringify({ 'Fn::Join': ['', ['{{resolve:secretsmanager:', { Ref: secretId }, ':SecretString:::}}']] });
    const dist = Object.values(t.findResources('AWS::CloudFront::Distribution'))[0]!.Properties.DistributionConfig;
    const mcp = (dist.CacheBehaviors as { PathPattern: string; TargetOriginId: string }[]).find(b => b.PathPattern === '/mcp')!;
    const origin = (dist.Origins as { Id: string; OriginCustomHeaders?: { HeaderName: string; HeaderValue: unknown }[] }[]).find(o => o.Id === mcp.TargetOriginId)!;
    expect(origin.OriginCustomHeaders).toHaveLength(1);
    expect(origin.OriginCustomHeaders![0]!.HeaderName).toBe('x-why-origin');
    expect(JSON.stringify(origin.OriginCustomHeaders![0]!.HeaderValue)).toBe(ref);
    const fn = t.findResources('AWS::Lambda::Function')[fnId(t, 'Mcp')]!;
    expect(JSON.stringify(fn.Properties.Environment.Variables.ORIGIN_SECRET)).toBe(ref);
    // No other origin carries the header, and no function but Mcp gets the secret.
    expect(dist.Origins.filter((o: { OriginCustomHeaders?: unknown }) => o.OriginCustomHeaders)).toHaveLength(1);
    expect(Object.values(t.findResources('AWS::Lambda::Function')).filter(f => JSON.stringify(f).includes(secretId))).toHaveLength(1);
  });
  it('gives the demo function no reserved concurrency', () => {
    for (const fn of Object.values(t.findResources('AWS::Lambda::Function'))) expect(fn.Properties.ReservedConcurrentExecutions).toBeUndefined();
  });
});

describe('Why stack in cli mode', () => {
  const t = build('cli');
  it('has no schedule, no Bee secret and one alarm on the API errors', () => {
    t.resourceCountIs('AWS::Scheduler::Schedule', 0);
    expect(Object.keys(t.findResources('AWS::SecretsManager::Secret')).filter(id => !id.startsWith('McpOriginSecret'))).toEqual([]);
    t.resourceCountIs('AWS::CloudWatch::Alarm', 1);
    t.hasResourceProperties('AWS::CloudWatch::Alarm', { MetricName: 'Errors', Threshold: 5, Period: 3600, EvaluationPeriods: 1 });
    expect(JSON.stringify(t.findResources('AWS::IAM::Policy'))).not.toContain('secretsmanager');
    expect(Object.keys(t.toJSON().Outputs ?? {})).not.toContain('BeeSecretArn');
  });
  it('creates a SyncUser limited to the table, its key via DynamoDB, and Nova', () => {
    t.resourceCountIs('AWS::IAM::User', 1);
    t.resourceCountIs('AWS::IAM::AccessKey', 0);
    const user = Object.values(t.findResources('AWS::IAM::User'))[0]!;
    expect(user.Properties?.ManagedPolicyArns).toBeUndefined();
    expect(user.Properties?.LoginProfile).toBeUndefined();
    expect(Object.keys(t.toJSON().Outputs ?? {})).toContain('SyncUserName');
    const policies = Object.entries(t.findResources('AWS::IAM::Policy')).filter(([id]) => /^SyncUser/.test(id));
    expect(policies).toHaveLength(1);
    type Statement = { Action: string | string[]; Resource: unknown; Condition?: unknown };
    const statements = policies[0]![1].Properties.PolicyDocument.Statement as Statement[];
    const byAction = (prefix: string) => statements.filter(st => [st.Action].flat().some(a => a.startsWith(prefix)));
    const ddb = byAction('dynamodb:');
    expect(ddb).toHaveLength(1);
    expect([ddb[0]!.Action].flat().sort()).toEqual(['dynamodb:DeleteItem', 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query', 'dynamodb:Scan', 'dynamodb:UpdateItem']);
    const table = Object.keys(t.findResources('AWS::DynamoDB::GlobalTable'))[0]!;
    expect(ddb[0]!.Resource).toEqual({ 'Fn::GetAtt': [table, 'Arn'] });
    const kms = byAction('kms:');
    expect(kms).toHaveLength(1);
    expect([kms[0]!.Action].flat().sort()).toEqual(['kms:Decrypt', 'kms:Encrypt', 'kms:GenerateDataKey']);
    expect(kms[0]!.Condition).toEqual({ StringEquals: { 'kms:ViaService': 'dynamodb.us-east-1.amazonaws.com' } });
    const bedrock = byAction('bedrock:');
    expect(bedrock).toHaveLength(1);
    expect([bedrock[0]!.Action].flat()).toEqual(['bedrock:InvokeModel']);
    expect(JSON.stringify(bedrock[0]!.Resource)).toContain('nova-2-lite-v1:0');
    expect(statements).toHaveLength(3);
    expect(JSON.stringify(statements)).not.toMatch(/secretsmanager|polly|cognito|s3:/);
  });
});

describe('Why stack in http mode', () => {
  it('has no SyncUser', () => {
    const t = build('http');
    t.resourceCountIs('AWS::IAM::User', 0);
    expect(Object.keys(t.toJSON().Outputs ?? {})).not.toContain('SyncUserName');
  }, 60_000); // builds a whole stack (bundling included) inside the test, which can pass 20 s under a full run
});

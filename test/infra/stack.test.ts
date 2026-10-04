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
    expect(call.action).toBe('UpdateUserPoolClient');
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
  it('forwards only the token, body hash and content type to the API origins, never Host', () => {
    t.hasResourceProperties('AWS::CloudFront::OriginRequestPolicy', { OriginRequestPolicyConfig: Match.objectLike({
      HeadersConfig: { HeaderBehavior: 'whitelist', Headers: ['x-why-token', 'x-amz-content-sha256', 'content-type'] },
      QueryStringsConfig: { QueryStringBehavior: 'all' }, CookiesConfig: { CookieBehavior: 'none' }
    }) });
  });
  it('routes /api/demo/* before /api/*, uncached', () => {
    const dist = Object.values(t.findResources('AWS::CloudFront::Distribution'))[0]!;
    const behaviors = dist.Properties.DistributionConfig.CacheBehaviors as { PathPattern: string; CachePolicyId: string }[];
    expect(behaviors.map(b => b.PathPattern)).toEqual(['/api/demo/*', '/api/*']);
    for (const b of behaviors) expect(b.CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
  });
  it('gives the demo function no reserved concurrency', () => {
    for (const fn of Object.values(t.findResources('AWS::Lambda::Function'))) expect(fn.Properties.ReservedConcurrentExecutions).toBeUndefined();
  });
});

describe('Why stack in cli mode', () => {
  const t = build('cli');
  it('has no schedule, no Bee secret and one alarm on the API errors', () => {
    t.resourceCountIs('AWS::Scheduler::Schedule', 0);
    t.resourceCountIs('AWS::SecretsManager::Secret', 0);
    t.resourceCountIs('AWS::CloudWatch::Alarm', 1);
    t.hasResourceProperties('AWS::CloudWatch::Alarm', { MetricName: 'Errors', Threshold: 5, Period: 3600, EvaluationPeriods: 1 });
    expect(JSON.stringify(t.findResources('AWS::IAM::Policy'))).not.toContain('secretsmanager');
    expect(Object.keys(t.toJSON().Outputs ?? {})).not.toContain('BeeSecretArn');
  });
});

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
    expect(json).not.toMatch(/"bedrock:\*"|"Resource":"\*".{0,80}bedrock:InvokeModel/);
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

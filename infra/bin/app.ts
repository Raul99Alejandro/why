import { App, Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { WhyStack } from '../lib/why-stack.js';

const app = new App();
new WhyStack(app, 'Why', { env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' } });
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

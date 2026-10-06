# Product feedback (draft for Devpost)

Answers per tool, from building Why in October 2026. Devpost asks five questions; they are answered here in this order, so copy each block into the matching field and adjust the headings to the form's exact wording. Details and dates are in [../friction-log.md](../friction-log.md).

The five questions: (1) What worked well? (2) What was hard or frustrating? (3) What is missing or what would you change? (4) How were the docs and getting started? (5) Would you use it again, and for what?

## Bee CLI and API

1. **What worked well.** `bee changed --json` with a cursor is a clean incremental feed, so a 5-minute sync is cheap. `bee todos create|complete|list --json` let Why act inside the user's own Bee app, which is the strongest part of the product for builders: an alert that appears where the user already looks. The CLI handles the login, so no secret reaches our cloud.
2. **What was hard.** A conversation stayed `CAPTURING` for more than 20 hours and absorbed every new recording, so "wait for it to finish" never fired. Direct API access is awkward: a private certificate authority, no documented bearer scheme, unknown token lifetime. `bee status` prints part of the token. There is no way to make a todo creation idempotent.
3. **Missing or to change.** Session boundaries (or a per-recording id and timestamp); an idempotency key on `todos create`; webhooks or a push for new utterances on a normal public endpoint; a todo `source` field so an app can label its own todos; JSON schemas.
4. **Docs and getting started.** The CLI is documented well enough to start. The shapes of real JSON differed from our guess (utterances under `transcriptions[].utterances`), and a finished conversation was not visible on day one, so we recorded every shape ourselves in `docs/bee-api.md`. CLI names and HTTP paths do not match and there is no REST reference.
5. **Use again.** Yes. Ambient capture plus todos in the same app is a good base for "software that acts on what you said". We would build more on it if sessions and idempotency were first-class.

## Amazon Bedrock (Nova 2 Lite)

1. **What worked well.** Forced tool use plus a zod schema gave dependable structured output from Spanish speech in English, with one retry. Cost and latency suited a per-session analysis, a per-segment work-or-personal classifier and a judge for reversals. The same model answered questions with citations.
2. **What was hard.** Quality, not the API: the first prompt turned status updates into decisions, and transcribed names were often wrong. Untrusted text needs its own defences (tag neutralisation, citations validated in code).
3. **Missing or to change.** Guidance and examples for decision extraction and for non-English input; a documented pattern for untrusted text with forced tools; clearer expected latency for short Alexa-style budgets.
4. **Docs and getting started.** The Converse API with tool configuration was easy to follow.
5. **Use again.** Yes for structured extraction and small judgement calls at low cost.

## Alexa Skills Kit

1. **What worked well.** A custom skill with one intent and an `AMAZON.SearchQuery` slot was enough for "what did we decide about ...", and the developer console simulator removes the need for a device. The `ask` CLI manages the skill package from the repo.
2. **What was hard.** Alexa cannot sign requests with IAM, so an AWS endpoint must verify the certificate chain, the signature, the timestamp and the skill id itself; that needs the raw request body and headers, which pushed us to a Function URL. The time limit (8 seconds) is tight for a certificate fetch plus a model call. The `ask` login expired.
3. **Missing or to change.** A built-in verifier or an authorizer for Lambda Function URLs; request headers available on Lambda ARN endpoints; a mock signed-request generator for tests (we built fixtures).
4. **Docs and getting started.** The request-verification rules are documented but spread over several pages; the manifest fields (privacy policy URL, certificate type) are easy to get wrong without a validator we could run offline. We have not yet seen the live simulator results, so this answer will be updated after the test.
5. **Use again.** Yes for voice access to a user's own data, if the verification burden shrinks.

## AWS CDK, Lambda, DynamoDB, CloudFront and Cognito

1. **What worked well.** One CDK stack defines the whole product (table with KMS, Cognito with TOTP MFA, private S3 behind CloudFront, three Lambdas with separate roles). `cdk-nag` caught real issues early and forced every exception to carry a reason. Demo isolation by IAM (a role that reads only `PUB#` keys) is simple and strong. DynamoDB conditional writes made the single-writer, versioned decision ledger straightforward.
2. **What was hard.** Two deploys failed: CloudFront does not allow `x-amz-content-sha256` in an origin request policy, and OAC overwrites `Authorization`; then the Cognito callback needed a custom resource to break a dependency cycle, which first used the wrong SDK package and IAM action and left a retained bucket. Expired SSO sessions blocked later deploys.
3. **Missing or to change.** A documented recipe for OAC with a POST to a Function URL (which headers are allowed, rejected or replaced); an L2 way to set Cognito callback URLs from a distribution; clearer first-deploy errors for the custom-resource case.
4. **Docs and getting started.** Each service is well documented alone; the combination (OAC, Function URL, Cognito JWT, POST bodies) is where we had to find answers by failing. `cdk synth` with nag in the test suite was the fastest feedback loop.
5. **Use again.** Yes. Serverless with infrastructure in code let us ship a secure private-plus-public product without any server to run.

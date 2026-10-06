# Product feedback (draft for Devpost)

Answers per tool, following Devpost's five questions in order: (1) Which developer tools, APIs and SDKs did you use and for what? (2) What worked well? (3) What needs work? (4) How was your onboarding experience (zero to hello world)? (5) Would you build with these devices and services again? Details and dates are in [../friction-log.md](../friction-log.md).

## Bee CLI and API

1. **Used for.** The `bee` CLI (`@beeai/cli` 0.7.3, Windows): `bee changed --json` for the incremental feed, `bee conversations get` for utterances, `bee todos create|complete|list --json` to write alerts and follow-ups into the user's Bee app.
2. **What worked well.** The cursor feed makes a 5-minute sync cheap. Todos let Why act inside the app the user already checks. The CLI handles login, so no Bee secret reaches our cloud. Todo create, read, complete and delete were verified live.
3. **What needs work.** A conversation stayed `CAPTURING` for more than 20 hours and absorbed every new recording, so waiting for it to finish never fired (workaround: split sessions at 20-minute gaps). The real JSON differed from our guess (utterances under `transcriptions[].utterances`). CLI names do not match HTTP paths and there is no REST reference. The API sits behind a private certificate authority, the bearer scheme and token lifetime are undocumented, and `bee status` prints part of the token. `todos create` has no idempotency key (workaround: save the text first, then list and adopt on retry). On Windows we needed `shell: true`, which prints Node's DEP0190 warning.
4. **Onboarding.** The CLI was easy to start with. A finished conversation was not visible on day one, so we recorded every real shape ourselves in `docs/bee-api.md`.
5. **Build again: Yes.** Ambient capture plus todos in the same app is a strong base for software that acts on what you said. Session boundaries and idempotent todos would make it much better.

## Amazon Bedrock (Nova 2 Lite)

1. **Used for.** Decision extraction from Spanish speech (forced tool call, zod schema, one retry), a work-or-personal classifier, the reversal judge, name review and cited answers.
2. **What worked well.** Structured output was dependable; cost and latency suit per-session calls; one model covered every job.
3. **What needs work.** Quality, not the API: the first prompt turned status updates into decisions and transcribed names were often wrong (fixed with a stricter prompt and a glossary). Untrusted text needs our own defences (tag neutralisation; a spaced closing tag is still a known gap). We want examples for decision extraction and non-English input.
4. **Onboarding.** The Converse API with tool configuration was straightforward to follow.
5. **Build again: Yes.** Low-cost structured extraction and small judgement calls.

## Alexa Skills Kit

Verified in simulator: pending (the endpoint and skill are not deployed yet; everything below is from code, fixtures and documentation, not from a live run).

1. **Used for.** A custom skill (`AskWhyIntent`, `AMAZON.SearchQuery`) and the `ask` CLI, answering "what did we decide about ..." from the published copy.
2. **What worked well.** One intent and one slot were enough; the developer console simulator removes the need for a device. Verified in simulator: pending.
3. **What needs work.** Alexa cannot sign with IAM, so our Function URL verifies the certificate chain, signature, timestamp and skill id itself, which needs raw headers and body. The 8-second limit is tight for a certificate fetch plus a model call (latency not measured live). The `ask` login had expired. We want a built-in verifier and a mock signed-request generator. Manifest fields (privacy URL, certificate type) are untested live.
4. **Onboarding.** Verified in simulator: pending. Request-verification rules are documented but spread over several pages.
5. **Build again: Yes, provisionally.** Voice access to a user's own data is valuable if verification gets easier; confirm after the simulator test.

## AWS CDK, Lambda, DynamoDB, CloudFront and Cognito

1. **Used for.** CDK (TypeScript) with cdk-nag for the whole stack; Lambda for API, demo and Alexa; DynamoDB with KMS and conditional writes; CloudFront with S3 and OAC; Cognito with TOTP MFA.
2. **What worked well.** One stack defines the product. cdk-nag forced a reason for each exception. IAM-level demo isolation (a role that reads only `PUB#` keys) is simple and strong. Conditional writes made the versioned decision ledger easy. `cdk synth` with nag in tests was a fast feedback loop.
3. **What needs work.** Two failed deploys: CloudFront rejects `x-amz-content-sha256` in an origin request policy and OAC overwrites `Authorization` (workaround: `x-why-token` plus a viewer-sent body hash); the Cognito callback needed a custom resource to break a dependency cycle, first with the wrong SDK package and IAM action, leaving a retained bucket. Expired SSO sessions blocked later deploys. We want a documented OAC plus Function URL POST recipe and an L2 for callback URLs from a distribution.
4. **Onboarding.** Each service is well documented alone; the combination was learned by failing.
5. **Build again: Yes.** Serverless with infrastructure in code gave a secure private-plus-public product with no server to run.

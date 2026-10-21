# Textos para YouTube y Devpost: Why (Bee track)

> Todo listo para pegar. Solo falta: subir `video/why/build/Why-Bee-track-demo.mp4` (hub) a YouTube y reemplazar `<VIDEO_URL>` aquí y en el README (`VIDEO_URL`).

## YouTube

> Título y descripción del video.

**Title:** Why — Bee turns your work conversations into a log of decisions

**Description:**

Why listens, through a Bee wearable, to real working conversations in Spanish and writes a daily log in English: each decision, the reason behind it, the to-dos and the open questions, linked to the public GitHub commits that followed. When a new decision contradicts an earlier one, Why writes a reversal alert into the Bee app as a todo; follow-ups become Bee todos too, and Why completes them when a matching commit lands. You can ask "why did I decide that?" by voice or text and get an answer that cites its sources, and coding agents can check a planned change against past decisions through MCP.

In this video, everything is the real product on real data: the public demo log built from the owner's Bee recordings (client calls and team meetings, 7 to 20 October 2026, names of people and clients replaced by roles), a follow-up todo that Why wrote into the owner's Bee app (real Bee CLI output, shown as a replay), Claude Code stopping before an iOS change because Why found the real decision "Develop the mobile application only for Android", and a cited answer read aloud by Amazon Polly. It runs serverless on AWS with Amazon Nova 2 Lite on Bedrock.

AI use: the code, tests and docs were written with Claude Code (Anthropic) under the owner's direction. The narration is an AI voice (Amazon Polly, generative "Matthew"); the background music was generated with Google Lyria (Gemini). The title and diagram slides are HTML animations; the Claude Code scene is a replay of a real run (text unchanged, shortened). No AI-generated video footage is used.

Video: <VIDEO_URL>
Demo: https://dxhdmlf1bzl03.cloudfront.net/?demo
Code: https://github.com/Raul99Alejandro/why

---

## Devpost story

> Historia del proyecto (menos de ~900 palabras).

### Inspiration

Most decisions in a small software project are made out loud and never reach a document. A week later the code shows *what* changed but not *why*, and an old decision gets undone without anyone noticing. Bee already hears those conversations; we wanted it to remember the decisions and speak up when you change your mind.

### What it does

**Try it live, nothing to install:** [the demo](https://dxhdmlf1bzl03.cloudfront.net/?demo) (read-only, no sign-in).

Why reads the owner's real Bee recordings (in Spanish, 3 to 20 October 2026) and writes a daily log in English: each decision, why it was made, a short quote (kept private), pending items and open questions, with up to three public GitHub commits linked to each decision. Four real work days are public in the demo.

- **It filters before it stores.** Bee listens all day, so speech outside work hours is cut off and each work-hours segment gets a work-or-personal check. Personal speech is never stored or analyzed; the page shows only "N personal conversations ignored".
- **It acts inside Bee.** When a new decision directly contradicts an earlier one, Why writes a Bee todo ("You changed your mind about X: old -> new. Confirm?") with an alarm 10 minutes later, and the page shows a **Changed** badge with the old decision's commits as "work that may need undoing". (None of the published real days contains a change of mind, so this path is shown by tests and approved examples, not by the demo data.) A decision with a concrete next step becomes a Bee todo, which Why completes when a matching public commit lands; the demo's 7 October follow-up is a real todo in the owner's Bee app.
- **You can ask it.** "What did I decide about ...?" by voice or text; the answer cites its decisions, Amazon Polly speaks it, and an unknown topic gets "I couldn't find that", never an invented answer. An Alexa skill, "Why decisions", answers from the public copy.
- **Coding agents can ask it.** Five read-only MCP tools (`why_check_change`, `why_explain_commit`, `why_search`, `why_ask`, `why_open_followups`) let Claude Code or any MCP client check a planned change against past decisions. One command connects to the public demo endpoint; ask it to "build an iOS version of the mobile app" and it answers `conflicts` with the real decision of 20 October to build for Android only, with its reason.

### How we built it

- **Collection on the owner's PC.** Bee's API sits behind a private certificate authority and its token lives in the OS credential store, so a Windows scheduled task runs the `bee` CLI every 5 minutes with a least-privilege IAM user. The Bee token never reaches AWS.
- **Amazon Nova 2 Lite on Bedrock** does every model job: the work filter, extraction with a forced tool call validated by a zod schema, the reversal judge, name review before publishing, and cited answers.
- **Serverless on AWS**, defined in one CDK stack checked by `cdk-nag`: Lambda behind CloudFront, DynamoDB with its own KMS key (raw transcripts expire after 30 days), Cognito with TOTP MFA for the owner, S3, Polly, CloudWatch and SNS. No servers, containers or load balancers.
- **Public by IAM, not just by code.** Only approved days are published, as a filtered copy: emails, phones, card numbers and credential links redacted; names of people, clients and client projects replaced by a role by a model review that fails closed; verbatim quotes never published. The demo, Alexa and MCP functions run under roles that can only read `PUB#` keys.
- **Domain rules as tests.** The work filter, reversal and follow-up rules are approved examples in `domain/` that run in the test suite: 314 tests pass, no AWS needed.

### Challenges we ran into

- A Bee conversation stayed `CAPTURING` for more than 20 hours and kept absorbing new recordings, so "wait until it ends" never fired. We split conversations into sessions at 20-minute gaps and reported it upstream ([bee-cli issue 21](https://github.com/bee-computer/bee-cli/issues/21)).
- `bee todos create` has no idempotency key, so a crash after a create could duplicate an alert. Why saves the todo as "creating" first and adopts a matching todo on the next run.
- The first extraction prompt recorded status updates as decisions; a stricter prompt, a glossary of names and a cap of three commits per decision fixed what the owner's review found.
- CloudFront with origin access control rejects `x-amz-content-sha256` in an origin request policy and overwrites `Authorization`: one failed deploy.
- On Apple Watch, starting to listen sometimes switched back to mute by itself, silently losing capture.
- Our own privacy bug, caught in the preview before anything was published: on real days the batch name review came back cut off or with the texts merged into one, and the old code then kept the texts unchanged. It now works in small batches, falls back to one text at a time, and fails closed; verbatim quotes are no longer published.

### Accomplishments that we're proud of

- It runs on real Bee data every 5 minutes, not on a mocked feed.
- Privacy is enforced by IAM and by a mandatory preview, not by trusting a model.
- It closes the loop inside the app the owner already checks: alerts and follow-ups as Bee todos that close themselves.
- It is honest about its quality. On a **synthetic** bench of 12 invented cases, the agent change check found every conflict (precision 1.00, recall 1.00) with an overall accuracy of 0.83. Extraction accuracy on a real day is **not measured yet**: a local labeling tool and `npm run accuracy` are ready, and no number is claimed until the owner labels a day.

### What we learned

- With an always-on wearable, the filter is the product: what you throw away matters as much as what you keep.
- Make alerts rare: only a direct contradiction is a reversal; a refinement or a repeat is linked without an alert.
- Put the privacy guarantee where a mistake can't undo it: an IAM condition, a second deterministic redaction pass after the model.

### What's next

Label real days and publish the measured accuracy, record a real change of mind for the demo, and move collection to the cloud if Bee offers a stable token and a publicly trusted endpoint.

---

## Built with

> Lista de etiquetas para "Built with".

bee, bee-cli, amazon-bedrock, amazon-nova, aws-lambda, amazon-dynamodb, aws-kms, amazon-cognito, amazon-cloudfront, amazon-s3, amazon-polly, aws-secrets-manager, amazon-cloudwatch, amazon-sns, aws-iam, aws-cdk, cdk-nag, alexa-skills-kit, mcp, typescript, node.js, zod, vite, vitest, claude-code

---

## Additional info

> Información adicional para jueces y organizadores.

### AWS Builder: which AWS services and how

Why runs entirely on AWS in us-east-1, defined in one CDK stack (`infra/lib/why-stack.ts`).

- Amazon Bedrock (Nova 2 Lite, `us.amazon.nova-2-lite-v1:0`): the work-or-personal filter, decision extraction with a forced tool call and zod schema, the reversal judge, name review before publishing, cited answers, and the MCP change check. Every role may invoke only Nova 2 Lite.
- AWS Lambda with Function URLs: a private API, a separate demo function, an Alexa endpoint and an MCP endpoint. The API and demo URLs use `AWS_IAM` auth and accept calls only from our CloudFront distribution through origin access control.
- Amazon DynamoDB with a customer-managed AWS KMS key (rotation on): day logs, the decision ledger with conditional versioned writes (so a Bee todo is never created twice), and raw transcripts with a 30-day TTL.
- IAM as the privacy boundary: the demo, Alexa and MCP roles may only `GetItem`/`Query` keys beginning `PUB#`. The owner's PC syncs with an IAM user limited to the table, its key via DynamoDB, and Nova.
- Amazon Cognito: one owner, self sign-up off, TOTP MFA, code flow with PKCE.
- Amazon CloudFront and Amazon S3: the web page from a private bucket, HTTPS only, security headers.
- Amazon Polly: spoken answers on the page.
- AWS Secrets Manager: generates the origin secret that lets only CloudFront reach the MCP function.
- Amazon CloudWatch and Amazon SNS: logs with ids and counts only (never conversation text), and an alarm that emails the owner on errors.
- AWS CDK with `cdk-nag` (AWS Solutions pack): every accepted finding is suppressed individually with a written reason.

### Open Source

- Project repository URL: https://github.com/Raul99Alejandro/why
- GitHub username: Raul99Alejandro
- Contribution URL: https://github.com/bee-computer/bee-cli/issues/21
- Description: Why is a new open-source project (MIT). Beyond the app, it documents how Bee's CLI and API really behave (`docs/bee-api.md`: commands, observed JSON shapes with invented values, session behaviour, HTTP paths and TLS), ships an Agent Skill (`skills/why/SKILL.md`) and five read-only MCP tools any coding agent can use, and keeps a friction log of 16 entries. The main Bee finding, a conversation that stays `CAPTURING` for 20+ hours and absorbs every new recording, is reported upstream as bee-cli issue 21 with our workaround (split at 20-minute gaps, finish after 30 quiet minutes).

### Feature requests

- Critical: document when a Bee conversation ends, or expose a stable per-recording id and timestamp, so clients don't have to guess session boundaries.
- Important: a client-supplied idempotency key (or external id) on `bee todos create`, so apps can write todos safely under retries.
- Important: a publicly trusted certificate (or a published CA bundle), a REST reference with real paths and the auth header, and the token lifetime and refresh flow, so Bee data can be read server-side.
- Important: on Apple Watch, change the mute state only on an explicit tap and show a clear "not listening" state.
- Nice-to-have: `bee status` should print an account name and use the exit code, not part of the token.

### Friction log (summary; full log with 16 entries in the repo)

Full log: https://github.com/Raul99Alejandro/why/blob/main/friction-log.md

1. Bee CLI, `bee changed` / `bee conversations get`. Task: collect finished conversations and analyze each once. Expected: each recording becomes a conversation that ends. Actual: one conversation stayed `CAPTURING` for more than 20 hours and absorbed every new recording; the first sync saved nothing. Severity: blocker. Workaround: split into sessions at gaps over 20 minutes, finished after 30 quiet minutes. Suggestion: document when a conversation ends or expose per-recording ids (reported as bee-cli issue 21).
2. Bee API, HTTPS. Task: call the Bee API from AWS Lambda. Expected: a publicly trusted certificate. Actual: issued by a private "Bee Intermediate CA"; Node fails with `SELF_SIGNED_CERT_IN_CHAIN`, and the token lifetime and refresh are undocumented. Severity: major (it decided the architecture). Workaround: collect on the owner's PC through the CLI; no Bee secret in AWS. Suggestion: use a public CA or publish the bundle and token behaviour.
3. Bee CLI, `bee todos create`. Task: write one reversal alert or follow-up per decision, never twice. Expected: a safe create under retries. Actual: no idempotency key, so a crash between create and saving the id duplicates the todo. Severity: major. Workaround: save the todo as "creating" first, then list and adopt a match by text on the next run. Suggestion: accept a client idempotency key.
4. Bee on Apple Watch. Task: record work conversations. Expected: one tap starts listening and it stays on. Actual: listening switches back to mute by itself and needs several taps to stay on (seen on the device, not timed). Severity: major for ambient capture. Workaround: tap until it shows listening, check before important conversations. Suggestion: change mute only on an explicit tap and show a clear "not listening" state.
5. Amazon CloudFront with OAC to Lambda Function URLs. Task: let a signed-in browser POST to an IAM-auth Function URL. Expected: forward the token and body-hash headers. Actual: CloudFront rejects `x-amz-content-sha256` in an origin request policy and OAC overwrites `Authorization`; one deploy failed. Severity: major. Workaround: token in `x-why-token`, the page sends the body hash itself. Suggestion: name the rejected and overwritten headers in the OAC guide.

### Feedback Q1: tools, APIs and SDKs used, and for what

- Bee wearable on Apple Watch and the `bee` CLI (`@beeai/cli` 0.7.3, Windows): `bee changed --json` for the incremental feed, `bee conversations get` for utterances, `bee todos create|complete|list --json` for reversal alerts and follow-ups in the owner's Bee app.
- Amazon Bedrock (Nova 2 Lite) via the Converse API with forced tool use: work filter, extraction, reversal judge, name review, cited answers, MCP change check.
- Amazon Polly: spoken answers.
- AWS Lambda, DynamoDB, KMS, Cognito, CloudFront, S3, Secrets Manager, CloudWatch, SNS, IAM and AWS CDK with cdk-nag: the whole serverless product.
- Alexa Skills Kit and the ASK CLI: the "Why decisions" skill, answering from the public copy.
- MCP TypeScript SDK: five read-only tools for coding agents, over stdio locally and over HTTP publicly.
- Claude Code (Anthropic): wrote the code, tests and docs under the owner's direction.

### Feedback Q2: what worked well

- Bee: the cursor feed makes a 5-minute sync cheap; todos let Why act inside the app the owner already checks; the CLI handles login, so no Bee secret reaches the cloud. Todo create, read, complete and delete were verified live.
- Nova 2 Lite: structured output with a forced tool call and schema was dependable, and one model covered every job at a cost and latency that suit per-session calls.
- CDK with cdk-nag: one stack defines the product, and every exception needs a written reason. A demo role that can read only `PUB#` keys is simple and strong isolation.
- DynamoDB conditional writes made the versioned decision ledger easy.

### Feedback Q3: what needs work

- Bee: undocumented session boundaries (a conversation `CAPTURING` for 20+ hours), JSON shapes that differed from our guess, CLI names that don't map to HTTP paths, a private certificate authority, `bee status` printing part of the token, no idempotency key on todos, `shell: true` (and Node's DEP0190 warning) on Windows, and the Apple Watch falling back to mute.
- Bedrock: quality work was ours (status updates read as decisions, names transcribed wrong); examples for decision extraction and non-English input would help.
- Alexa: it cannot sign with IAM, so the Function URL verifies certificate, signature, timestamp and skill id itself; the 8-second limit is tight for a certificate fetch plus a model call. The skill was tested in the developer console simulator on 6 October (launch and a verified request); its answers come from the published copy.
- CloudFront and Cognito: OAC header rules with Function URL POSTs, and a dependency cycle for the Cognito callback URL, each cost a failed deploy. Expired SSO sessions blocked later deploys.

### Feedback Q4: onboarding

- Bee CLI: easy to start; but a finished conversation wasn't visible on day one, so we recorded every real shape ourselves in `docs/bee-api.md`.
- Bedrock: the Converse API with tool configuration was straightforward.
- AWS services: each is well documented alone; the CloudFront + OAC + Function URL + Cognito combination was learned by failing.
- Alexa: request-verification rules are documented but spread over several pages.

### Feedback Q5: would you build with these again?

Yes. Ambient capture plus todos in the same app is a strong base for software that acts on what you said, not just records it: Why alerts you inside Bee when you change your mind and closes follow-ups when the work lands. Nova 2 Lite on Bedrock made structured extraction from Spanish speech cheap and dependable, and a serverless CDK stack gave us a private-plus-public product with no server to run. Clear session boundaries and idempotent todos from Bee would make the next one much easier.

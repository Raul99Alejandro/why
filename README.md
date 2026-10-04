# Why

**Bee turns your work sessions into a visual log of decisions: what you decided, why, and what is still open. Ask it "why did I decide that?" and it answers out loud.**

Why listens (through a [Bee](https://bee.computer) wearable) to the owner's real working conversations, in Spanish, and writes a daily log in English: each decision, the reason behind it, a short quote, the to-dos and the open questions, linked to the public GitHub commits that followed. It is fully serverless on AWS. Built for the Bee track of *Build, Ship, Shape: Amazon Developer Hackathon* (2026).

## For judges

### Try the live demo, nothing to install

**[Open the demo](https://dxhdmlf1bzl03.cloudfront.net/?demo)** (read-only, no sign-in).

What to try:

- Open a day from the list and read its decisions, reasons, pending items and linked commits.
- Ask by voice (microphone button) or by typing, for example **"What did I decide about ...?"** with a topic you saw in the list. The answer cites the decisions it came from, and Amazon Polly speaks it.
- Ask something that is not in the log. It says "I couldn't find that in your log." instead of inventing an answer.

What is real and what is filtered:

- The data is the owner's **real Bee recordings**, not a script. Nova 2 Lite extracted the log from Spanish speech.
- The demo shows **only days the owner reviewed and published**. Before publishing, the owner previews a filtered copy: emails, phone numbers, card numbers and credential links are redacted, names of other people become a role ("a colleague"), original-language quotes are dropped, and the owner can exclude whole sessions.
- Raw transcripts and unpublished days never reach the demo: it runs on a separate Lambda whose IAM role can read only `PUB#` keys (see [Security](#security-and-privacy)).
- The private site (same URL without `?demo`) is for the owner only: Cognito sign-in with TOTP MFA.

### Run the tests and the mock UI locally

Needs Node.js 24, no AWS account:

```bash
npm ci
npm test              # 151 tests
npm run web:dev       # open http://localhost:5173/?mock and ?mock&demo
```

## How it works

```
 Bee (Apple Watch)
        |  recordings
        v
 `bee` CLI on the owner's PC  --every 30 min-->  sessions (split at >20 min gaps,
        |                                         finished after 30 min quiet)
        v
 Amazon Bedrock: Nova 2 Lite  (forced tool call + zod schema)
        |  decisions, why, quotes, pending, open questions (English)
        v
 day log + public GitHub commits (<= 3 per decision)
        v
 DynamoDB (own KMS key; raw transcript expires in 30 days)
        |                                   
        +--> private page  (CloudFront + S3, Cognito + MFA, Lambda API)
        |        owner previews, approves
        v
 filtered copy (PUB#)  --->  demo page  (separate read-only Lambda; Ask + Polly)
```

- **Collect on the owner's PC.** Bee's API uses a private certificate authority and the token lives in the OS credential store, so the collector (`src/collect.ts`, `src/cli/sync.ts`) runs locally with the `bee` CLI. A Windows scheduled task runs it every 30 minutes with a least-privilege IAM user. The Bee token never reaches AWS.
- **Sessions.** Each conversation is cut into sessions at pauses longer than 20 minutes; a session is processed once it has been quiet for 30 minutes.
- **Analyze.** Amazon Nova 2 Lite on Bedrock reads one session with forced tool use; the reply must pass a zod schema (retried once). It returns decisions, the reason for each, a short quote, pending items and open questions, in English, from Spanish speech (`src/analyze.ts`).
- **Compile and link.** Sessions are merged into a day log (`src/compile.ts`) and each decision is linked to up to three public GitHub commits from that time window (`src/github.ts`).
- **Store.** DynamoDB with a customer-managed KMS key. Raw utterances carry a 30-day TTL; the log keeps only extracted decisions, reasons and short quotes.
- **Review and publish.** The owner previews and approves a filtered copy: deterministic redaction, a model review that replaces names, then a second deterministic pass (`src/redact.ts`, `src/publish.ts`).
- **Ask.** The demo and the private page search the log and answer through Nova with citations; any answer without a valid citation is replaced by a fallback. Polly voices the reply (`src/ask.ts`, `src/speech.ts`).

## Security and privacy

The data is a person's spoken conversations, so the design starts from the worst leak. Highlights:

- **Owner-only private site.** One Cognito user, self sign-up off, TOTP MFA required, OAuth code flow with PKCE; every private route verifies the id token.
- **Demo isolation by IAM, not just code.** A separate Lambda role may only `GetItem`/`Query` keys beginning `PUB#`, so it cannot read a private day even if the code were wrong. A private day and a missing day return the same 404.
- **Secrets stay local.** The Bee token never leaves the owner's PC. The sync IAM user can touch only the table, its key (via DynamoDB) and Nova; its access key sits in a local profile and can be revoked.
- **Encryption and transport.** Own KMS key with rotation, HTTPS only, private S3 bucket behind CloudFront OAC, Function URLs with `AWS_IAM` reachable only through the distribution.
- **Personal data.** Three-step publish gate with a mandatory preview; the guarantee never depends on the model.
- **Prompt injection.** Transcript, question and log are treated as data; the model has no actions (one forced tool, or answer plus citations); wrapper tags are neutralised; citations are validated; the page escapes all text.
- **No text in logs, cost capped.** Logs carry ids, counts and timings only. The demo has a per-IP and daily limiter (best effort; no WAF, a known gap).
- **Guard rails in the build.** `cdk-nag` (AWS Solutions pack) runs on the stack and every accepted finding is suppressed individually with a reason.

Full threat model, each control with the code that implements it and the test that proves it: **[docs/security.md](docs/security.md)**. How Bee's API behaves, as investigated for this project: [docs/bee-api.md](docs/bee-api.md).

## Evidence

What exists today:

- Test suite: **151 tests** in 17 files, passing (`npx vitest run`), covering the analyzer, redaction, publishing, the API, the CDK stack's IAM and CloudFront settings, and the web renderer.
- Security document with a test named for every control: [docs/security.md](docs/security.md).
- `cdk-nag` AWS Solutions checks run on every synth; the stack synthesizes clean, with each suppression justified in `infra/lib/why-stack.ts`.
- A `test/security.test.ts` that scans the source and fails if a log call could carry conversation text or if real data is committed.

Reliability battery (`npm run battery`, results to `docs/evidence/battery.json`): **coming**. No numbers are claimed until it has run.

## Built with

- **Wearable:** Bee (Apple Watch), read through the `bee` CLI.
- **AI:** Amazon Bedrock with Amazon Nova 2 Lite (extraction, name review, Ask); Amazon Polly (spoken answers).
- **Compute and API:** AWS Lambda (a private API function and a separate demo function), Lambda Function URLs with `AWS_IAM` auth via CloudFront origin access control.
- **Data and keys:** Amazon DynamoDB with TTL, AWS KMS (customer-managed key).
- **Identity:** Amazon Cognito (user pool, TOTP MFA, PKCE).
- **Delivery:** Amazon CloudFront, Amazon S3.
- **Operations:** Amazon CloudWatch alarm and Amazon SNS email on errors.
- **Infrastructure as code:** AWS CDK (TypeScript) with `cdk-nag`.
- **Code:** TypeScript on Node.js 24, zod, aws-jwt-verify, Vite for the web page, Vitest.

No servers, containers, load balancers or NAT gateways.

## Run it yourself

Prerequisites: Node.js 24+, an AWS account with Bedrock access to Nova 2 Lite in `us-east-1`, AWS CDK bootstrapped there, AWS CLI credentials for deploying, and the Bee CLI (`@beeai/cli`) signed in on the PC that will sync.

```bash
git clone https://github.com/Raul99Alejandro/why.git && cd why
npm ci
npm test                 # unit and infrastructure tests, no AWS calls
npm run typecheck
npm run web:dev          # local preview with mock data: http://localhost:5173/?mock
```

### Deploy

```bash
npm run web:build        # builds dist-web, which the stack uploads to S3
npm run cdk -- deploy -c ownerEmail=you@example.com -c repos=your-user/repo1,your-user/repo2 \
  --outputs-file cdk-outputs.local.json
```

Context flags:

- `ownerEmail` (required): the one Cognito user, who receives the invite and the alarm email.
- `repos`: public GitHub repositories (`owner/name`, comma separated) to look up commits in.
- `beeMode`: `cli` (default, recommended: sync on your PC) or `http` (token in Secrets Manager; also set `beeBaseUrl`).

Outputs include `SiteUrl`, `DemoUrl` (`SiteUrl?demo`), `UserPoolId`, `ClientId` and `SyncUserName`. Sign in at `SiteUrl`, set a password and enrol your authenticator app (TOTP).

### Owner sync (your PC, `beeMode=cli`)

1. In the IAM console create an access key for the `SyncUserName` user. Save it only in the `why-sync` profile of `~/.aws/credentials`. Never commit it.
2. Run once by hand to check it: `AWS_PROFILE=why-sync TABLE=<table name from cdk-outputs.local.json> npm run sync` (it prints counts only).
3. Register the scheduled task (Windows, PowerShell, as your user): `powershell -File scripts/register-sync-task.ps1`. It runs "Why Bee sync" every 30 minutes while you are logged on and logs counts to `%LOCALAPPDATA%\why\sync.log`. Remove it with `scripts/unregister-sync-task.ps1`.
4. In the private site, review a day, preview the filtered copy, and publish it. Only then does it appear in the demo.

The sync's repo list and time zone are set in `src/cli/sync.ts`; edit them for your own use.

### Teardown

```bash
npm run cdk -- destroy
```

The table, key and bucket are set to be destroyed with the stack. Delete the sync user's access key and the `why-sync` profile, and unregister the scheduled task.

## Project layout

```
src/
  collect.ts, analyze.ts, compile.ts, publish.ts   pipeline: sessions, analysis, day log, publish gate
  redact.ts, untrusted.ts                          redaction and prompt-injection defenses
  ask.ts, speech.ts, nova.ts, github.ts            Ask, Polly, Bedrock client, commit lookup
  api/                                             router, auth, demo rate limits
  bee/                                             Bee sources (CLI, optional HTTP)
  store/                                           DynamoDB and in-memory stores
  handlers/                                        Lambda entry points (api, demo, sync)
  cli/sync.ts                                      the owner's local sync
web/                                               browser UI (Vite, TypeScript), with a mock backend
infra/                                             CDK app and the single stack (+ cdk-nag)
scripts/                                           Windows scheduled-task scripts for the sync
docs/                                              security.md, bee-api.md
test/                                              Vitest suites (unit, store contract, CDK stack, web)
```

## Built for the hackathon

Entry for the **Bee track** of *Build, Ship, Shape: Amazon Developer Hackathon 2026*, built in October 2026 (design on 3 October).

**Built with AI assistance.** The design, code, tests and this documentation were produced with Claude Code (Anthropic) working under the owner's direction, in a test-first workflow with review passes. The owner chose the product, reviewed the results, handles the credentials and the Bee device, and approves every published day.

## License

MIT, see [LICENSE](LICENSE).

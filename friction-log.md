# Friction log

Real problems hit while building Why (3 to 6 October 2026), in the order we met them. Every entry comes from this project's own build ledger and notes (`docs/bee-api.md`, commit history); nothing here is invented. Format: task, steps, expected vs actual, severity, workaround, suggestion.

Severity: **blocker** (stopped us until we changed the design), **major** (cost hours or forced a redesign of one part), **minor** (small cost, easy workaround).

## Bee (CLI and API)

### 1. A Bee conversation stays CAPTURING for hours and keeps growing

- **Task:** Collect finished conversations and analyze them once.
- **Steps:** Poll `bee changed --json`, wait for a conversation whose `state` is not `CAPTURING`, then fetch it with `bee conversations get`.
- **Expected:** Each recording session becomes its own conversation that ends.
- **Actual:** One conversation stayed `CAPTURING` for more than 20 hours and every new recording was appended to it (11 utterances over two days). Waiting for it to finish never fired, so the first sync saved nothing ("saved 0, waiting 1").
- **Severity:** blocker for the first design.
- **Workaround:** We split a conversation into sessions at pauses longer than 20 minutes and treat a session as finished when its last utterance is more than 30 minutes old (`splitSessions`, session id = conversation id plus first-utterance epoch).
- **Suggestion:** Document when a conversation ends (silence timeout, device, time), or expose a stable per-recording id and timestamp so clients do not have to guess session boundaries.
- **Upstream:** reported to Bee as [bee-computer/bee-cli issue 21](https://github.com/bee-computer/bee-cli/issues/21).

### 2. The documented shape and the real JSON differed

- **Task:** Parse a conversation with its utterances.
- **Steps:** Implement the collector from the plan, then compare with real `--json` output.
- **Expected:** Utterances at the top of the conversation object.
- **Actual:** They live under `transcriptions[].utterances`; the change feed is `meta.next_cursor`; a finished conversation (populated `end_time`, summaries) was not observable on day one because the only conversation was still capturing.
- **Severity:** minor.
- **Workaround:** The parser follows what we observed and accepts a flat `utterances` array too; `docs/bee-api.md` records every shape with invented values.
- **Suggestion:** Publish JSON schemas or a sample payload per command, including a finished conversation.

### 3. CLI command names do not map to the HTTP paths

- **Task:** Decide whether a Lambda could call Bee directly.
- **Steps:** Run `bee proxy` and call `/v1/*` paths that mirror the CLI commands.
- **Expected:** `bee changed` is `/v1/changed`, and the transcript command is a path.
- **Actual:** `/v1/changed` and `/v1/conversations/<id>/transcript` return 404; the feed is `/v1/changes` and the CLI composes the transcript itself. The auth scheme for direct calls is not documented (a made-up bearer token gets 401, which proves nothing).
- **Severity:** minor.
- **Workaround:** We shell out to the CLI.
- **Suggestion:** A short REST reference that lists real paths and the auth header.

### 4. The API is behind a private certificate authority

- **Task:** Call the Bee API from AWS Lambda.
- **Steps:** `curl` and Node against `https://app-api-developer.ce.bee.amazon.dev/`.
- **Expected:** A publicly trusted certificate.
- **Actual:** The certificate is issued by "Bee Intermediate CA" (O=Bee), which is not in public trust stores: curl reports an untrusted root and Node fails with `SELF_SIGNED_CERT_IN_CHAIN`. The token lifetime and any refresh flow are unknown.
- **Severity:** major (it decided the architecture).
- **Workaround:** Collection runs on the owner's PC through the CLI, which handles trust itself; no Bee secret is stored in AWS. An `http` mode exists but is unverified.
- **Suggestion:** Use a public CA, or publish the CA bundle and the token lifetime and refresh behaviour for server-side clients.

### 5. `bee status` prints part of the token

- **Task:** Check that the CLI is signed in from a script.
- **Steps:** Run `bee status`.
- **Expected:** A signed-in or not result.
- **Actual:** Output includes a truncated `eyJ...` token fragment, so the command cannot be logged or pasted into a report safely.
- **Severity:** minor.
- **Workaround:** We never log its output and deliberately never read the token during the investigation.
- **Suggestion:** Print an account name and a status code only, and use the exit code for scripts.

### 6. Bee todos have no idempotency key, and `create` can succeed before we save the id

- **Task:** Write one reversal alert or follow-up per decision, never twice.
- **Steps:** `bee todos create --text ... --alarm-at ... --json`, then store the returned id.
- **Expected:** A way to create a todo safely under retries.
- **Actual:** There is no client key. A crash between a successful create and saving its id would duplicate the todo on the next run. The create reply must be parsed for `{ todo: { id } }`, and a lost reply looks like a failure.
- **Severity:** major (it shaped the ledger design).
- **Workaround:** We save the todo text as state `creating` first; the next run lists todos (`bee todos list --limit 100 --json`), adopts a match by normalized text and creates only when none matches. Verified live with a throwaway todo created, read, completed and deleted.
- **Suggestion:** Accept a client-supplied idempotency key or an external id on `todos create`.

### 7. Windows specifics for the CLI

- **Task:** Run the CLI from Node on Windows, scheduled every 5 minutes.
- **Steps:** Call `bee` with `execFile`.
- **Expected:** The same behaviour as on macOS or Linux.
- **Actual:** We needed `execFile` with `shell: true` on win32, which makes Node print the `DEP0190` deprecation warning on every sync. The investigation was done on Windows with `@beeai/cli` 0.7.3, and our notes record no Windows guidance for scripting it.
- **Severity:** minor.
- **Workaround:** Accepted the warning; the scheduled-task script logs counts only.
- **Suggestion:** Ship a native `.exe` shim or document how to spawn the CLI from Node on Windows.

## AWS: CloudFront, Lambda, Cognito, CDK

### 8. CloudFront rejects `x-amz-content-sha256` in an origin request policy

- **Task:** Let a signed-in browser POST through CloudFront (with origin access control) to a Lambda Function URL that uses IAM auth.
- **Steps:** Put the token and `x-amz-content-sha256` in the origin request policy, deploy.
- **Expected:** The headers are forwarded.
- **Actual:** Deploy 1 failed: CloudFront does not allow that header in an origin request policy. Separately, OAC signs with SigV4 and overwrites `Authorization`, so a bearer token cannot travel in that header, and POST bodies need a body hash from the viewer.
- **Severity:** major (one failed deploy and a design change).
- **Workaround:** The token travels in `x-why-token`; the web page sends `x-amz-content-sha256` itself (hex SHA-256 of the body); the policy allow-lists only `x-why-token` and `content-type`; a test bans `Authorization`, `Host` and `X-Amz-*` there.
- **Suggestion:** Name this in the OAC with Lambda Function URL guide: which headers are rejected, which are overwritten, and that POST needs the viewer's body hash.

### 9. The Cognito callback URL creates a circular dependency

- **Task:** Create the user pool client with the CloudFront URL as its callback.
- **Steps:** Reference the distribution domain from the client, the client from the Lambda environment and the Lambda from the distribution.
- **Expected:** CDK resolves it.
- **Actual:** The graph is a cycle (client, distribution, URL, environment). Deploy 2 then failed again in the custom resource that sets the callback afterwards (wrong SDK package name for the Cognito client and the wrong IAM action). The failed deploy left an S3 bucket retained for the owner to delete.
- **Severity:** major (two failed deploys).
- **Workaround:** A custom resource sets the callback after the distribution exists, using the v3 package name and the right action; it re-runs on client changes.
- **Suggestion:** An L2 option to set callback URLs from a distribution domain, or a documented pattern for this cycle.

### 10. Alexa cannot call an IAM-protected endpoint, so a public Function URL does the verification

- **Task:** Give the Alexa skill an endpoint in the same stack.
- **Steps:** Keep the Function URL on `AWS_IAM` behind CloudFront like the other two.
- **Expected:** Alexa can invoke it.
- **Actual:** Alexa cannot sign requests with IAM. A Lambda ARN endpoint does not expose the HTTP headers that signature verification needs, so the endpoint is a Function URL with auth `NONE`, and the function itself checks the certificate URL and chain, the signature (SHA-256 or SHA-1), a timestamp within 150 seconds and the skill id.
- **Severity:** major (a public endpoint under a "no public Lambda" design).
- **Workaround:** Verification in code with fixtures; a pre-check of the skill id before any certificate fetch; a 60-second negative cache; an empty skill id rejects everything; the role can read only `PUB#` keys.
- **Suggestion:** Offer a built-in verifier for Lambda Function URLs, or pass the signature headers to Lambda ARN endpoints.

### 11. The Alexa 8-second limit against a certificate fetch plus a model call

- **Task:** Answer within Alexa's time limit.
- **Steps:** Fetch the signing certificate, verify, ask Nova, answer.
- **Expected:** Comfortable margin.
- **Actual:** Not measured yet against the real service (only fixture-tested); the budget is tight enough that the handler shares one 7-second deadline between the certificate fetch and the answer and speaks "That is taking too long right now" instead of failing silently.
- **Severity:** minor so far (unverified live).
- **Workaround:** One shared deadline, a cache for the verified chain, an 8-second Lambda timeout.
- **Suggestion:** Document the cold-start and certificate-fetch cost for skills that call a model.

### 12. Expired SSO sessions block deploys and checks

- **Task:** Deploy the stack after the Alexa and reversal changes.
- **Steps:** `cdk deploy` with the SSO profile.
- **Expected:** Deploys.
- **Actual:** "Unable to resolve AWS account" and "Token has expired and refresh failed": the deploys of two tasks waited on a human login, and the Alexa developer CLI token had expired too (dated 1 October).
- **Severity:** minor (a delay, owner step).
- **Workaround:** Code, tests and `cdk synth` with cdk-nag were completed first; the owner refreshes the logins.
- **Suggestion:** Longer SSO session lengths for hackathon accounts, or a clear expiry date in `aws sso login` output.

## Amazon Bedrock (Nova 2 Lite)

### 13. Speech to decisions: status updates and names

- **Task:** Extract decisions from Spanish work speech into English.
- **Steps:** One forced tool call per session with a zod schema.
- **Expected:** Only real decisions.
- **Actual:** The first version recorded status updates as decisions, and the matcher linked all 20 commits of a day to one non-decision. Names in the transcription were often wrong. The owner's review on 4 October listed these content issues.
- **Severity:** major (quality, not an API fault).
- **Workaround:** A stricter analyst prompt (decisions only, with a summary for progress), a glossary of names, and a matcher limited to three commits per decision. The reply must pass the schema (retried once). The tool-call approach itself worked reliably.
- **Suggestion:** Examples of decision-extraction prompts for Nova and guidance on non-English input.

### 14. Untrusted transcripts and prompt injection

- **Task:** Keep a spoken sentence from steering the model.
- **Steps:** Wrap the transcript in a tag and instruct the model.
- **Expected:** A wrapper tag is enough.
- **Actual:** A review found that an utterance containing the closing tag would close the wrapper (`</transcript>`). It was fixed; a later review noted that a spaced variant (`< /transcript`) is still not neutralised, which is logged as a known gap.
- **Severity:** minor (found in review).
- **Workaround:** Tags are neutralised, the model has no actions beyond one forced tool, and answers need valid citations.
- **Suggestion:** Document a recommended wrapper pattern for untrusted text with forced tool use.

## Process note

Not a tool problem, but real: the shell tool used by our coding agent silently mangled backslashes and `\n` in heredocs, and large heredocs failed to parse several times; we moved edits to a file-write tool. Two of the three improvement tasks recorded it.

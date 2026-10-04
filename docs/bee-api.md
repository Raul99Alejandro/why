# Bee API findings

Investigated on 2026-10-03 with `@beeai/cli` 0.7.3 on Windows, read-only. All example values below are invented.

## Commands we use

All commands print markdown by default; add `--json` for raw JSON.

| Purpose | Command |
| --- | --- |
| Incremental change feed (new and updated conversations, facts, todos, dailies, journals) | `bee changed --json [--cursor <next_cursor>]` |
| List conversations (metadata only, newest first) | `bee conversations list --limit N [--cursor C] --json` |
| One conversation with its utterances | `bee conversations get <id> --json` |
| Just the utterances (supports `--since <epochMs>`) | `bee conversations transcript <id> [--since <epochMs>] --json` |
| Profile and timezone | `bee me --json` |
| Daily summaries | `bee daily list --limit N --json` |
| Auth check | `bee status` (prints a truncated token fragment: do not log its output) |

Sync design: poll `bee changed --json` with the saved `meta.next_cursor`; for each conversation whose `state` is no longer `CAPTURING` (and whose `end_time` is set), fetch it with `conversations get` and process it once.

## JSON shapes

Field names and types as observed; values are made up. Utterance text is never recorded here.

`bee changed --json`:

```json
{
  "meta": { "next_cursor": "abc123", "since": 1790000000000, "until": 1790086400000, "updated": true, "timezone": "America/Mexico_City" },
  "facts": [],
  "todos": [],
  "dailies": [],
  "journals": [],
  "conversations": [
    {
      "id": 1001, "start_time": 1790000000000, "end_time": 1790000600000,
      "device_type": "bee", "summary": null, "short_summary": null,
      "state": "CAPTURING", "created_at": 1790000000000, "updated_at": 1790000300000,
      "transcriptions": [], "suggested_links": [], "primary_location": null
    }
  ]
}
```

`end_time`, `summary`, `short_summary` and `primary_location` were `null` for the live conversation (types when set are not yet observed; assume number for `end_time`, string for the summaries). Arrays other than `conversations` were empty in the sample, so their element shapes are unverified.

`bee conversations list --json`:

```json
{
  "conversations": [
    {
      "id": 1001, "start_time": 1790000000000, "end_time": null,
      "device_type": "bee", "summary": null, "short_summary": null,
      "state": "CAPTURING", "created_at": 1790000000000, "updated_at": 1790000300000,
      "utterances_count": 8, "primary_location": null
    }
  ],
  "next_cursor": null,
  "timezone": "America/Mexico_City"
}
```

`bee conversations get <id> --json` (utterances are nested under `transcriptions`):

```json
{
  "conversation": {
    "id": 1001, "start_time": 1790000000000, "end_time": null, "device_type": "bee",
    "summary": null, "short_summary": null, "state": "CAPTURING",
    "created_at": 1790000000000, "updated_at": 1790000300000,
    "transcriptions": [
      {
        "id": 501, "realtime": true,
        "utterances": [
          { "id": 9001, "realtime": true, "start": 12, "end": 15, "spoken_at": 1790000012000, "text": "example text", "speaker": "speaker_1", "created_at": 1790000015000 }
        ]
      }
    ],
    "suggested_links": [],
    "primary_location": null
  },
  "timezone": "America/Mexico_City"
}
```

`bee conversations transcript <id> --json`:

```json
{
  "conversationId": 1001,
  "transcript": [
    { "id": 9001, "realtime": true, "start": 12, "end": 15, "spoken_at": 1790000012000, "text": "example text", "speaker": "speaker_1", "created_at": 1790000015000 }
  ],
  "note": "string"
}
```

`bee me --json`: `{ "id": 1, "first_name": "Ana", "last_name": "Lopez", "timezone": "America/Mexico_City" }`.

`bee daily list --json`: `{ "daily_summaries": [], "next_cursor": null, "timezone": "..." }`.

Caveat: at investigation time the account had only one conversation and it was still `CAPTURING`, so the shape of a finished conversation (populated `end_time`, `summary`, `short_summary`) is not yet observed. Re-check once the first session has ended.

## HTTP API and auth

- Base URL: `https://app-api-developer.ce.bee.amazon.dev/`, REST under `/v1`.
- `bee proxy` listens locally and forwards `/v1/*` to that base URL, adding the stored credentials itself. Through the proxy (status codes only checked): `GET /v1/me` 200, `/v1/conversations` 200, `/v1/conversations/<id>` 200, `/v1/changes` 200, `/v1/daily` 200. `/v1/changed` and `/v1/conversations/<id>/transcript` are 404, so the CLI names do not map 1:1 to paths (the change feed is `/v1/changes`; the CLI composes the transcript command itself).
- Direct calls without credentials, or with a made-up bearer token, return 401. The README does not document the auth scheme. The CLI stores a JWT-looking token (its own `bee status` shows an `eyJ...` fragment), so `Authorization: Bearer <token>` is likely, but it is unverified: confirming it requires the real token, which this investigation deliberately never read.
- TLS: the API certificate is issued by a private CA ("Bee Intermediate CA", O=Bee). It is not in public trust stores: curl fails with an untrusted-root error and Node fails with `SELF_SIGNED_CERT_IN_CHAIN`. A Lambda calling it directly would need that CA bundled and `NODE_EXTRA_CA_CERTS` set. (The CLI handles this itself.)
- Token lifetime: unknown. Observe for 24 h. The CLI reports no expiry, and there is no documented refresh flow for `--token` logins.
- The CLI offers other server-friendly paths: `bee mcp serve-http` (local, bearer auth with a token you choose) and `bee stream` (SSE, with webhook support). Both still run on the owner's machine.

## Decision

`cli`.

Collection runs on the owner's PC, which shells out to `bee ... --json`, and pushes finished conversations to AWS (the `sync` script). Reasons:

1. A server-side call is not plainly feasible: the bearer scheme is unconfirmed, the token lifetime and refresh behaviour are unknown, and the endpoint uses a private CA that Lambda would not trust without extra work.
2. The owner's login stays in the Windows credential store; no Bee secret has to be stored in AWS.
3. The CLI is the documented, supported interface and survives path changes like `/v1/changes` vs `bee changed`.

Revisit `http` later if a stable token and the bearer scheme are confirmed (a Lambda would then read the token from Secrets Manager and trust the Bee CA).

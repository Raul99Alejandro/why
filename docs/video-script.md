# Why: video (1 min 44 s, final cut of 20 October 2026)

Real product, real data. The file is built in the hackathon hub (`video/why/`, not in this repository): `node render.mjs` assembles real-site takes (`takes.mjs`, Playwright recordings of the public demo), HTML animations and the narration (`voice.mjs`, Amazon Polly). AI use is declared in the YouTube description: the narration is an Amazon Polly voice, the music was generated with Google Lyria, and there is no AI-generated footage.

| # | Time | Shot | Narration (Amazon Polly) |
| --- | --- | --- | --- |
| 1 | 0:00 | Title: "Why? Bee records. Why acts." | "I talk through decisions all day, with Bee on my wrist. A week later, I can't say what I decided, or why. Why fixes that." |
| 2 | 0:09 | How it works: Bee, sync every 5 min with the work filter, Nova 2 Lite on Bedrock, the decision log. | "Every five minutes, Why reads my real Bee recordings, in Spanish, and writes an English decision log on AWS, with Amazon Nova on Bedrock." |
| 3 | 0:18 | The live demo, Tue Oct 20: three real decisions with reasons, pending items, open questions. | "Each decision comes with its reason, the open questions, and the next steps. This is a real day: a client call on October twentieth." |
| 4 | 0:27 | Privacy slide, then the demo: "3 personal conversations ignored", "verbatim quote kept private". | Filter before storage; names of people and clients become roles; quotes stay private. |
| 5 | 0:41 | Replay of the real `bee todos list` output for the follow-up todo Why created on 7 October, then the same follow-up ("Follow-up open") on the demo page. | Follow-ups are Bee todos written by Why and closed by matching commits; reversal alerts arrive the same way. |
| 6 | 0:57 | Replay of a real Claude Code run with the public Why MCP endpoint: "Add an iOS build target to the mobile app." The agent calls `why_check_change`, gets `conflicts` with "Develop the mobile application only for Android" (2026-10-20) and stops to ask. | The agent checks Why before touching code and stops. |
| 7 | 1:14 | The demo's Ask box: "What did I decide about the mobile app?", a cited answer, read aloud by Polly (the real audio from the demo). | Ask with citations; "I couldn't find that" otherwise. |
| 8 | 1:30 | Architecture and the four pillars, the README Verified table, the repo and demo URLs. | Serverless on AWS; IAM keeps the public side on the published copy. |

Not shown live: a reversal alert. None of the published real days contains a change of mind, and the narration says only how alerts arrive, without claiming one on screen. Real-day extraction accuracy is not measured, so the video shows no accuracy number.

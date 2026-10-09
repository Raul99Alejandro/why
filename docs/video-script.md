# Why: video script (2 min 47 s)

Goal: under three minutes, English narration, real data only. Judges see: real Bee data, a reversal alert arriving in Bee, a todo closing on a commit, a coding agent stopped by a past decision, the page, Alexa in the simulator, and the privacy filter.

Before recording (owner): have one real work conversation recorded that contains a decision and, later, a contradicting decision; run the sync; confirm the page shows the "Changed" badge; have the Bee app open on the phone or the Bee desktop view; publish one day so the demo and Alexa have data. Blur or avoid any name that is not yours. Use the demo URL for anything on screen that shows a quote.

| # | Time | Shot | Narration |
| --- | --- | --- | --- |
| 1 | 0:00 - 0:12 | Wearing Bee, talking at the desk; cut to the Bee app showing today's conversation. | "I talk through decisions all day, with Bee on my wrist. Hours later I can't say what I decided, or why. Why fixes that." |
| 2 | 0:12 - 0:30 | Terminal: the 5-minute scheduled sync log line (counts only), then the Why day page with decisions, reasons, quotes and linked commits. Zoom on a decision and its commit. | "Why reads my real Bee recordings every five minutes, in Spanish, and writes an English decision log on AWS with Nova on Bedrock: the decision, the reason, and the commits that followed." |
| 3 | 0:30 - 0:45 | The privacy filter: show the line "N personal conversations ignored", then the redaction preview (names become "a colleague"). | "Bee hears everything, so Why filters before it stores anything. Personal talk is dropped; only a count is kept. Anything public is previewed and redacted first." |
| 4 | 0:45 - 1:12 | Split screen: me saying out loud "Actually, let's use Claude instead of Nova"; then the Bee app on the phone receiving the todo "You changed your mind about the answers model: ... Confirm?". | "Here is where it acts. Earlier I decided to use Nova. Now I contradict myself. Why notices, and writes a todo straight into Bee, with an alarm in ten minutes." |
| 5 | 1:12 - 1:22 | The page: the "Changed" badge, both days linked, and "work that may need undoing" listing the old commits. | "The page shows both decisions and the commits from the old one: the work that may need undoing." |
| 6 | 1:22 - 1:42 | Bee todo list: a follow-up todo is open; in the repo, make a matching commit and push; run or wait for the sync; the todo shows completed in Bee, and the page says "closed by commit". | "Decisions with a concrete next step become todos in Bee as well. When a matching commit lands, Why completes the todo itself. Nobody ticks a box." |
| 7 | 1:42 - 2:07 | Terminal with Claude Code open in the Why repository, connected to the Why MCP server. Type the prompt "switch the answer model to Claude Sonnet". The agent calls `why_check_change`; the result shows "conflicts with the decision of <date>: Use Nova ..." with the reason; the agent stops and asks before editing anything. | "It also works for coding agents. I ask Claude Code to switch the answer model. Before touching code it asks Why, which finds my decision to use Nova, with its date and its reason. The agent stops and asks me first. The log now guards the code." |
| 8 | 2:07 - 2:27 | The Alexa developer console simulator: type or speak "open why decisions", then "what did we decide about the answers model". Show the spoken reply text and the card. | "And I can just ask. This is the Alexa skill in the developer simulator: it answers in two sentences, from the published log, with no device needed." |
| 9 | 2:27 - 2:47 | Architecture slide from the README (Mermaid flow), then the Verified table from the README and the repo URL. | "Everything runs serverless on AWS, and the public agent endpoint can read only the published copy. The README has a Verified table: every claim, how to check it, and the evidence. Why: Bee records. Why acts." |

## Notes for the edit

- Shot 7 was added in the agents release (25 seconds). To stay under three minutes, the other scenes were tightened: shot 3 (privacy filter) lost 10 seconds, shot 5 lost 5, shots 1, 2 and 4 lost 2 or 3 each. Total 2:47. If it still runs long, trim shot 3 first.
- Do not show raw transcripts. Quotes only from the published (redacted) copy.
- Shot 7 uses the demo copy or synthetic decisions only: the decision shown must not be private. Film it against the published log (`npm run mcp -- --demo`, or the `why-demo` server) so what is on screen is already redacted.
- Shot 9: show the Verified table. Show measured-accuracy numbers only if the owner has labeled a day (`npm run accuracy`); otherwise say nothing about precision and recall rather than inventing numbers. The agent check numbers come from a synthetic benchmark and must be called synthetic.
- Shots 4 and 6 need real live events (a real alert arriving, a real todo completing); film them once the redeployed sync has produced them. If an event cannot be shown live, say so in the caption rather than staging it.
- The Alexa shot depends on the owner's deploy steps in the README ("Ask Alexa") being done first.

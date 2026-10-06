# Why: video script (2 min 45 s)

Goal: under three minutes, English narration, real data only. Judges see: real Bee data, a reversal alert arriving in Bee, a todo closing on a commit, the page, Alexa in the simulator, and the privacy filter.

Before recording (owner): have one real work conversation recorded that contains a decision and, later, a contradicting decision; run the sync; confirm the page shows the "Changed" badge; have the Bee app open on the phone or the Bee desktop view; publish one day so the demo and Alexa have data. Blur or avoid any name that is not yours. Use the demo URL for anything on screen that shows a quote.

| # | Time | Shot | Narration |
| --- | --- | --- | --- |
| 1 | 0:00 - 0:15 | Wearing Bee, talking at the desk; cut to the Bee app showing today's conversation. | "I talk through decisions all day, with Bee on my wrist. Hours later I can't say what I decided, or why. Why fixes that." |
| 2 | 0:15 - 0:35 | Terminal: the 5-minute scheduled sync log line (counts only), then the Why day page with decisions, reasons, quotes and linked commits. Zoom on a decision and its commit. | "Why reads my real Bee recordings every five minutes, in Spanish, and writes an English decision log on AWS with Nova on Bedrock: the decision, the reason, a short quote, and the GitHub commits that followed." |
| 3 | 0:35 - 1:00 | The privacy filter: show the line "N personal conversations ignored", then the redaction preview (names become "a colleague"). | "Bee hears everything, so Why filters before it stores anything: work hours plus an AI check. Personal talk is dropped; only a count is kept. Before anything goes public, I preview a copy with names and numbers redacted." |
| 4 | 1:00 - 1:30 | Split screen: me saying out loud "Actually, let's use Claude instead of Nova"; then the Bee app on the phone receiving the todo "You changed your mind about the answers model: ... Confirm?". | "Here is where it acts. Earlier I decided to use Nova. Now I contradict myself. Why notices, and writes a todo straight into Bee, with an alarm in ten minutes." |
| 5 | 1:30 - 1:45 | The page: the "Changed" badge, both days linked, and "work that may need undoing" listing the old commits. | "The page shows both decisions side by side, and the commits from the old one: the work that may need undoing. Only a direct contradiction counts; a refinement is linked quietly." |
| 6 | 1:45 - 2:05 | Bee todo list: a follow-up todo is open; in the repo, make a matching commit and push; run or wait for the sync; the todo shows completed in Bee, and the page says "closed by commit". | "Decisions with a concrete next step become todos in Bee as well. When a matching commit lands, Why completes the todo itself. Nobody ticks a box." |
| 7 | 2:05 - 2:25 | The Alexa developer console simulator: type or speak "open why decisions", then "what did we decide about the answers model". Show the spoken reply text and the card. | "And I can just ask. This is the Alexa skill in the developer simulator: it answers in two sentences, from the published log, with no device needed." |
| 8 | 2:25 - 2:45 | Architecture slide from the README (Mermaid flow), then the measured accuracy table with the owner's numbers and the repo URL. | "Everything runs serverless on AWS, with an IAM role that can't read private days. I measured it against my own labels: precision and recall are in the README. Why: Bee records. Why acts." |

## Notes for the edit

- Total narration is about 330 words, which fits 2:45 at a calm pace; trim shot 3 first if it runs long.
- Do not show raw transcripts. Quotes only from the published (redacted) copy.
- Shot 8 numbers: fill from `npm run accuracy` output after labeling a day; if not measured, drop the sentence about precision and recall rather than inventing numbers.
- Shot 4 and 6 need real live events (a real alert arriving, a real todo completing); film them once the redeployed sync has produced them. If an event cannot be shown live, say so in the caption rather than staging it.
- Alexa shot depends on the owner's deploy steps in the README ("Ask Alexa") being done first.

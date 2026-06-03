# Tour — marketing language

Source of truth for the three locked layers of public copy. When drafting a Show HN post, demo script, blog lead, or any external-facing artifact, copy from here — don't re-derive.

## Tagline

> **Local code review at AI speed.**

Six words. *Local* is the wedge (word one); *code review* anchors the familiar category; *at AI speed* implies the 2026 review bottleneck without spelling it out.

Surfaces: README H1 sub-line, `package.json` description, GitHub repo description, Homebrew formula `desc`.

## Sub-line

> Tour lets your AI leave a walkthrough on its diff as PR-style comments. Reply to the agent's comments, add your own, and jump to your editor in one keystroke.

Two sentences.

- *Tour lets your AI…* — Tour grants the capability; the agent acts. Not "Tour does X." Critical not to oversell agent reliability.
- *Walkthrough as artifact, PR-style comments as form* — honors ADR 0004 (Tour, not Review) while anchoring to the GitHub PR mental model every developer already has.
- *Reply* leads the reader actions because it's the differentiator against difit (which has comments but no AI conversation). Followed by *add your own* (additive authoring) and *jump* (the bridge to action).

Trade-off accepted on 2026-05-29: an earlier draft of this sub-line opened with the asymmetry hook (*"Your AI writes faster than you can review"*) carrying the LinearB review-bottleneck data. We swapped to this Tour-as-enabler version because it's more concrete (names the artifact form and the differentiator) — at the cost of the explicit pain hook. The Show HN campaign line still carries the pain framing.

Surfaces: README, under the tagline. Also useful as the demo video opener, Show HN body lede, and blog lead — since we don't maintain a separate scenario-shaped hero.

## HN campaign line

> Show HN: Tour — your AI ships in minutes; reviews shouldn't take hours.

The one-shot launch hook. Problem-first; carries the productivity paradox without naming the data. Replace at launch time; brand line lives on as the durable identity.

## Vocabulary to avoid

Sourced from CONTEXT.md and earlier iteration history.

- *Annotation* — replaced by **Comment** (ADR 0029).
- *Walkthrough* as the brand frame — retained as a verb only (*"walks through the diff"*).
- *Push back* — too adversarial; use *reply*, *interrogate*, or *ask*.
- *Lines you doubt* — implementation detail; describe outcomes, not mechanisms.
- *Local surface* — jargon; *local* lives in the tagline as a noun, not a product label.
- *All local. No GitHub round-trip.* — over-repeated; *local* is in the tagline, that's sufficient.
- *Review pass* / *review pass on its own code* — drifts back to gatekeeping framing; the artifact is a *walkthrough*.

## Competitive positioning

- **difit** ([yoshiko-pg/difit](https://github.com/yoshiko-pg/difit)) — closest neighbor. Local GitHub-style diff viewer with comments stored in browser localStorage; comments have a "Copy Prompt" button to paste into an AI tool elsewhere. Tour's differentiator: comments are bidirectional (the AI replies inline via the reply-agent loop, ADR 0021) and agent-authored (the AI is the first commenter, not just the recipient). One-line answer if the HN thread asks: *difit is a great local diff viewer with comments you copy out to your AI; Tour is a conversation surface where the AI is on the same diff with you.*
- **GitHub PR review** — the mental model anchor. Tour is "PR review with the AI as the author *and* the counterparty," before a PR exists.
- **Linear Diffs / Guided Reviews** — adjacent. Linear's wedge is *native to the issue tracker*; Tour's wedge is *native to the terminal and editor, agent-agnostic, no SaaS round-trip*.

## Update protocol

When the marketing language changes:

1. Update this file first.
2. Propagate to README, `package.json`, `CONTEXT.md` (line 3), Homebrew formula, GitHub repo description as relevant.
3. Add a CHANGELOG note only if a release ships the language alongside product changes.

## Sources

- [LinearB 2026 productivity analysis](https://www.getpanto.ai/blog/ai-coding-productivity-statistics) — PR review time +91%, AI code waits 4.6× longer for review, developers *feel* 20% faster but are 19% slower.
- [The Review Bottleneck — DEV Community](https://dev.to/code-board/the-review-bottleneck-why-more-ai-code-means-slower-teams-in-2026-1e5n)
- [Code Review Is the New Bottleneck in AI Development — MetaCTO](https://www.metacto.com/blogs/code-review-bottleneck-ai-development)
- [Linear Diffs / Guided Reviews changelog (2026-05-27)](https://linear.app/changelog/2026-05-27-linear-diffs)

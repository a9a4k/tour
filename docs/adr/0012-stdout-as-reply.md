# Stdout-as-reply contract for reply-agent dispatch

> **Supersedes:** the dispatch-mechanism portion of ADR 0010 (bidirectional review via reply-agent + pickup). Everything else in 0010 — the bidirectional pivot itself, the reply-agent vs main-agent split, the no-MCP rejection, the no-resolution-status decision, the no-cross-Tour-Threads stance — stands unchanged. Only the "agent calls `tour annotate` via allow-listed bash" piece is revised here.

ADR 0010 chose a tool-call dispatch mechanism: the reply-agent runs cold, capability-bounded by its CLI's native allow-list (`claude --allowedTools 'Bash(tour annotate:*)'`, codex sandbox, etc.), writes its reply by invoking `tour annotate --as-agent --reply-to <id>`, and exits. The system prompt + the allow/deny pair were jointly the contract.

In practice the contract is fragile in a way that bites silently. The reproduction we have on disk: a human leaves a Reply, the runner spawns claude with the documented flags, claude generates a perfectly good response, but it judges that bare `Bash` in `--disallowedTools` overrides the parameterised `Bash(tour annotate:*)` in `--allowedTools` and decides it doesn't have shell access — so it prints the reply on stdout instead of calling the tool. The runner's `spawn` doesn't capture stdout, the lock is released on clean exit, no Annotation lands. The user sees nothing. No diagnostic, no error, no fallback.

The same failure shape is reachable across all five shipped CLIs: any time a model interprets the allow/deny pair conservatively, the reply is dumped on a discarded pipe. It's intermittent enough to look "mostly works" but frequent enough to silently lose answers — exactly the worst kind of bug.

We invert the contract. The reply-agent has zero tools. Tour spawns the inner CLI in non-interactive print mode (`claude --print`, `codex …`, `gemini -p`, equivalent for opencode/pi), captures stdout verbatim, trims surrounding whitespace, and writes that as the Reply Annotation's body. The system prompt instructs the model that its stdout *is* the reply — no preamble, no narration, no `Reply:` header, no quoting, no closing sign-off. The capability boundary is preserved, strictly stronger than before: the agent literally cannot read, write, edit, or shell out. ADR 0010's pinned-SHA-via-tool-restriction invariant survives by stronger means.

## Decisions

**Zero tools.** The shipped reply-agent receives no `--allowedTools`, no `--disallowedTools`, no equivalent allowlist on any CLI. The only way it can affect the world is by emitting bytes on stdout, which Tour decides what to do with.

**Stdout is the reply, verbatim with trim.** `body = stdout.trim()`. No parsing, no slicing, no sentinel extraction. The contract's correctness rests on the system prompt + the CLI's `--print`/non-interactive mode, both of which are designed for "the buffer is the answer."

**Empty stdout (after trim) → no Annotation, log to stderr.** A model that produces no output violates the "always reply" rule from the system prompt; Tour shouldn't paper over that with a synthetic body. The dispatch concludes, the lock is released, and a clear stderr line names the agent and the failure.

**Non-zero exit code → no Annotation, log to stderr.** Stdout from a crashing run is unreliable. Same handling as the empty case: stderr line, lock released, dispatch concludes.

**Tour writes the Annotation in-process** via `appendAnnotation`, not by shelling out to its own `tour annotate`. The runner already has `tourId`, the triggering Annotation's `id`, the agent's name, and the captured stdout — there is no value in an extra subprocess. ADR 0002's "CLI is canonical" is about *external* agents driving Tour from outside; Tour's own internals can call its own functions.

**System prompt is reframed around the output contract.** A new top-level "Output contract" block lands above "capability-bounded," enumerating the failure modes to suppress (`Here's my response:`, narration, quoting, sign-off). The "always reply" and style sections survive. The snapshot test in `tests/core/system-prompt.test.ts` regenerates.

## Considered Options

- **Tool-call dispatch with the existing allow/deny pair** (status quo from ADR 0010). Rejected: the allow/deny ambiguity is the root cause of the silent-discard bug, and patching it would mean either dropping bare `Bash` from `--disallowedTools` (loosens the boundary in a way that's hard to reason about across five different CLIs' permission resolvers) or restructuring the prompt to make tool-call use load-bearing in the model's reasoning. Both paths preserve the basic fragility — the model still has a choice between tool-call and stdout, and the failure when it picks wrong is silent.

- **Stdout-as-reply as a fallback when the tool isn't called** (tool-call primary, stdout secondary). Rejected: doubles the contract surface — system prompt has to explain both paths, the runner has to handle both, the per-agent argv keeps the allowlist. Pre-1.0 we have no users to be backwards-compatible for, and the fallback path is exactly the buggy one we're trying to delete.

- **Stdout-as-reply with explicit sentinel parsing** (`<reply>...</reply>` tags, last-fenced-block extraction, frontmatter delimiters, etc.). Rejected: trades the "model emits preamble → ugly body" failure mode (visible, recoverable) for "model forgets the tag → empty body" (also visible, but a *new* class of bug). The CLIs' `--print` modes already suppress chain-of-thought by default, so the benefit a sentinel buys (allowing the model to think out loud) isn't a benefit we need. Reachable later if model output drifts and prompt discipline alone stops being enough.

- **Stdout-as-reply, verbatim with trim** (chosen). The simplest contract that produces clean output: capture, trim trailing whitespace, write. The preamble-failure mode is contained by the system prompt; the empty/exit failure modes surface visibly via stderr. No parser, no sentinel, no fallback path.

- **Long-running daemon that holds an Agent SDK session and writes via SDK calls** (Path 3 from ADR 0010). Rejected for the same reason it was rejected then: operational cost of managing a daemon outweighs the session-context-carries-across-replies benefit for MVP. Independent of dispatch mechanism — could in principle be revisited under stdout-as-reply too, but doesn't change the trade-off here.

## Consequences

- **ADR 0010's tool-call paragraph is superseded.** The "agent runs cold each time, capability-bounded by its CLI's native allow-list, writes its reply via `tour annotate`, exits" sentence and the "Capability-bounding to `tour annotate --as-agent --reply-to` is enforced by each adapter through its agent's native allow-list" sentence both no longer describe the system. ADR 0010 gains a one-line header note pointing here.

- **Per-shipped-agent argv collapses.** Each shipped CLI now needs only its non-interactive mode flag (`--print` for claude, equivalent for codex/gemini/opencode/pi), the system prompt, and the user prompt. No `--allowedTools`, no `--disallowedTools`, no per-CLI allowlist combinatorics. Each agent's TS module under `src/agents/` shrinks to roughly half its current size.

- **`tour reply-system-prompt` CLI command is deleted.** It existed solely as a fetch channel for shell adapters to obtain the canonical system prompt. With Tour spawning the CLI directly and passing the prompt as a flag value built in-process, no external consumer remains.

- **`tour annotate --as-agent` survives but Tour itself stops calling it.** The CLI surface stays available for external automation (CI hooks, scripts, manual recovery flows like the one we just used to rescue a lost reply). Tour's runner writes via `appendAnnotation` directly. Humans continue to author via UI/CLI as today.

- **System prompt is rewritten and snapshot regenerated.** The new prompt is ~25% shorter and reframed. The snapshot test continues to lock the canonical text; one assertion swaps from "contains the always-reply guidance" to "contains the output contract."

- **The capability boundary is strictly stronger.** Today's reply-agent has *one* allowed tool that the model may or may not use; tomorrow's has *zero* tools and the spawn surface is reduced to "produce text." ADR 0003's pinned-SHA invariant + ADR 0010's "code changes happen outside the conversation" both hold by stronger means.

- **A new failure mode appears: model emits preamble.** If the model writes "Sure! Here's my response:" before the body, Tour writes that as part of the body. The failure is *visible* (a malformed Annotation in the UI) and *recoverable* (the user can edit `annotations.jsonl` or re-prompt). This is strictly better than today's *silent* failure mode where the reply is discarded with no surface. Mitigation lives entirely in the system prompt's explicit no-preamble checklist.

- **Issue #88 (drop shell-script adapter contract) absorbs this change.** The agent brief is revised so the TS migration ships with the new contract from day one — the shipped agents never carry the allowlist code. Doing this in two passes (drop allowlist → port to TS) would touch every shell script twice for no gain.

- **Reversibility.** Reverting to tool-call dispatch is mechanical: re-add `--allowedTools "Bash(tour annotate:*)"` + `--disallowedTools "Edit Write Bash"` to each agent's argv, restore the tool-call language in the system prompt, drop the runner's stdout-capture branch. The `tour reply-system-prompt` deletion is the only non-trivial revert (it would need to be re-added). Pre-1.0 the cost is small; the bug class we're escaping is bigger.

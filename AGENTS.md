# Tour

## Behavioural guidelines

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```text
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## Biases

### Explanation Biases

- Prefer concrete, visual explanations over prose-only explanations when they improve understanding: code sketches, before/after snippets, Mermaid diagrams, tables, dependency maps, and small workflow graphs.
- Show the main moving parts directly when discussing plans, reviews, or tradeoffs. Use compact snippets and diagrams to make the reasoning inspectable.

### Architecture Biases

- Small interfaces, deep modules. Expose narrow APIs; hide complexity behind them.
- Validate at boundaries. Reject invalid input at API, DB, and integration edges.
- Name things by domain, not implementation. Prefer domain terms over technical placeholders.
- Co-locate what changes together. Organize by feature and reason to change.
- Screaming Architecture. Let the structure reflect the product before the framework.

### Testing Biases

- New behavior ships with tests.
- Test observable behavior, not implementation details.
- Refactors preserve behavior. Update tests only when behavior changes.
- Prefer the fastest test that gives confidence. Use integration tests when behavior crosses boundaries.

## References

- Issue tracker: `docs/agents/issue-tracker.md`
- Triage labels: `docs/agents/triage-labels.md`
- Domain docs: `docs/agents/domain.md`
- Releasing: `docs/releasing.md`
- Local companion repo paths: `.agents/local-repos.json` (machine-local, ignored). Copy `.agents/local-repos.example.json` to create it, then run `pnpm run doctor`.

# Reply-agent templates supersede shipped adapters

> **Status:** Accepted — 2026-05-28. Supersedes the shipped reply-agent adapter registry from ADR 0012 while preserving the stdout-as-reply capture contract.

Tour no longer maintains per-CLI argv builders for claude, codex, gemini, opencode, or pi. Reply-agent dispatch is configured as a command template string from `--reply-agent` or `reply_agent` in `$TOUR_HOME/config.toml`; the flag wins over config.

Templates are tokenized on whitespace. Placeholder replacement happens inside each argv token, and the substituted value remains one argv element. Tour does not invoke a shell and does not parse shell quotes.

Supported placeholders:

- `{systemPrompt}` — Tour's canonical reply-agent system prompt.
- `{userPrompt}` — the Tour envelope framed as the user prompt.
- `{combinedPrompt}` — `<system>{systemPrompt}</system>` plus the framed user prompt, for CLIs without a separate system-prompt flag.

Validation is strict. Empty templates fail. Unknown placeholders fail case-sensitively and list the valid placeholder set. A reply-agent template must contain at least one supported placeholder; bare names such as `reply_agent = "claude"` fail with the config path, rejected value, placeholder reference, and inline migration examples.

The Reply Comment author is the constant `"agent"` for every dispatch. The concrete CLI identity is recoverable from the per-dispatch log, whose header records the resolved template string.

## Consequences

- Tour ships no `SHIPPED_ADAPTERS` registry and no per-CLI adapter files.
- Adding or tweaking a Reply-agent CLI no longer requires a Tour release.
- The capability boundary is no longer "Tour guarantees zero tools." The user's template decides what the inner CLI can do. Tour's durable contract is stdout capture: clean exit plus non-empty stdout becomes the Reply body; failures are logged and do not write a Reply.
- The footer uses the role label `s: send to agent` instead of interpolating a CLI name or template.

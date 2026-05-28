// The seed file content is composed from three exported pieces so the
// auto-create writer ships the full document and the migration-error
// builders embed just the relevant examples block (issue #467 review:
// dumping the whole 39-line seed in a one-line typo error is verbose).

const SEED_HEADER = `# Tour configuration. Hand-edit; values feed --reply-agent and --editor defaults.
# Run \`tour config show\` to see resolved values and their source.
`;

export const USER_CONFIG_EDITOR_BLOCK = `# --- Editor ---
# A command template with {file} (required) and {line} (optional) placeholders.
# Set editor_terminal = true if your editor runs in the terminal (vim, helix, kak,
# wrappers around them, etc.) — Tour refuses to spawn it from the webapp and uses
# its TUI-aware spawn path from the TUI.
#
# Examples (uncomment one):
# editor = "code -g {file}:{line}"
# editor = "cursor -g {file}:{line}"
# editor = "codium -g {file}:{line}"
# editor = "idea --line {line} {file}"
# editor = "webstorm --line {line} {file}"
# editor = "vim +{line} {file}"
# editor_terminal = true
# editor = "nvim +{line} {file}"
# editor_terminal = true
`;

export const USER_CONFIG_REPLY_AGENT_BLOCK = `# --- Reply agent ---
# A command template Tour spawns to compose a Reply. Placeholders are substituted
# as whole argv tokens (no shell interpolation):
#   {systemPrompt}    Tour's canonical system prompt
#   {userPrompt}      JSON envelope wrapped in a user-prompt frame
#   {combinedPrompt}  systemPrompt + userPrompt concatenated, for CLIs without --system-prompt
#
# Tour captures the agent's stdout as the reply body. Tools (Read, Bash, etc.) let
# the agent explore the codebase before composing — but side effects of tool use
# (file edits, commits) DO land in your working tree. Templates below grant
# read/explore access only; consult your CLI's docs to widen.
#
# Examples (uncomment one):
# reply_agent = "claude --print --allowedTools Read,Grep,Glob,Bash --system-prompt {systemPrompt} {userPrompt}"
# reply_agent = "codex exec --skip-git-repo-check {combinedPrompt}"
# reply_agent = "gemini --prompt {combinedPrompt}"
# reply_agent = "opencode run {combinedPrompt}"
# reply_agent = "pi --print --allowedTools Read,Grep,Glob,Bash --system-prompt {systemPrompt} {userPrompt}"
`;

export const USER_CONFIG_SEED = `${SEED_HEADER}
${USER_CONFIG_EDITOR_BLOCK}
${USER_CONFIG_REPLY_AGENT_BLOCK}`;

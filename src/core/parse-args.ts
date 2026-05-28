// CLI flag scanner — single point of truth for argv → {command,
// positional, flags}. Lifted out of `src/main.ts` for issue #393 so the
// `--flag=value` and `--flag value` forms can be unit-pinned in
// isolation. Both forms round-trip through the same `flags` map, so the
// downstream `flag(flags, "name")` / `boolFlag(flags, "name")` readers
// don't care which form the user typed.
//
// Empty `=` (e.g. `--reply-agent=`) throws at parse time. Without the
// throw, `parseArgs` would silently store `flags["reply-agent"] = ""`
// and `flag(flags, "reply-agent")` would return `""`, which downstream
// validators (e.g. reply-agent template validation) report with confusing
// messages. Failing here keeps the error close to the typo.

export interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  // A leading flag means bare invocation (e.g. `tour --editor <cmd>`):
  // smart-default surface with flags applied. `--help` / `-h` /
  // `--version` / `-v` are kept as command-name aliases so the existing
  // help/version exit paths in main.ts's switch keep working.
  const first = args[0];
  const helpVersion =
    first === "--help" ||
    first === "-h" ||
    first === "--version" ||
    first === "-v";
  const treatAsBare =
    first !== undefined && first.startsWith("-") && !helpVersion;
  const command = treatAsBare ? "" : (first ?? "");
  const startIdx = treatAsBare ? 0 : 1;

  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = startIdx; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const body = arg.slice(2);
      const eqIdx = body.indexOf("=");
      if (eqIdx !== -1) {
        // `--flag=value` form. Only the first `=` splits, so values
        // containing `=` round-trip verbatim (e.g. `--body=a=b=c`).
        const key = body.slice(0, eqIdx);
        const value = body.slice(eqIdx + 1);
        if (value === "") {
          throw new Error(
            `missing value for \`--${key}\` (use \`--${key}=<value>\` or \`--${key} <value>\`)`,
          );
        }
        // `--flag=true` / `--flag=false` coerce to booleans so the
        // `boolFlag` reader keeps working when users prefer the `=` form
        // for a boolean (e.g. `--open=true`).
        if (value === "true") flags[key] = true;
        else if (value === "false") flags[key] = false;
        else flags[key] = value;
      } else {
        // `--flag value` (consume next token) or `--flag` (boolean).
        const key = body;
        const next = args[i + 1];
        if (next && !next.startsWith("--")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, flags };
}

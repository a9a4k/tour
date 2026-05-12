import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Skill-distribution invariant.
//
// `npx skills add a9a4k/tour` clones the repo and installs every SKILL.md
// discovered in any of the standard discovery paths — UNLESS the skill's
// frontmatter has `metadata.internal: true`, in which case the CLI skips
// it. Verified source-side in the cached vercel-labs/skills `cli.mjs`:
//
//   if (data.metadata?.internal === true
//       && !shouldInstallInternalSkills()
//       && !options?.includeInternal) return null;
//
// Note: the flag must be NESTED under `metadata:` — top-level `internal:`
// is ignored by the CLI. That nesting is preserved by the awk fixer that
// applied this invariant.
//
// We keep a personal skill stack committed under `.agents/skills/` for
// in-repo Claude Code sessions, but only the `tour` skill should be
// distributed to third parties. This test enforces that invariant: every
// skill discovered in any standard path either appears in
// `PUBLIC_SKILLS` (and lacks `metadata.internal: true`) or carries it.
//
// If you add a new internal skill: add the metadata block to its
// frontmatter:
//   metadata:
//     internal: true
// If you add a new publicly-distributed skill: add its `name:` to
// `PUBLIC_SKILLS` below.

const REPO_ROOT = join(import.meta.dirname, "..", "..");

const PUBLIC_SKILLS = new Set(["tour"]);

// Mirror of the discovery paths in vercel-labs/skills' CLI (verified by
// grepping cli.mjs in the cached package: ".agents/skills", ".claude/skills",
// ".cursor/skills", "skills/.curated", "skills/.experimental",
// "skills/.system", plus top-level "skills/").
const DISCOVERY_PATHS = [
  "skills",
  "skills/.curated",
  "skills/.experimental",
  "skills/.system",
  ".agents/skills",
  ".claude/skills",
  ".cursor/skills",
];

interface DiscoveredSkill {
  name: string;
  location: string;
  internal: boolean;
  skillMdPath: string;
}

function parseFrontmatter(content: string, filePath: string): { name: string; metadataInternal: boolean } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error(`No YAML frontmatter found in ${filePath}`);

  let name = "";
  let inMetadata = false;
  let metadataInternal = false;

  for (const line of match[1].split(/\r?\n/)) {
    // Top-level key (no leading whitespace).
    const top = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (top) {
      inMetadata = top[1] === "metadata" && top[2].trim() === "";
      if (top[1] === "name") name = top[2].trim();
      continue;
    }
    // Nested under metadata (2+ spaces of indent).
    if (inMetadata) {
      const nested = line.match(/^\s+([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/);
      if (nested && nested[1] === "internal" && nested[2].trim() === "true") {
        metadataInternal = true;
      }
    }
  }

  return { name, metadataInternal };
}

function discoverSkills(): DiscoveredSkill[] {
  const skills: DiscoveredSkill[] = [];
  for (const discoveryPath of DISCOVERY_PATHS) {
    const fullDir = join(REPO_ROOT, discoveryPath);
    let entries: string[];
    try {
      entries = readdirSync(fullDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      // Skip dot-prefixed entries — discovered separately as their own paths above.
      if (entry.startsWith(".")) continue;
      const skillMdPath = join(fullDir, entry, "SKILL.md");
      try {
        statSync(skillMdPath);
      } catch {
        continue;
      }
      const content = readFileSync(skillMdPath, "utf-8");
      const fm = parseFrontmatter(content, skillMdPath);
      if (fm.name.length === 0) {
        throw new Error(`SKILL.md at ${skillMdPath} has no 'name:' in frontmatter`);
      }
      skills.push({
        name: fm.name,
        location: join(discoveryPath, entry),
        internal: fm.metadataInternal,
        skillMdPath,
      });
    }
  }
  return skills;
}

describe("skill-distribution invariant", () => {
  it("every discovered skill is either in PUBLIC_SKILLS or has metadata.internal: true", () => {
    const skills = discoverSkills();
    expect(skills.length, "no skills discovered — discovery paths probably broken").toBeGreaterThan(0);

    // Dedupe by skill name: symlinks (e.g. .agents/skills/tour -> skills/tour)
    // surface the same SKILL.md under two locations.
    const byName = new Map<string, DiscoveredSkill>();
    for (const s of skills) if (!byName.has(s.name)) byName.set(s.name, s);

    const violations: string[] = [];
    for (const [name, s] of byName) {
      const isPublic = PUBLIC_SKILLS.has(name);
      if (isPublic && s.internal) {
        violations.push(
          `Skill '${name}' (${s.skillMdPath}) is in PUBLIC_SKILLS allowlist but also has 'metadata.internal: true' in frontmatter. ` +
            `Pick one: either remove from PUBLIC_SKILLS, or drop the metadata block.`,
        );
      }
      if (!isPublic && !s.internal) {
        violations.push(
          `Skill '${name}' (${s.skillMdPath}) lacks 'metadata.internal: true' in frontmatter and is not in PUBLIC_SKILLS. ` +
            `Either add 'metadata:\\n  internal: true' to its frontmatter to keep it out of \`npx skills add\` bundles, ` +
            `or add '${name}' to PUBLIC_SKILLS in tests/core/skill-distribution.test.ts for public distribution.`,
        );
      }
    }
    expect(violations, violations.join("\n\n")).toEqual([]);
  });

  it("every entry in PUBLIC_SKILLS resolves to an actual discovered skill (no stale allowlist entries)", () => {
    const discoveredNames = new Set(discoverSkills().map((s) => s.name));
    const stale: string[] = [];
    for (const name of PUBLIC_SKILLS) {
      if (!discoveredNames.has(name)) stale.push(name);
    }
    expect(
      stale,
      `PUBLIC_SKILLS contains entries with no matching skill in any discovery path: ${stale.join(", ")}. ` +
        `Either add the skill, or remove the stale allowlist entry from tests/core/skill-distribution.test.ts.`,
    ).toEqual([]);
  });
});

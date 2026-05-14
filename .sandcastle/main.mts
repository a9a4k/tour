// Parallel-planner-with-review — plan, fan out implement→review, then merge.
//
// Adapted from sandcastle's own self-driving config at sandcastle/.sandcastle/run.ts.
//
//   Phase 1 (Plan):    An orchestrator agent reads open issues, builds a dependency
//                      graph, and emits a <plan> tag with up to N parallelizable
//                      branches.
//   Phase 2 (Execute): Up to MAX_PARALLEL sandboxes run concurrently. Each one runs
//                      an implementer; if it produced commits, a reviewer runs on
//                      the same branch.
//   Phase 3 (Merge):   One agent merges every completed branch into the current
//                      branch and closes the corresponding issues.
//
// Usage:
//   npx tsx .sandcastle/main.mts

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

const execFile = promisify(execFileCb);

const MODEL = "claude-opus-4-7";
const MAX_ITERATIONS = 10;
const MAX_PARALLEL = 4;
const IDLE_TIMEOUT_SECONDS = 1800;

// True if `branch` has commits not yet on `main`. Used to decide whether a
// branch is worth handing to the merger — covers both "implementer made
// commits this iteration" and "fix was already on the branch from a prior
// iteration whose merger never picked it up" (issue: deterministic skip of
// stalled-but-ready branches).
async function branchIsAheadOfMain(branch: string): Promise<boolean> {
  try {
    const { stdout } = await execFile("git", [
      "rev-list",
      "--count",
      `main..${branch}`,
    ]);
    return parseInt(stdout.trim(), 10) > 0;
  } catch (err) {
    console.warn(`  ⚠ couldn't check ${branch} ahead-of-main: ${err}`);
    return false;
  }
}

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
  console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} ===\n`);

  // Phase 1: Plan
  const plan = await sandcastle.run({
    sandbox: docker(),
    name: "Planner",
    agent: sandcastle.claudeCode(MODEL),
    promptFile: "./.sandcastle/plan-prompt.md",
    idleTimeoutSeconds: IDLE_TIMEOUT_SECONDS,
  });

  const planMatch = plan.stdout.match(/<plan>([\s\S]*?)<\/plan>/);
  if (!planMatch) {
    throw new Error(
      "Orchestrator did not produce a <plan> tag.\n\n" + plan.stdout,
    );
  }

  const { issues } = JSON.parse(planMatch[1]) as {
    issues: { number: number; title: string; branch: string }[];
  };

  if (issues.length === 0) {
    console.log("No issues to work on. Exiting.");
    break;
  }

  console.log(
    `Planning complete. ${issues.length} issue(s) to work in parallel:`,
  );
  for (const issue of issues) {
    console.log(`  #${issue.number}: ${issue.title} → ${issue.branch}`);
  }

  // Phase 2: Implement + Review, up to MAX_PARALLEL concurrent
  let running = 0;
  const queue: (() => void)[] = [];
  const acquire = () =>
    running < MAX_PARALLEL
      ? (running++, Promise.resolve())
      : new Promise<void>((resolve) => queue.push(resolve));
  const release = () => {
    running--;
    const next = queue.shift();
    if (next) {
      running++;
      next();
    }
  };

  const settled = await Promise.allSettled(
    issues.map(async (issue) => {
      await acquire();
      try {
        await using sandbox = await sandcastle.createSandbox({
          sandbox: docker(),
          branch: issue.branch,
          copyToWorktree: ["node_modules"],
          idleTimeoutSeconds: IDLE_TIMEOUT_SECONDS,
          hooks: {
            sandbox: {
              onSandboxReady: [{ command: "npm install" }],
            },
          },
        });

        const result = await sandbox.run({
          name: "Implementer #" + issue.number,
          agent: sandcastle.claudeCode(MODEL),
          promptFile: "./.sandcastle/implement-prompt.md",
          idleTimeoutSeconds: IDLE_TIMEOUT_SECONDS,
          promptArgs: {
            ISSUE_NUMBER: String(issue.number),
            ISSUE_TITLE: issue.title,
            BRANCH: issue.branch,
          },
        });

        if (result.commits.length > 0) {
          await sandbox.run({
            name: "Reviewer #" + issue.number,
            agent: sandcastle.claudeCode(MODEL),
            promptFile: "./.sandcastle/review-prompt.md",
            idleTimeoutSeconds: IDLE_TIMEOUT_SECONDS,
            promptArgs: {
              ISSUE_NUMBER: String(issue.number),
              ISSUE_TITLE: issue.title,
              BRANCH: issue.branch,
            },
          });
        }

        return result;
      } finally {
        release();
      }
    }),
  );

  for (const [i, outcome] of settled.entries()) {
    if (outcome.status === "rejected") {
      console.error(
        `  ✗ #${issues[i].number} (${issues[i].branch}) failed: ${outcome.reason}`,
      );
    }
  }

  const fulfilledIssues = settled
    .map((outcome, i) => ({ outcome, issue: issues[i] }))
    .filter((entry) => entry.outcome.status === "fulfilled")
    .map((entry) => entry.issue);

  const aheadFlags = await Promise.all(
    fulfilledIssues.map((issue) => branchIsAheadOfMain(issue.branch)),
  );
  const completedIssues = fulfilledIssues.filter((_, i) => aheadFlags[i]);
  const completedBranches = completedIssues.map((i) => i.branch);

  console.log(
    `\nExecution complete. ${completedBranches.length} branch(es) ahead of main:`,
  );
  for (const branch of completedBranches) {
    console.log(`  ${branch}`);
  }

  if (completedBranches.length === 0) {
    console.log("No branches ahead of main. Nothing to merge.");
    continue;
  }

  // Phase 3: Merge
  await sandcastle.run({
    sandbox: docker(),
    name: "Merger",
    maxIterations: 10,
    agent: sandcastle.claudeCode(MODEL),
    promptFile: "./.sandcastle/merge-prompt.md",
    idleTimeoutSeconds: IDLE_TIMEOUT_SECONDS,
    promptArgs: {
      BRANCHES: completedBranches.map((b) => `- ${b}`).join("\n"),
      ISSUES: completedIssues
        .map((i) => `- #${i.number}: ${i.title}`)
        .join("\n"),
    },
  });

  console.log("\nBranches merged.");
}

console.log("\nAll done.");

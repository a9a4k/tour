# TASK

Merge the following branches into the current branch:

{{BRANCHES}}

For each branch:

1. Run `git merge <branch> --no-edit`
2. If there are merge conflicts, resolve them intelligently by reading both sides and choosing the correct resolution
3. After resolving conflicts, install deps then verify:

   ```sh
   bun install --frozen-lockfile
   bun run typecheck && bun run test
   ```

   Use `--frozen-lockfile` so install can't silently rewrite `bun.lock`. If it fails because `package.json` and the lockfile are out of sync, that's a real bug in the merge: fix it by running `bun install` once and committing the updated lockfile as part of the merge.

4. If tests fail, fix the issues before proceeding to the next branch

If every merge fast-forwarded cleanly and there were no fixes, do NOT create an empty summary commit. Only commit if the merge produced a real merge commit or you applied fixes.

Do not touch parent PRD issues — leave them open.

# CLOSE ISSUES

For each branch that was merged, close its issue. If there are any parent issues (such as PRD's) which closing the issue would complete, close those too.

Here are all the issues:

{{ISSUES}}

Once you've merged everything you can, output <promise>COMPLETE</promise>.

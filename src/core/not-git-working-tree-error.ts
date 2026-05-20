export const NOT_GIT_WORKING_TREE_MESSAGE =
  "tour: not in a git working tree (tour requires git)";

export class NotGitWorkingTreeError extends Error {
  constructor() {
    super(NOT_GIT_WORKING_TREE_MESSAGE);
    this.name = "NotGitWorkingTreeError";
  }
}

export function isNotGitWorkingTreeError(err: unknown): err is NotGitWorkingTreeError {
  return err instanceof NotGitWorkingTreeError;
}

/**
 * Validation errors for the stage format.
 *
 * A stage is authored content, so a bad file should read like a compiler error:
 * the message names every offending field and points at its exact path. The
 * `path` field uses the same dotted/bracketed notation a human would type when
 * describing the JSON (`checkpoints[2].width`), which is what the validator's
 * "corrupt one field" acceptance test asserts against.
 */

export type StageIssueCode =
  | "parse"
  | "type"
  | "required"
  | "range"
  | "enum"
  | "format"
  | "unique"
  | "ordering"
  | "coverage"
  | "version";

export interface StageIssue {
  /** Dotted path to the offending value, e.g. `surfaces[1].to`. */
  path: string;
  code: StageIssueCode;
  /** The value found, for a helpful message. */
  value: unknown;
  /** Human-readable explanation. */
  message: string;
}

export class StageValidationError extends Error {
  readonly issues: StageIssue[];
  readonly source: string;

  constructor(issues: StageIssue[], source = "<stage>") {
    const header =
      issues.length === 1
        ? `Invalid stage '${source}': 1 problem`
        : `Invalid stage '${source}': ${issues.length} problems`;
    const detail = issues
      .map((issue) => `  - ${issue.path}: ${issue.message} (${issue.code})`)
      .join("\n");
    super(`${header}\n${detail}`);
    this.name = "StageValidationError";
    this.issues = issues;
    this.source = source;
    // Restores the prototype chain when compiled down to ES5-ish targets.
    Object.setPrototypeOf(this, StageValidationError.prototype);
  }

  /** The path of the first issue — convenient for single-fault assertions. */
  get path(): string {
    return this.issues[0]?.path ?? "$";
  }

  /** True when an issue exists at exactly the given (dotted) path. */
  has(path: string): boolean {
    return this.issues.some((issue) => issue.path === path);
  }
}

/** Format an issue list for a console/log line. */
export function formatStageError(error: unknown): string {
  if (error instanceof StageValidationError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

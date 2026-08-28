/**
 * Public CLI error surface — B17 module split (promotion guide §11.3 "CLI
 * safety/config").
 *
 * Explicit {@link PublicCliError} messages reach the user verbatim (with a
 * chosen exit code); ANY other thrown value maps to a generic message so
 * internal details — paths, secrets, stack fragments — can never leak through
 * CLI error output (R6/R7 discipline applied to the error channel).
 */

/** A user-facing CLI failure. The message is safe to print verbatim. */
export class PublicCliError extends Error {
  /** Process exit code the CLI should use for this failure. */
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'PublicCliError';
    this.exitCode = exitCode;
  }
}

/**
 * Maps any thrown value to a message that is safe to print.
 * Foreign errors are collapsed to a generic string — their original message
 * may carry internals that must not leak.
 */
export function toPublicMessage(error: unknown): string {
  if (error instanceof PublicCliError) return error.message;
  return 'Unexpected error occurred.';
}

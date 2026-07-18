import { createInterface } from 'node:readline';

/**
 * Confirmation result types.
 */
export type ConfirmResult = 'yes' | 'no' | 'aborted';

/**
 * Options for {@link confirmAction}.
 */
export interface ConfirmOptions {
  /** The high-risk action being requested (e.g., "Write project config") */
  action: string;
  /** Additional details about what will happen (e.g., file path) */
  details: string;
  /** Custom prompt text (defaults to "Proceed? [y/N]") */
  prompt?: string;
  /**
   * Force non-interactive mode (default deny).
   * Set to false to allow the user to override with process.stdin.isTTY check.
   */
  interactive?: boolean;
}

/**
 * High-risk action confirmation prompt (US-18.3 AC2/AC3).
 *
 * In TTY mode: displays the action details and waits for user input.
 * In non-TTY mode: defaults to deny.
 *
 * This is a lightweight confirmation framework. The full PermissionEngine
 * (allow/ask/deny + rule memory) is implemented in task 3.3.
 *
 * US-18.3 AC2: writing project-level config, storing credentials, saving flows,
 *               generating test drafts all require user confirmation.
 * US-18.3 AC3: all high-risk operations require secondary confirmation.
 */
export async function confirmAction(options: ConfirmOptions): Promise<ConfirmResult> {
  const isTTY =
    options.interactive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true);

  if (!isTTY) {
    // Non-interactive: default deny (R7)
    return 'no';
  }

  const prompt = options.prompt ?? 'Proceed? [y/N]';
  const fullPrompt = `\n  !! HIGH-RISK ACTION: ${options.action}\n  -> ${options.details}\n\n  ${prompt} `;

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(fullPrompt, (line: string) => {
        resolve(line.trim().toLowerCase());
      });
    });

    if (answer === 'y' || answer === 'yes') {
      return 'yes';
    }
    if (answer === 'n' || answer === 'no' || answer === '') {
      return 'no';
    }
    // Unexpected input — treat as no (safety default)
    process.stderr.write(`  Unrecognized input "${answer}" — defaulting to no.\n`);
    return 'no';
  } catch {
    return 'aborted';
  } finally {
    rl.close();
  }
}

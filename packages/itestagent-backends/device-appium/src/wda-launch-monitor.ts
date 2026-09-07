import type { ReadableStreamDefaultReader } from 'node:stream/web';
import type { Subprocess } from 'bun';

/** Safe diagnostics: never include a raw process-output tail in an error. */
export class WdaReadinessError extends Error {
  readonly stage: 'wda_launch' | 'wda_status';

  constructor(
    readonly failureCode:
      | 'wda_signing_or_configuration_failed'
      | 'wda_launch_failed'
      | 'wda_status_failed',
    message: string,
  ) {
    super(message);
    this.name = 'WdaReadinessError';
    this.stage = failureCode === 'wda_status_failed' ? 'wda_status' : 'wda_launch';
  }
}

/**
 * Drain both launch pipes while retaining only a bounded recognition window and
 * allowlisted facts. No raw Xcode output, paths, identities, or tokens escape.
 */
export class WdaLaunchMonitor {
  private readonly controller = new AbortController();
  private readonly readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
  private expiredProfile = false;
  private signingFailure = false;
  private installFailure = false;
  readonly exited: Promise<void>;

  constructor(private readonly process: Subprocess<'ignore', 'pipe', 'pipe'>) {
    const drained = Promise.all([this.drain(process.stdout), this.drain(process.stderr)]);
    this.exited = process.exited.then(
      (code) => this.recordExit(code, drained),
      () => this.recordExit(null, drained),
    );
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  async throwIfExited(): Promise<void> {
    // The process may already be gone before the caller starts polling.
    if (this.process.exitCode !== null) await this.exited;
    this.signal.throwIfAborted();
  }

  dispose(): void {
    this.controller.abort(new Error('WDA readiness check cancelled'));
    this.cancelReaders();
  }

  private async drain(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    this.readers.push(reader);
    const decoder = new TextDecoder();
    let window = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        // A single pipe chunk can be large; recognition memory stays bounded.
        for (let offset = 0; offset < value.length; offset += 2048) {
          window = (
            window + decoder.decode(value.subarray(offset, offset + 2048), { stream: true })
          ).slice(-4096);
          this.expiredProfile ||= /\bprovisioning profile (?:has expired|is expired)\b/iu.test(
            window,
          );
          this.signingFailure ||=
            /failed to (?:install|verify)[^\r\n]{0,160}profile|provisioning profile[^\r\n]{0,160}(?:invalid|missing|not found)|requires a (?:development team|provisioning profile)|no profiles for|no signing certificate|code\s?sign(?:ing)?[^\r\n]{0,120}(?:failed|error)/iu.test(
              window,
            );
          this.installFailure ||= /unable to install|failed to install/iu.test(window);
        }
      }
    } catch {
      // Pipe cancellation/closure cannot replace the actual launch outcome.
    } finally {
      reader.releaseLock();
    }
  }

  private async recordExit(code: number | null, drained: Promise<unknown>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Capture buffered diagnostics, but do not wait on descendants retaining
      // pipe descriptors after the xcodebuild leader has already exited.
      await Promise.race([
        drained,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 250);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      this.cancelReaders();
    }
    const prefix = `WDA xcodebuild launch exited before readiness (exit code ${code ?? 'unknown'}).`;
    const repair =
      'Rebuild and re-sign WebDriverAgentRunner with a valid provisioning profile, then replace the WDA Runner installation. ' +
      'Re-signing and replacement installation each require explicit confirmation; no automatic repair was performed. ' +
      'After repair, retry the plan to verify WDA /status and the Appium session again.';
    if (this.expiredProfile) {
      this.controller.abort(
        new WdaReadinessError(
          'wda_signing_or_configuration_failed',
          `${prefix} Xcode reports that the WDA provisioning profile has expired. ${repair}`,
        ),
      );
    } else if (this.signingFailure) {
      this.controller.abort(
        new WdaReadinessError(
          'wda_signing_or_configuration_failed',
          `${prefix} Xcode reports a WDA signing or provisioning failure; profile expiration is unverified. ` +
            `Check the signing team and certificate in the WDA Xcode project. ${repair}`,
        ),
      );
    } else {
      this.controller.abort(
        new WdaReadinessError(
          'wda_launch_failed',
          `${prefix} ${this.installFailure ? 'Xcode reports a WDA installation failure. ' : ''}Review the local Xcode test result for the launch cause; raw process output was omitted for privacy. Do not uninstall apps automatically. Retry the plan after resolving the cause; any device replacement requires explicit confirmation.`,
        ),
      );
    }
  }

  private cancelReaders(): void {
    for (const reader of this.readers.splice(0)) {
      void reader.cancel().catch(() => {});
    }
  }
}

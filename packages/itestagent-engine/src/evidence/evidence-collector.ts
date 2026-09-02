/**
 * EvidenceCollector — automatic evidence collection on step failure.
 *
 * Task 4.1: US-13.1 automatic evidence collection.
 *
 * AC1: auto-collect screenshot / video / syslog / crashlog / xcresult / trace on failure
 * AC2: link evidence to specific run step / case
 * AC3: crashlog symbolication via xctrace symbolicate / LLVM crashlog tools
 *
 * Architecture:
 *   - Simulator targets → simctl-based evidence (simctl-evidence.ts)
 *   - Physical targets   → DeviceBackend methods (AppiumDeviceBackend)
 *   - xcresult/trace     → File copy (parsing deferred to 4.2/4.3)
 *   - ArtifactStore       → All artifacts stored via ArtifactStore.put()
 *
 * R5 compliance: every collection attempt is explicit — null means "not collected"
 * with a reason logged to console.warn. No silent degradation.
 *
 * DEF-016 note: Uses console.warn for observability. Structured logger with
 * redaction is deferred (DEF-016) — raw error messages may contain device info
 * but are filtered through redactError-style patterns.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ArtifactRef, ArtifactStore } from 'itestagent-contracts';
import { redactValue } from '../context-builder.js';
import { symbolicateCrashlog } from './crashlog-symbolicator.js';
import {
  simctlCollectCrashLogs,
  simctlCollectSyslog,
  simctlScreenshot,
  simctlStartRecording,
} from './simctl-evidence.js';
import type {
  EvidenceCollectionSummary,
  EvidenceCollectorConfig,
  EvidenceOptions,
  EvidenceResult,
  EvidenceType,
} from './types.js';

// ─── EvidenceCollector ──────────────────────────────────────────

export class EvidenceCollector {
  private readonly config: Required<EvidenceCollectorConfig>;

  constructor(config: EvidenceCollectorConfig = {}) {
    this.config = {
      perEvidenceTimeoutMs: config.perEvidenceTimeoutMs ?? 15000,
      throwOnError: config.throwOnError ?? false,
    };
  }

  /**
   * Collect all applicable evidence types for a failed step.
   *
   * Evidence is collected in parallel for speed:
   *   - screenshot: always collected
   *   - video: only if recordingActive === true
   *   - syslog: always collected
   *   - crashlog: always collected
   *   - xcresult: only if xcresultPath is provided and exists
   *   - trace: only if tracePath is provided and exists
   *
   * Each type is independent — failure of one does not block others.
   *
   * @param artifactStore - ArtifactStore for persisting evidence files.
   * @param options - Collection options (device, step, paths).
   * @returns CollectionSummary with all results and artifacts.
   */
  async collectOnFailure(
    artifactStore: ArtifactStore,
    options: EvidenceOptions,
  ): Promise<EvidenceCollectionSummary> {
    const stepId = options.stepId;
    const results: EvidenceResult[] = [];

    // Build collection promises — all run in parallel
    const collectors: Promise<EvidenceResult>[] = [];

    // Screenshot: always collect
    collectors.push(this.collectScreenshot(artifactStore, options));

    // Video: only if recording is active
    if (options.recordingActive) {
      collectors.push(this.collectVideo(artifactStore, options));
    }

    // Syslog: always collect
    collectors.push(this.collectSyslog(artifactStore, options));

    // Crashlog: always collect
    collectors.push(this.collectCrashlog(artifactStore, options));

    // xcresult: only if path provided and exists
    if (options.xcresultPath && existsSync(options.xcresultPath)) {
      collectors.push(this.collectXcresult(artifactStore, options));
    }

    // Trace: only if path provided and exists
    if (options.tracePath && existsSync(options.tracePath)) {
      collectors.push(this.collectTrace(artifactStore, options));
    }

    // Execute all in parallel
    const settled = await Promise.allSettled(collectors);

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else if (this.config.throwOnError) {
        throw result.reason;
      } else {
        console.warn(
          `[EvidenceCollector] Unexpected error during evidence collection: ${redactValue(result.reason instanceof Error ? result.reason.message : String(result.reason))}`,
        );
      }
    }

    // Summarize
    const artifacts: ArtifactRef[] = [];
    for (const r of results) {
      if (r.collected && r.artifact) {
        artifacts.push(r.artifact);
      }
    }

    return {
      stepId,
      results,
      artifacts,
      collectedCount: results.filter((r) => r.collected).length,
      totalTypes: results.length,
    };
  }

  // ─── Evidence Type Collectors ─────────────────────────

  private async collectScreenshot(
    artifactStore: ArtifactStore,
    options: EvidenceOptions,
  ): Promise<EvidenceResult> {
    try {
      const { deviceId, targetKind, runDir, stepId, backendName, signal } = options;
      const artifactDir = join(runDir, 'artifacts');
      mkdirSync(artifactDir, { recursive: true });

      if (targetKind === 'simulator') {
        const outputPath = join(artifactDir, `screenshot_${stepId}_${Date.now()}.png`);
        const simctlRef = await simctlScreenshot(deviceId, outputPath, signal);

        if (simctlRef) {
          const stored = await artifactStore.put({
            type: 'screenshot',
            path: outputPath,
            mimeType: 'image/png',
            relatedStep: stepId,
            relatedCase: options.caseId,
            backend: 'simctl',
          });
          return {
            type: 'screenshot',
            collected: true,
            artifact: stored,
          };
        }
      } else {
        // Physical: the screenshot is taken via DeviceBackend (Appium) externally.
        // The DeviceExplorer already captures screenshots on failure via takeScreenshot().
        // This method handles the case where EvidenceCollector is used standalone
        // (e.g., in a run-level failure handler). In that case, we note the limitation.
        return {
          type: 'screenshot',
          collected: false,
          reason:
            'Physical screenshot requires active Appium session — collect via DeviceBackend method (R5: not silently skipped)',
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.failureResult('screenshot', msg);
    }

    return this.failureResult('screenshot', 'Collection failed — see logs for details');
  }

  private async collectVideo(
    artifactStore: ArtifactStore,
    options: EvidenceOptions,
  ): Promise<EvidenceResult> {
    try {
      const { targetKind, runDir, stepId, signal } = options;
      const artifactDir = join(runDir, 'artifacts');

      if (targetKind === 'simulator') {
        // Video for simulator is a two-phase operation.
        // The recorder handle should be passed externally — for now,
        // we note that video collection requires an active recording handle.
        return {
          type: 'video',
          collected: false,
          reason:
            'Simulator video requires active SimctlRecordingHandle passed via EvidenceOptions.recordingHandle (R5: explicit)',
        };
      }

      // Physical: same as screenshot — requires DeviceBackend session
      return {
        type: 'video',
        collected: false,
        reason:
          'Physical video requires active Appium recording session — collect via DeviceBackend.stopRecording() (R5: not silently skipped)',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.failureResult('video', msg);
    }
  }

  private async collectSyslog(
    artifactStore: ArtifactStore,
    options: EvidenceOptions,
  ): Promise<EvidenceResult> {
    try {
      const { deviceId, targetKind, bundleId, runDir, stepId, signal } = options;
      const artifactDir = join(runDir, 'artifacts');
      mkdirSync(artifactDir, { recursive: true });

      if (targetKind === 'simulator') {
        const outputPath = join(artifactDir, `syslog_${stepId}_${Date.now()}.log`);
        const simctlRef = await simctlCollectSyslog(deviceId, outputPath, bundleId, 60, signal);

        if (simctlRef) {
          const stored = await artifactStore.put({
            type: 'syslog',
            path: outputPath,
            mimeType: 'text/plain',
            relatedStep: stepId,
            relatedCase: options.caseId,
            backend: 'simctl',
          });
          return {
            type: 'syslog',
            collected: true,
            artifact: stored,
          };
        }
      } else {
        // Physical: syslog via Appium collectLogs
        return {
          type: 'syslog',
          collected: false,
          reason:
            'Physical syslog requires active Appium session — collect via DeviceBackend.collectLogs() (R5: explicit)',
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.failureResult('syslog', msg);
    }

    return this.failureResult('syslog', 'Collection failed — see logs for details');
  }

  private async collectCrashlog(
    artifactStore: ArtifactStore,
    options: EvidenceOptions,
  ): Promise<EvidenceResult> {
    try {
      const { targetKind, bundleId, runDir, stepId, dsymPath, attemptSymbolication, signal } =
        options;
      const artifactDir = join(runDir, 'artifacts');
      const shouldSymbolicate = attemptSymbolication !== false; // default true

      if (targetKind === 'simulator') {
        const appName = bundleId?.split('.').pop();
        const crashArtifacts = await simctlCollectCrashLogs(artifactDir, appName, signal);

        if (crashArtifacts.length > 0) {
          // Store each crash log via ArtifactStore
          const stored: ArtifactRef[] = [];
          for (const crashRef of crashArtifacts) {
            const crashPath = join(runDir, crashRef.path);
            const storedRef = await artifactStore.put({
              type: 'crashlog',
              path: crashPath,
              mimeType: 'text/plain',
              relatedStep: stepId,
              relatedCase: options.caseId,
              backend: crashRef.backend,
            });

            // Attempt symbolication (AC3)
            if (shouldSymbolicate && appName) {
              try {
                const symResult = await symbolicateCrashlog(crashPath, appName, dsymPath, signal);

                if (symResult.symbolicated) {
                  // Write symbolicated content to a separate file
                  const symPath = join(artifactDir, `symbolicated_${basename(crashRef.path)}`);
                  writeFileSync(symPath, symResult.content, 'utf-8');
                  await artifactStore.put({
                    type: 'crashlog',
                    path: symPath,
                    mimeType: 'text/plain',
                    relatedStep: stepId,
                    relatedCase: options.caseId,
                    backend: `${crashRef.backend}_symbolicated`,
                  });
                }
              } catch (symErr) {
                const symMsg = symErr instanceof Error ? symErr.message : String(symErr);
                console.warn(
                  `[EvidenceCollector] Symbolication failed for ${redactValue(crashRef.path)}: ${redactValue(symMsg)}`,
                );
              }
            }

            stored.push(storedRef);
          }

          return {
            type: 'crashlog',
            collected: true,
            artifact: stored[0],
            symbolicated: shouldSymbolicate,
          };
        }

        return {
          type: 'crashlog',
          collected: false,
          reason:
            'No crash logs found in DiagnosticReports (R5: explicit — device may not have crashed)',
        };
      }

      // Physical: crashlog via devicectl diagnostics
      return {
        type: 'crashlog',
        collected: false,
        reason:
          'Physical crashlog requires active Appium session — collect via DeviceBackend.listCrashes() (R5: explicit)',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.failureResult('crashlog', msg);
    }
  }

  private async collectXcresult(
    artifactStore: ArtifactStore,
    options: EvidenceOptions,
  ): Promise<EvidenceResult> {
    try {
      const { xcresultPath, runDir, stepId } = options;

      if (!xcresultPath || !existsSync(xcresultPath)) {
        return {
          type: 'xcresult',
          collected: false,
          reason: 'xcresultPath not provided or path does not exist (R5: explicit)',
        };
      }

      const artifactDir = join(runDir, 'artifacts');
      mkdirSync(artifactDir, { recursive: true });

      // Copy xcresult bundle into artifacts directory
      const destName = `xcresult_${stepId}_${basename(xcresultPath)}`;
      const destPath = join(artifactDir, destName);

      // xcresult is a directory bundle — use recursive copy
      await copyDirectory(xcresultPath, destPath);

      const stored = await artifactStore.put({
        type: 'xcresult',
        path: destPath,
        mimeType: 'application/octet-stream',
        relatedStep: stepId,
        relatedCase: options.caseId,
        backend: 'xcodebuild',
      });

      return {
        type: 'xcresult',
        collected: true,
        artifact: stored,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.failureResult('xcresult', msg);
    }
  }

  private async collectTrace(
    artifactStore: ArtifactStore,
    options: EvidenceOptions,
  ): Promise<EvidenceResult> {
    try {
      const { tracePath, runDir, stepId } = options;

      if (!tracePath || !existsSync(tracePath)) {
        return {
          type: 'trace',
          collected: false,
          reason: 'tracePath not provided or path does not exist (R5: explicit)',
        };
      }

      const artifactDir = join(runDir, 'artifacts');
      mkdirSync(artifactDir, { recursive: true });

      const destName = `trace_${stepId}_${basename(tracePath)}`;
      const destPath = join(artifactDir, destName);

      // .trace is also a directory bundle
      await copyDirectory(tracePath, destPath);

      const stored = await artifactStore.put({
        type: 'trace',
        path: destPath,
        mimeType: 'application/octet-stream',
        relatedStep: stepId,
        relatedCase: options.caseId,
        backend: 'xctrace',
      });

      return {
        type: 'trace',
        collected: true,
        artifact: stored,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.failureResult('trace', msg);
    }
  }

  // ─── Helpers ──────────────────────────────────────────

  private failureResult(type: EvidenceType, reason: string): EvidenceResult {
    return {
      type,
      collected: false,
      reason: `[${type}] ${redactValue(reason)} (R5: explicit degradation)`,
    };
  }
}

// ─── Directory Copy Helper (recursive) ──────────────────────────

async function copyDirectory(src: string, dest: string): Promise<void> {
  mkdirSync(dest, { recursive: true });

  const entries = readdirSync(src);
  for (const entry of entries) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const stat = statSync(srcPath);

    if (stat.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

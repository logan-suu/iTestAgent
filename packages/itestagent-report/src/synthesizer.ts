/**
 * Report synthesizer — B09 module split note: report text sanitization lives in
 * report-sanitizer and trio validation in report-validator; this module stays
 * the three-piece synthesis engine.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  type ArtifactIndex,
  ArtifactIndexSchema,
  type RunResult,
  RunResultSchema,
} from 'itestagent-contracts';

import { generateSummary } from './summary-generator.js';
import type { ArtifactEntry, ReportSynthesizerInput } from './types.js';

/**
 * ReportSynthesizer — produces the three-piece report for a single run.
 *
 * Output files (per ADR-004 / AC1):
 *   - summary.md          (human-readable markdown)
 *   - result.json          (machine-readable, Zod-validated)
 *   - artifact-index.json  (artifact inventory, Zod-validated)
 *
 * AC2: No report.html is ever produced.
 */
export class ReportSynthesizer {
  readonly input: ReportSynthesizerInput;

  constructor(input: ReportSynthesizerInput) {
    this.input = input;
  }

  // ── result.json ───────────────────────────────────────────

  /**
   * Synthesize RunResult for result.json.
   *
   * AC4: Contains run status, Project Profile ref, device, execution mode,
   * performance metrics, baseline delta, artifactRefs, and failure explanation.
   */
  synthesizeResult(): RunResult {
    const raw: RunResult = {
      schemaVersion: '2.0',
      runId: this.input.runId,
      status: this.input.status,
      projectProfileRef: this.input.projectProfileRef,
      device: {
        udid: this.input.device.udid,
        name: this.input.device.name,
        model: this.input.device.model,
        osVersion: this.input.device.osVersion,
        targetKind: this.input.device.targetKind,
        runtimeIdentifier: this.input.device.runtimeIdentifier,
      },
      execution: this.input.execution,
      cases: this.input.cases,
      metrics: this.input.metrics,
      environment: {
        targetKind: this.input.environment.targetKind,
        representativeOfPhysicalDevice: this.input.environment.representativeOfPhysicalDevice,
        comparisonScope: this.input.environment.comparisonScope,
        hostFingerprint: this.input.environment.hostFingerprint,
        xcodeVersion: this.input.environment.xcodeVersion,
      },
      baselineDelta: this.input.baselineDelta,
      artifactRefs: this.input.artifactRefs,
      explanation: this.input.explanation,
    };

    // G2: Validate against Zod schema before returning
    return RunResultSchema.parse(raw);
  }

  // ── artifact-index.json ───────────────────────────────────

  /**
   * Synthesize ArtifactIndex for artifact-index.json.
   *
   * AC5: Manages screenshot/video/log/xcresult/trace/crashlog file index.
   */
  synthesizeArtifactIndex(): ArtifactIndex {
    const raw: ArtifactIndex = {
      schemaVersion: '1.0',
      runId: this.input.runId,
      artifacts: this.input.allArtifacts.map((a: ArtifactEntry) => ({
        id: a.id,
        type: a.type,
        path: a.path,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        sha256: a.sha256,
        relatedStep: a.relatedStep,
        backend: a.backend,
        redactionStatus: a.redactionStatus,
      })),
    };

    // G2: Validate against Zod schema before returning
    return ArtifactIndexSchema.parse(raw);
  }

  // ── summary.md ────────────────────────────────────────────

  /**
   * Synthesize summary.md markdown string.
   *
   * AC3: Contains conclusion, failure reason, key metrics, evidence paths,
   * and suggested next commands.
   */
  synthesizeSummary(): string {
    return generateSummary(this.input);
  }

  // ── Write to disk ─────────────────────────────────────────

  /**
   * Write all three report files to the given run root directory.
   *
   * Writes summary.md, result.json, and artifact-index.json to `runRootDir/`.
   *
   * @returns Paths to the written files.
   */
  async write(runRootDir: string): Promise<{
    resultPath: string;
    artifactIndexPath: string;
    summaryPath: string;
  }> {
    await mkdir(runRootDir, { recursive: true });

    const result = this.synthesizeResult();
    const artifactIndex = this.synthesizeArtifactIndex();
    const summary = this.synthesizeSummary();

    const resultPath = join(runRootDir, 'result.json');
    const artifactIndexPath = join(runRootDir, 'artifact-index.json');
    const summaryPath = join(runRootDir, 'summary.md');

    await Promise.all([
      writeFile(resultPath, JSON.stringify(result, null, 2), 'utf-8'),
      writeFile(artifactIndexPath, JSON.stringify(artifactIndex, null, 2), 'utf-8'),
      writeFile(summaryPath, summary, 'utf-8'),
    ]);

    return { resultPath, artifactIndexPath, summaryPath };
  }
}

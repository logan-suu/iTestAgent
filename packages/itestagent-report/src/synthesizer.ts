/**
 * Report synthesizer — B09 module split note: report text sanitization lives in
 * report-sanitizer and trio validation in report-validator; this module stays
 * the three-piece synthesis engine.
 */
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  ARTIFACT_INDEX_SCHEMA_VERSION,
  type ArtifactIndex,
  ArtifactIndexSchema,
  RUN_RESULT_SCHEMA_VERSION,
  type RunResult,
  RunResultSchema,
} from 'itestagent-contracts';

import { generateSummary } from './summary-generator.js';
import type { ArtifactEntry, ReportSynthesizerInput } from './types.js';

async function atomicWrite(path: string, content: string): Promise<void> {
  const temporaryPath = `${path}.tmp-${randomUUID()}`;
  await writeFile(temporaryPath, content, { encoding: 'utf8', mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
}

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
      schemaVersion: RUN_RESULT_SCHEMA_VERSION,
      runId: this.input.runId,
      status: this.input.status,
      ...(this.input.projectProfileRef ? { projectProfileRef: this.input.projectProfileRef } : {}),
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
      schemaVersion: ARTIFACT_INDEX_SCHEMA_VERSION,
      runId: this.input.runId,
      artifacts: this.input.allArtifacts.map((a: ArtifactEntry) => ({
        id: a.id,
        type: a.type,
        path: a.path,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        sha256: a.sha256,
        relatedStep: a.relatedStep,
        relatedCase: a.relatedCase,
        backend: a.backend,
        redactionStatus: a.redactionStatus,
      })),
      collectionOutcomes:
        this.input.collectionOutcomes ??
        this.input.allArtifacts.map((artifact) => ({
          type: artifact.type,
          status: 'collected' as const,
          reasonCode: 'collected',
          artifactId: artifact.id,
          relatedStep: artifact.relatedStep,
          relatedCase: artifact.relatedCase,
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

    // Compatibility writer: publish supporting files first and result.json last.
    // New production paths use RunWriter, which additionally validates the full bundle.
    await atomicWrite(artifactIndexPath, `${JSON.stringify(artifactIndex, null, 2)}\n`);
    await atomicWrite(summaryPath, summary);
    await atomicWrite(resultPath, `${JSON.stringify(result, null, 2)}\n`);

    return { resultPath, artifactIndexPath, summaryPath };
  }
}

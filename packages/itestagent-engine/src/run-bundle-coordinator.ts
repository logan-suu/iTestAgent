import { isAbsolute, resolve } from 'node:path';
import type { RunPlanDocument } from 'itestagent-contracts';
import { ReportSynthesizer, type ReportSynthesizerInput } from 'itestagent-report';
import type { RunStore } from 'itestagent-store';

export interface PersistRunBundleInput {
  store: RunStore;
  plan: RunPlanDocument;
  report: ReportSynthesizerInput;
  projectHash?: string;
  parentRunId?: string;
  /** Base for backend-provided relative staging paths. */
  artifactSourceRoot?: string;
}

/**
 * The production ownership boundary for a complete run bundle.
 * Backends provide facts and staging paths; only the RunWriter publishes files and indexes.
 */
export async function persistRunBundle(input: PersistRunBundleInput): Promise<{ runDir: string }> {
  const writer = await input.store.beginRun({
    runId: input.plan.runId,
    projectHash: input.projectHash,
    targetKind: input.report.execution.targetKind,
    backend: input.report.execution.backendUsed,
    parentRunId: input.parentRunId,
  });
  try {
    await writer.writePlan(input.plan);
    await writer.checkpoint(input.report.steps);
    const artifacts = [];
    for (const artifact of input.report.allArtifacts) {
      artifacts.push(
        await writer.importArtifact({
          id: artifact.id,
          type: artifact.type,
          sourcePath: isAbsolute(artifact.path)
            ? artifact.path
            : resolve(input.artifactSourceRoot ?? process.cwd(), artifact.path),
          sourceRoot: input.artifactSourceRoot,
          mimeType: artifact.mimeType,
          relatedStep: artifact.relatedStep,
          relatedCase: artifact.relatedCase,
          backend: artifact.backend,
          redactionStatus: artifact.redactionStatus,
        }),
      );
    }
    const synthesizer = new ReportSynthesizer({ ...input.report, allArtifacts: artifacts });
    await writer.commit({
      result: synthesizer.synthesizeResult(),
      artifactIndex: synthesizer.synthesizeArtifactIndex(),
      summary: synthesizer.synthesizeSummary(),
    });
    return { runDir: writer.runDir };
  } catch (error) {
    writer.abort();
    throw error;
  }
}

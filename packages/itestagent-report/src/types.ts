/**
 * Report trio input/output types — B09 module split note: the sanitizer,
 * validator and replay adapter live in sibling modules; this stays the
 * shared type vocabulary.
 */
import type {
  BackendCleanupOutcome,
  BaselineDelta,
  EvidenceCollectionOutcome,
  ExecutionSummary,
  FailureExplanation,
  PerformanceMetrics,
  RunStatus,
  RunStep,
  TestCaseResult,
} from 'itestagent-contracts';
import type { TargetKind } from 'itestagent-contracts';

/**
 * Artifact entry used for artifact-index.json construction.
 * Mirrors the ArtifactIndex artifact item shape.
 */
export interface ArtifactEntry {
  id: string;
  type:
    | 'screenshot'
    | 'video'
    | 'uitree'
    | 'log'
    | 'syslog'
    | 'crashlog'
    | 'trace'
    | 'xcresult'
    | 'json'
    | 'text';
  path: string;
  mimeType?: string;
  sizeBytes?: number;
  sha256?: string;
  relatedStep?: string;
  relatedCase?: string;
  backend?: string;
  redactionStatus: 'raw-local-only' | 'redacted' | 'safe';
}

/**
 * Aggregate input for the ReportSynthesizer.
 *
 * All upstream data produced by Phase 3/4 components (DeviceExplorer,
 * EvidenceCollector, FailureExplainer, PerformanceBackend, BaselineManager)
 * flows into this single input type. The synthesizer produces the
 * three-piece report from it.
 */
export interface ReportSynthesizerInput {
  /** Unique run identifier */
  runId: string;

  /** Immediate source run for a rerun child (ADR-035). */
  parentRunId?: string;

  /** Final run status */
  status: RunStatus;

  /** Reference path to the associated Project Profile */
  projectProfileRef?: string;

  /** Device information */
  device: {
    udid: string;
    name: string;
    model: string;
    osVersion: string;
    targetKind: TargetKind;
    /** Simulator runtime identifier (undefined for physical) */
    runtimeIdentifier?: string;
  };

  /** Execution summary */
  execution: ExecutionSummary;

  /** Optional owner cleanup result, especially for cancelled or terminal backends. */
  cleanupOutcome?: BackendCleanupOutcome;

  /** Test case results */
  cases: TestCaseResult[];

  /** Performance metrics collected during the run */
  metrics: PerformanceMetrics;

  /** Execution environment metadata (ADR-011) */
  environment: {
    targetKind: TargetKind;
    representativeOfPhysicalDevice: boolean;
    comparisonScope: 'simulator_only' | 'physical_only';
    hostFingerprint?: string;
    xcodeVersion?: string;
  };

  /** Baseline comparison delta (omitted for first runs without baseline) */
  baselineDelta?: BaselineDelta;

  /** Artifact ID references */
  artifactRefs: string[];

  /** Full artifact metadata for artifact-index.json */
  allArtifacts: ArtifactEntry[];

  /** Outcomes for every evidence slot evaluated by policy and route. */
  collectionOutcomes?: EvidenceCollectionOutcome[];

  /** Failure explanation (omitted for passed/explored runs) */
  explanation?: FailureExplanation;

  /** Individual run steps */
  steps: RunStep[];

  /** Optional test plan name for context in summary */
  testPlanName?: string;
}

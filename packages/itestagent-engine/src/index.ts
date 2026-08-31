export {
  RunStateMachine,
  classifyError,
  ErrorLevelSchema,
} from './run-state-machine.js';

export { PermissionEngine } from './permission-engine.js';

export type {
  ResolveResult,
  PermissionEngineOptions,
} from './permission-engine.js';

export { MockAgentRuntime } from './mock-agent-runtime.js';

export { parseIntent } from './intent-parser.js';

export {
  compileTestPlan,
  testPlanToYaml,
  parseTestPlanYaml,
} from './test-plan-compiler.js';

export {
  BackendRegistry,
  BackendSelector,
  DEFAULT_PREFERENCES,
} from './backend-selector.js';

export type {
  TestPlan,
  DeviceSelector,
  ExecutionPlan,
  AssertionPolicy,
  CompileOptions,
} from './test-plan-compiler.js';

export type {
  BackendPreferences,
  SelectResult,
} from './backend-selector.js';

export type {
  ErrorLevel,
  StateChangeHandler,
} from './run-state-machine.js';

export { ContextBuilder, redactValue } from './context-builder.js';

export type {
  BuildContextInput,
  ContextBuilderOptions,
} from './context-builder.js';

export { AiSdkAgentRuntime } from './ai-sdk-agent-runtime.js';

export type {
  AiToolDefinition,
  AiSdkAgentRuntimeOptions,
  ToolExecutor,
} from './ai-sdk-agent-runtime.js';

export { ToolDispatcher } from './tool-dispatcher.js';

export type {
  CustomToolHandler,
  EventEmitter,
  ToolDispatcherOptions,
} from './tool-dispatcher.js';

export {
  ElementLocator,
  SystemAlertHandler,
  RunStepRecorder,
  DeviceExplorer,
} from './exploration/index.js';

export type {
  ExplorerToolDispatcher,
  ExplorationAction,
  ExplorationOptions,
  LocatorConfidence,
  LocatorResult,
  LocatorStrategy,
  SystemAlertResult,
} from './exploration/index.js';

export { InteractiveRecorder } from './recording/index.js';

export type {
  RecordingCallbacks,
  RecordingSessionState,
  SuggestedAction,
  UserResponse,
  RecordingStep,
  RecordingResult,
  RecordingSessionConfig,
  RecordingEvent,
} from './recording/index.js';

export { AssertionEvaluator } from './assertion/index.js';

export { TestDataGenerator } from './test-data/test-data-generator.js';

export { CredentialManager } from './test-data/credential-manager.js';

export type { PromptCallback } from './test-data/credential-manager.js';

export { EvidenceCollector, symbolicateCrashlog } from './evidence/index.js';

export {
  simctlScreenshot,
  simctlStartRecording,
  simctlCollectSyslog,
  simctlCollectCrashLogs,
} from './evidence/index.js';

export type {
  SimctlRecordingHandle,
  EvidenceType,
  EvidenceOptions,
  EvidenceResult,
  EvidenceCollectorConfig,
  EvidenceCollectionSummary,
  SymbolicationResult,
} from './evidence/index.js';

export { BaselineManager } from './baseline/index.js';

export { FailureExplainer } from './explanation/index.js';

export type {
  ExplainContext,
  PreviousRunInfo,
  LlmExplainFn,
  FailureExplainerOptions,
} from './explanation/index.js';

// ─── B14 module split: MVP field gating + durable plan persistence ──
export { MVP_TEST_PLAN_FIELDS, missingMvpTestPlanFields } from './mvp-test-plan-fields.js';
export { PLAN_FILENAME, saveTestPlanFile, loadTestPlanFile } from './durable-test-plan.js';
export type { DurableTestPlanDeps } from './durable-test-plan.js';

// ─── B15 module split: MVP run coordination + physical/simulator adapters ──
export { createMvpRunCoordinator } from './mvp-run-coordinator.js';
export type { MvpRunCoordinatorDeps, MvpRunResult } from './mvp-run-coordinator.js';
export { createPhysicalMvpCleanup } from './physical-mvp-cleanup.js';
export type { PhysicalMvpCleanupSteps } from './physical-mvp-cleanup.js';
export { createPhysicalMvpAdapter } from './physical-mvp-adapter.js';
export type { PhysicalMvpAdapterDeps, PhysicalDeviceHandle } from './physical-mvp-adapter.js';
export { createPhysicalMvpRunCoordinator } from './physical-mvp-run-coordinator.js';
export type {
  PhysicalMvpRunCoordinatorDeps,
  PhysicalMvpRunResult,
} from './physical-mvp-run-coordinator.js';
export { createSimulatorMvpAdapter } from './simulator-mvp-adapter.js';
export type { SimulatorMvpAdapterDeps } from './simulator-mvp-adapter.js';
export { resolveMvpRunId } from './physical-mvp-run-support.js';

// ─── B16 module split: analysis + intents ──
export { verifyEvidenceRefs } from './analysis/evidence-verifier.js';
export type { EvidenceVerifierInput, EvidenceVerifierIssue } from './analysis/evidence-verifier.js';
export { analyzeInstruction } from './analysis/instruction-analyzer.js';
export type { InstructionAnalysis, InstructionIntent } from './analysis/instruction-analyzer.js';
export { summarizeProjectAssets } from './analysis/project-analyzer.js';
export type { ProjectAssetsInput, ProjectAssetsSummary } from './analysis/project-analyzer.js';
export { resolveSourceScope } from './analysis/source-scope.js';
export type { SourceScope, SourceScopeInput } from './analysis/source-scope.js';
export { buildFeedMemoryIntent } from './feed-memory-intent.js';
export type { FeedMemoryIntent, FeedMemoryIntentInput } from './feed-memory-intent.js';
export { buildMemoryProfileIntent } from './memory-profile-intent.js';
export type { MemoryProfileIntent, MemoryProfileIntentOverrides } from './memory-profile-intent.js';

export { runXcunitFlow } from './test-flow/run-xcunit-flow.js';
export { createRealXcunitFlowDeps } from './test-flow/xcunit-flow-wiring.js';
export { createAppiumExplorationRuntime } from './exploration/exploration-wiring.js';
export type {
  ExplorationSurfaceConfig,
  ExplorationLlmConfig,
  ExplorationRuntime,
} from './exploration/exploration-wiring.js';
export type {
  XcunitFlowInput,
  XcunitFlowResult,
} from './test-flow/run-xcunit-flow.js';
export { runRealDeviceExploration, createBackendToolDispatcher } from './exploration/real-run.js';
export type {
  RealDeviceRunOptions,
  RealDeviceRunResult,
} from './exploration/real-run.js';
export {
  suggestAssertions,
  createAiSdkGenerateFn,
  createConfiguredGenerateFn,
} from './exploration/assertion-suggester.js';
export type { SuggesterModelConfig } from './exploration/assertion-suggester.js';
export type {
  SuggestionContext,
  SuggesterDeps,
  SuggestionResult,
} from './exploration/assertion-suggester.js';

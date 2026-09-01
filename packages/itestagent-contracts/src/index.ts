export {
  ItestAgentConfigSchema,
  DEFAULT_CONFIG,
  parseConfig,
} from './config.js';

export type {
  ItestAgentConfig,
  ModelConfig,
  DeviceConfig,
  TuiConfig,
} from './config.js';

export {
  AgentErrorCodeSchema,
  AgentErrorSchema,
  parseAgentError,
} from './agent-error.js';

export type {
  AgentErrorCode,
  AgentError,
} from './agent-error.js';

export {
  RunStateSchema,
  RUN_STATE_FORWARD,
  RUN_STATE_EXCEPTION,
  VALID_TRANSITIONS,
  isValidTransition,
  isTerminalState,
  isExceptionState,
} from './run-state.js';

export type { RunState } from './run-state.js';

export {
  PermissionEffectSchema,
  SafetyGateSchema,
  PermissionRuleSchema,
  DEFAULT_HIGH_RISK_ACTIONS,
  parsePermissionRule,
} from './permission.js';

export type {
  PermissionEffect,
  SafetyGate,
  PermissionRule,
} from './permission.js';

export {
  PHYSICAL_PREFLIGHT_STAGE_VALUES,
  PhysicalPreflightStageSchema,
  WDA_READINESS_STAGE_VALUES,
  WdaReadinessStageSchema,
  PHYSICAL_PREFLIGHT_FAILURE_CODE_VALUES,
  PhysicalPreflightFailureCodeSchema,
  PhysicalAppArtifactSchema,
  WdaReadinessProbeSchema,
  PhysicalPreflightResultSchema,
} from './physical-preflight.js';

export type {
  PhysicalPreflightStage,
  WdaReadinessStage,
  PhysicalPreflightFailureCode,
  PhysicalAppArtifact,
  WdaReadinessProbe,
  PhysicalPreflightResult,
} from './physical-preflight.js';

export {
  TargetKindSchema,
  ArtifactTypeSchema,
  RedactionStatusSchema,
  ArtifactRefSchema,
  parseArtifactRef,
} from './device-artifacts.js';

export {
  DeviceInfoSchema,
  DeviceSnapshotSchema,
  DeviceTargetSchema,
  HealthCheckResultSchema,
  BackendCapabilitiesSchema,
  AppInfoSchema,
} from './device-types.js';

export {
  ActionResultSchema,
  UiTreeSnapshotSchema,
  CrashSummarySchema,
  RecordingHandleSchema,
} from './device-runtime.js';

export {
  LaunchAppInputSchema,
  TerminateAppInputSchema,
  TapInputSchema,
  SwipeInputSchema,
  TypeTextInputSchema,
  PressButtonInputSchema,
  OpenUrlInputSchema,
  ScreenshotInputSchema,
  RecordingInputSchema,
  LogCollectInputSchema,
} from './device-action-inputs.js';

export {
  ToolCallSchema,
  ToolResultSchema,
  AgentTurnInputSchema,
  parseToolCall,
  parseToolResult,
} from './agent-runtime.js';

export type {
  ToolCall,
  ToolResult,
  AgentTurnInput,
  AgentRuntime,
} from './agent-runtime.js';

export type {
  TargetKind,
  ArtifactType,
  RedactionStatus,
  ArtifactRef,
} from './device-artifacts.js';

export type {
  DeviceInfo,
  DeviceSnapshot,
  DeviceTarget,
  HealthCheckResult,
  BackendCapabilities,
  AppInfo,
} from './device-types.js';

export {
  DeviceDiscoveryLaneSchema,
  DeviceDiscoveryStatusSchema,
  DeviceDiscoveryIssueSchema,
  DeviceDiscoverySnapshotSchema,
} from './device-discovery.js';

export type {
  DeviceDiscoveryLane,
  DeviceDiscoveryStatus,
  DeviceDiscoveryIssue,
  DeviceDiscoveryOptions,
  DeviceDiscoverySnapshot,
  DeviceDiscoveryProvider,
} from './device-discovery.js';

export type {
  ActionResult,
  UiTreeSnapshot,
  CrashSummary,
  RecordingHandle,
} from './device-runtime.js';

export type {
  LaunchAppInput,
  TerminateAppInput,
  TapInput,
  SwipeInput,
  TypeTextInput,
  PressButtonInput,
  OpenUrlInput,
  ScreenshotInput,
  RecordingInput,
  LogCollectInput,
} from './device-action-inputs.js';

export {
  BuildDoctorResultSchema,
  SchemeInfoSchema,
  BuildSettingsInputSchema,
  BuildSettingsSchema,
  BuildInputSchema,
  BuildResultSchema,
  TestInputSchema,
  TestResultSchema,
  ArchiveInputSchema,
  ArchiveResultSchema,
  BuildDestinationSchema,
} from './build-driver.js';

export type {
  BuildDoctorResult,
  SchemeInfo,
  BuildSettingsInput,
  BuildSettings,
  BuildInput,
  BuildResult,
  TestInput,
  TestResult,
  ArchiveInput,
  ArchiveResult,
  BuildDestination,
} from './build-driver.js';

export type { BuildDriver } from './build-driver.js';

export type { DeviceBackend } from './device-backend.js';

export {
  ProjectDiscoverySchema,
  ProjectGraphSchema,
  BuildSettingsQuerySchema,
  ResolvedBuildSettingsSchema,
  SourceScanInputSchema,
  SourceFactsSchema,
  ResourceScanInputSchema,
  ResourceFactsSchema,
  XcuitestExecutionAssetQuerySchema,
  XcuitestExecutionCandidateSchema,
  XcuitestExecutionAssetsSchema,
} from './project-analyzer-backend.js';

export type {
  ProjectDiscovery,
  ProjectGraph,
  BuildSettingsQuery,
  ResolvedBuildSettings,
  SourceScanInput,
  SourceFacts,
  ResourceScanInput,
  ResourceFacts,
  XcuitestExecutionAssetQuery,
  XcuitestExecutionCandidate,
  XcuitestExecutionAssets,
  ProjectAnalyzerBackend,
} from './project-analyzer-backend.js';

export {
  AgentEventTypeSchema,
  SessionStartedEventSchema,
  TurnStartedEventSchema,
  AssistantDeltaEventSchema,
  ToolRequestedEventSchema,
  PermissionRequestedEventSchema,
  PermissionResolvedEventSchema,
  ToolStartedEventSchema,
  ToolProgressEventSchema,
  ToolCompletedEventSchema,
  ToolFailedEventSchema,
  RunStateChangedEventSchema,
  ArtifactCreatedEventSchema,
  TurnCompletedEventSchema,
  SessionIdleEventSchema,
  SessionAbortedEventSchema,
  SessionErrorEventSchema,
  AgentEventSchema,
  isTerminalEvent,
} from './agent-events.js';

export type {
  AgentEventType,
  SessionStartedEvent,
  TurnStartedEvent,
  AssistantDeltaEvent,
  ToolRequestedEvent,
  PermissionRequestedEvent,
  PermissionResolvedEvent,
  ToolStartedEvent,
  ToolProgressEvent,
  ToolCompletedEvent,
  ToolFailedEvent,
  RunStateChangedEvent,
  ArtifactCreatedEvent,
  TurnCompletedEvent,
  SessionIdleEvent,
  SessionAbortedEvent,
  SessionErrorEvent,
  AgentEvent,
} from './agent-events.js';

export {
  TraceRecordInputSchema,
  TraceExportInputSchema,
  TraceExportStatusSchema,
  TraceSummaryInputSchema,
  TraceSummarySchema,
  SymbolicateInputSchema,
  BaselineCompareInputSchema,
  BaselineDeltaSchema,
} from './performance-backend.js';

export type {
  TraceRecordInput,
  TraceExportInput,
  TraceExportStatus,
  TraceSummaryInput,
  TraceSummary,
  SymbolicateInput,
  BaselineCompareInput,
  BaselineDelta,
  PerformanceBackend,
} from './performance-backend.js';

export { ArtifactInputSchema, StoredRunPlanInputSchema } from './store-driver.js';

export type {
  ArtifactInput,
  StoredRunPlanInput,
  StoreDriver,
  SecretStore,
  ArtifactStore,
} from './store-driver.js';

// B03 (guide §11.4 "result+artifact-index→B03"): the data-contracts schemas
// live in focused modules now; data-contracts.ts re-exports them for
// backwards compatibility.
export {
  RunStatusSchema,
  PerformanceMetricsSchema,
  ExecutionSummarySchema,
  TestCaseResultSchema,
  FailureExplanationSchema,
  RunStepSchema,
  RunResultSchema,
  DEFAULT_SCHEMA_VERSION,
  parseRunResult,
} from './run-result-contracts.js';

export type {
  RunStatus,
  PerformanceMetrics,
  ExecutionSummary,
  TestCaseResult,
  FailureExplanation,
  RunStep,
  RunResult,
} from './run-result-contracts.js';

export { ArtifactIndexSchema, parseArtifactIndex } from './artifact-index-contract.js';

export type { ArtifactIndex } from './artifact-index-contract.js';

export {
  CrossFieldValidationError,
  assertValidRunResultArtifactIndexPair,
  findDuplicateArtifactIds,
  findDuplicateArtifactRefs,
  findDuplicateCaseIds,
  findUnresolvedArtifactRefs,
  parseValidatedRunResultPair,
  validateRunResultArtifactIndexPair,
} from './json-schema-cross-field.js';

export type { CrossFieldIssue } from './json-schema-cross-field.js';

export {
  ScopeSchema,
  IntentSchema,
  ClarificationSchema,
  CompleteResultSchema,
  IncompleteResultSchema,
  IntentParseResultSchema,
  parseIntentResult,
} from './intent-schema.js';

export type {
  Scope,
  Intent,
  Clarification,
  IntentParseResult,
  CompleteResult,
  IncompleteResult,
} from './intent-schema.js';

export {
  DeviceSelectorSchema,
  PhysicalDeviceSelectorSchema,
  SimulatorDeviceSelectorSchema,
  TargetSchema,
  AppSourceSchema,
  BackendPreferenceSchema,
  ExecutionPlanSchema,
  AssertionPolicySchema,
  TestDataPolicySchema,
  ArtifactPolicySchema,
  PerformancePlanSchema,
  PermissionPolicyRefSchema,
  XcuitestTargetSchema,
  TestPlanSchema,
  TEST_PLAN_SCHEMA_VERSION,
  TEST_PLAN_METRIC_VALUES,
  parseTestPlan,
  safeParseTestPlan,
} from './test-plan.js';

export type {
  DeviceSelector,
  PhysicalDeviceSelector,
  SimulatorDeviceSelector,
  Target,
  AppSource,
  BackendPreference,
  ExecutionPlan,
  AssertionPolicy,
  TestDataPolicy,
  ArtifactPolicy,
  PerformancePlan,
  PermissionPolicyRef,
  XcuitestTarget,
  TestPlanMetric,
  TestPlan,
} from './test-plan.js';

// B04 (guide §11.3 "TestPlan/target execution"): cross-field validation,
// MVP execution compiler, and the physical Route C/B contract vocabulary.
export {
  TEST_PLAN_VALIDATION_ISSUE_CODES,
  validateTestPlan,
  assertValidTestPlan,
  TestPlanValidationError,
} from './test-plan-validation.js';

export type {
  TestPlanValidationIssueCode,
  TestPlanValidationIssue,
} from './test-plan-validation.js';

export {
  MVP_EXECUTION_PATH_VALUES,
  MvpExecutionPathSchema,
  MvpDeviceSelectorSchema,
  MvpExecutionInputSchema,
  compileMvpExecution,
  MvpCompilationError,
} from './mvp-execution.js';

export type {
  MvpExecutionPath,
  MvpDeviceSelector,
  MvpExecutionInput,
} from './mvp-execution.js';

export {
  PHYSICAL_ROUTE_VALUES,
  PhysicalRouteSchema,
  WDA_LIFECYCLE_ROLE_VALUES,
  WdaLifecycleRoleSchema,
  PhysicalIdentitySchema,
  PHYSICAL_CONTRACT_ISSUE_CODES,
  validatePhysicalMvpContract,
} from './physical-mvp.js';

export type {
  PhysicalRoute,
  WdaLifecycleRole,
  PhysicalIdentity,
  PhysicalMvpContractInput,
  PhysicalMvpContractIssueCode,
  PhysicalMvpContractIssue,
} from './physical-mvp.js';

export {
  AssertionConditionTypeSchema,
  AssertionConditionSchema,
  AssertionSourceSchema,
  UserAssertionSchema,
  AssertionEvaluationResultSchema,
  AssertionEvaluateInputSchema,
  AssertionEvaluateOutputSchema,
} from './assertion.js';

export type {
  AssertionConditionType,
  AssertionCondition,
  AssertionSource,
  UserAssertion,
  AssertionEvaluationResult,
  AssertionEvaluateInput,
  AssertionEvaluateOutput,
} from './assertion.js';

export {
  SuggestedActionSchema,
  RecordingStepSchema,
  RecordingResultSchema,
  parseRecordingResult,
  safeParseRecordingResult,
} from './recording.js';

export type {
  SuggestedAction,
  RecordingStep,
  RecordingResult,
} from './recording.js';

export {
  TestDataItemTypeSchema,
  TestDataItemSchema,
  GeneratedTestDataSchema,
  TestDataContextSchema,
  CredentialKindSchema,
  CredentialRequestSchema,
  CredentialResponseSchema,
  CredentialEntrySchema,
  CredentialResolveStatusSchema,
  CredentialResolveResultSchema,
  parseGeneratedTestData,
  parseCredentialRequest,
  parseCredentialResponse,
} from './test-data.js';

export type {
  TestDataItemType,
  TestDataItem,
  GeneratedTestData,
  TestDataContext,
  CredentialKind,
  CredentialRequest,
  CredentialResponse,
  CredentialEntry,
  CredentialResolveStatus,
  CredentialResolveResult,
  CredentialManager,
} from './test-data.js';

export {
  BaselineRecordSchema,
  BuildBaselineKeyInputSchema,
  BaselineListFilterSchema,
  buildBaselineKey,
  parseBaselineKey,
} from './baseline-store.js';

export type {
  BaselineRecord,
  BuildBaselineKeyInput,
  BaselineListFilter,
  BaselineStore,
} from './baseline-store.js';

export { createId } from './ids.js';

// B37 (guide §9 Stage 2A): persisted schema migration types (generic only —
// scenario symbols stay behind the scenarios subpath, ADR-020).
export type { MigrationIssue, MigrationResult } from './migrations/types.js';

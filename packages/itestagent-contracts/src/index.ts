export {
  ItestAgentConfigSchema,
  DEFAULT_CONFIG,
  parseConfig,
  maskSensitiveFields,
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
  TargetKindSchema,
  ArtifactTypeSchema,
  RedactionStatusSchema,
  ArtifactRefSchema,
  DeviceInfoSchema,
  DeviceSnapshotSchema,
  DeviceTargetSchema,
  HealthCheckResultSchema,
  BackendCapabilitiesSchema,
  AppInfoSchema,
  ActionResultSchema,
  UiTreeSnapshotSchema,
  CrashSummarySchema,
  RecordingHandleSchema,
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
  parseArtifactRef,
} from './device-types.js';

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
  DeviceInfo,
  DeviceSnapshot,
  DeviceTarget,
  HealthCheckResult,
  BackendCapabilities,
  AppInfo,
  ActionResult,
  UiTreeSnapshot,
  CrashSummary,
  RecordingHandle,
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
} from './device-types.js';

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

export { ArtifactInputSchema } from './store-driver.js';

export type {
  ArtifactInput,
  StoreDriver,
  SecretStore,
  ArtifactStore,
} from './store-driver.js';

export {
  RunStatusSchema,
  PerformanceMetricsSchema,
  ExecutionSummarySchema,
  TestCaseResultSchema,
  FailureExplanationSchema,
  RunStepSchema,
  RunResultSchema,
  ArtifactIndexSchema,
  DEFAULT_SCHEMA_VERSION,
  parseRunResult,
  parseArtifactIndex,
} from './data-contracts.js';

export type {
  RunStatus,
  PerformanceMetrics,
  ExecutionSummary,
  TestCaseResult,
  FailureExplanation,
  RunStep,
  RunResult,
  ArtifactIndex,
} from './data-contracts.js';

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
  TestPlanSchema,
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
  TestPlan,
} from './test-plan.js';

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

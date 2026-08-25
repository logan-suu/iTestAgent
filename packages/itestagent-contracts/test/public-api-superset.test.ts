import { expect, test } from 'bun:test';
import * as actionInputs from '../src/device-action-inputs.js';
import * as artifacts from '../src/device-artifacts.js';
import * as identity from '../src/device-identity.js';
import * as runtime from '../src/device-runtime.js';
import * as contracts from '../src/index.js';
import type * as contractsTypes from '../src/index.js';

/**
 * B01 public API superset guard (promotion migration, guide §11.4).
 *
 * The baseline public API surface is hard-coded below, extracted verbatim from
 * `git show 73c99fb:packages/itestagent-contracts/src/index.ts` (158 value
 * exports + 142 type-only exports). Every baseline symbol must remain
 * exported by the current barrel — the public API may only grow (superset),
 * never shrink.
 *
 * - Value exports are asserted at runtime via `name in contracts`.
 * - Type-only exports cannot be observed at runtime; they are guarded at
 *   compile time via the `_baselineTypePresence` annotation below. If any
 *   baseline type export disappears, `bun run typecheck` fails.
 */

// prettier-ignore
const BASELINE_VALUE_EXPORTS: readonly string[] = [
  // config.ts
  'ItestAgentConfigSchema',
  'DEFAULT_CONFIG',
  'parseConfig',
  // agent-error.ts
  'AgentErrorCodeSchema',
  'AgentErrorSchema',
  'parseAgentError',
  // run-state.ts
  'RunStateSchema',
  'RUN_STATE_FORWARD',
  'RUN_STATE_EXCEPTION',
  'VALID_TRANSITIONS',
  'isValidTransition',
  'isTerminalState',
  'isExceptionState',
  // permission.ts
  'PermissionEffectSchema',
  'SafetyGateSchema',
  'PermissionRuleSchema',
  'DEFAULT_HIGH_RISK_ACTIONS',
  'parsePermissionRule',
  // device-types.ts (device core slice — now split into focused modules)
  'TargetKindSchema',
  'ArtifactTypeSchema',
  'RedactionStatusSchema',
  'ArtifactRefSchema',
  'DeviceInfoSchema',
  'DeviceSnapshotSchema',
  'DeviceTargetSchema',
  'HealthCheckResultSchema',
  'BackendCapabilitiesSchema',
  'AppInfoSchema',
  'ActionResultSchema',
  'UiTreeSnapshotSchema',
  'CrashSummarySchema',
  'RecordingHandleSchema',
  'LaunchAppInputSchema',
  'TerminateAppInputSchema',
  'TapInputSchema',
  'SwipeInputSchema',
  'TypeTextInputSchema',
  'PressButtonInputSchema',
  'OpenUrlInputSchema',
  'ScreenshotInputSchema',
  'RecordingInputSchema',
  'LogCollectInputSchema',
  'parseArtifactRef',
  // agent-runtime.ts
  'ToolCallSchema',
  'ToolResultSchema',
  'AgentTurnInputSchema',
  'parseToolCall',
  'parseToolResult',
  // build-driver.ts
  'BuildDoctorResultSchema',
  'SchemeInfoSchema',
  'BuildSettingsInputSchema',
  'BuildSettingsSchema',
  'BuildInputSchema',
  'BuildResultSchema',
  'TestInputSchema',
  'TestResultSchema',
  'ArchiveInputSchema',
  'ArchiveResultSchema',
  // project-analyzer-backend.ts
  'ProjectDiscoverySchema',
  'ProjectGraphSchema',
  'BuildSettingsQuerySchema',
  'ResolvedBuildSettingsSchema',
  'SourceScanInputSchema',
  'SourceFactsSchema',
  'ResourceScanInputSchema',
  'ResourceFactsSchema',
  // agent-events.ts
  'AgentEventTypeSchema',
  'SessionStartedEventSchema',
  'TurnStartedEventSchema',
  'AssistantDeltaEventSchema',
  'ToolRequestedEventSchema',
  'PermissionRequestedEventSchema',
  'PermissionResolvedEventSchema',
  'ToolStartedEventSchema',
  'ToolProgressEventSchema',
  'ToolCompletedEventSchema',
  'ToolFailedEventSchema',
  'RunStateChangedEventSchema',
  'ArtifactCreatedEventSchema',
  'TurnCompletedEventSchema',
  'SessionIdleEventSchema',
  'SessionAbortedEventSchema',
  'SessionErrorEventSchema',
  'AgentEventSchema',
  'isTerminalEvent',
  // performance-backend.ts
  'TraceRecordInputSchema',
  'TraceExportInputSchema',
  'TraceExportStatusSchema',
  'TraceSummaryInputSchema',
  'TraceSummarySchema',
  'SymbolicateInputSchema',
  'BaselineCompareInputSchema',
  'BaselineDeltaSchema',
  // store-driver.ts
  'ArtifactInputSchema',
  // data-contracts.ts
  'RunStatusSchema',
  'PerformanceMetricsSchema',
  'ExecutionSummarySchema',
  'TestCaseResultSchema',
  'FailureExplanationSchema',
  'RunStepSchema',
  'RunResultSchema',
  'ArtifactIndexSchema',
  'DEFAULT_SCHEMA_VERSION',
  'parseRunResult',
  'parseArtifactIndex',
  // intent-schema.ts
  'ScopeSchema',
  'IntentSchema',
  'ClarificationSchema',
  'CompleteResultSchema',
  'IncompleteResultSchema',
  'IntentParseResultSchema',
  'parseIntentResult',
  // test-plan.ts
  'DeviceSelectorSchema',
  'PhysicalDeviceSelectorSchema',
  'SimulatorDeviceSelectorSchema',
  'TargetSchema',
  'AppSourceSchema',
  'BackendPreferenceSchema',
  'ExecutionPlanSchema',
  'AssertionPolicySchema',
  'TestDataPolicySchema',
  'ArtifactPolicySchema',
  'PerformancePlanSchema',
  'PermissionPolicyRefSchema',
  'TestPlanSchema',
  'parseTestPlan',
  'safeParseTestPlan',
  // assertion.ts
  'AssertionConditionTypeSchema',
  'AssertionConditionSchema',
  'AssertionSourceSchema',
  'UserAssertionSchema',
  'AssertionEvaluationResultSchema',
  'AssertionEvaluateInputSchema',
  'AssertionEvaluateOutputSchema',
  // recording.ts
  'SuggestedActionSchema',
  'RecordingStepSchema',
  'RecordingResultSchema',
  'parseRecordingResult',
  'safeParseRecordingResult',
  // test-data.ts
  'TestDataItemTypeSchema',
  'TestDataItemSchema',
  'GeneratedTestDataSchema',
  'TestDataContextSchema',
  'CredentialKindSchema',
  'CredentialRequestSchema',
  'CredentialResponseSchema',
  'CredentialEntrySchema',
  'CredentialResolveStatusSchema',
  'CredentialResolveResultSchema',
  'parseGeneratedTestData',
  'parseCredentialRequest',
  'parseCredentialResponse',
  // baseline-store.ts
  'BaselineRecordSchema',
  'BuildBaselineKeyInputSchema',
  'BaselineListFilterSchema',
  'buildBaselineKey',
  'parseBaselineKey',
  // ids.ts
  'createId',
];

/**
 * Compile-time presence guard for the 142 baseline type-only exports.
 * Each property is annotated with the corresponding exported type; removing
 * any of them from `src/index.ts` breaks `tsc --noEmit` (typecheck gate).
 */
const _baselineTypePresence: {
  ItestAgentConfig?: contractsTypes.ItestAgentConfig;
  ModelConfig?: contractsTypes.ModelConfig;
  DeviceConfig?: contractsTypes.DeviceConfig;
  TuiConfig?: contractsTypes.TuiConfig;
  AgentErrorCode?: contractsTypes.AgentErrorCode;
  AgentError?: contractsTypes.AgentError;
  RunState?: contractsTypes.RunState;
  PermissionEffect?: contractsTypes.PermissionEffect;
  SafetyGate?: contractsTypes.SafetyGate;
  PermissionRule?: contractsTypes.PermissionRule;
  ToolCall?: contractsTypes.ToolCall;
  ToolResult?: contractsTypes.ToolResult;
  AgentTurnInput?: contractsTypes.AgentTurnInput;
  AgentRuntime?: contractsTypes.AgentRuntime;
  TargetKind?: contractsTypes.TargetKind;
  ArtifactType?: contractsTypes.ArtifactType;
  RedactionStatus?: contractsTypes.RedactionStatus;
  ArtifactRef?: contractsTypes.ArtifactRef;
  DeviceInfo?: contractsTypes.DeviceInfo;
  DeviceSnapshot?: contractsTypes.DeviceSnapshot;
  DeviceTarget?: contractsTypes.DeviceTarget;
  HealthCheckResult?: contractsTypes.HealthCheckResult;
  BackendCapabilities?: contractsTypes.BackendCapabilities;
  AppInfo?: contractsTypes.AppInfo;
  ActionResult?: contractsTypes.ActionResult;
  UiTreeSnapshot?: contractsTypes.UiTreeSnapshot;
  CrashSummary?: contractsTypes.CrashSummary;
  RecordingHandle?: contractsTypes.RecordingHandle;
  LaunchAppInput?: contractsTypes.LaunchAppInput;
  TerminateAppInput?: contractsTypes.TerminateAppInput;
  TapInput?: contractsTypes.TapInput;
  SwipeInput?: contractsTypes.SwipeInput;
  TypeTextInput?: contractsTypes.TypeTextInput;
  PressButtonInput?: contractsTypes.PressButtonInput;
  OpenUrlInput?: contractsTypes.OpenUrlInput;
  ScreenshotInput?: contractsTypes.ScreenshotInput;
  RecordingInput?: contractsTypes.RecordingInput;
  LogCollectInput?: contractsTypes.LogCollectInput;
  BuildDoctorResult?: contractsTypes.BuildDoctorResult;
  SchemeInfo?: contractsTypes.SchemeInfo;
  BuildSettingsInput?: contractsTypes.BuildSettingsInput;
  BuildSettings?: contractsTypes.BuildSettings;
  BuildInput?: contractsTypes.BuildInput;
  BuildResult?: contractsTypes.BuildResult;
  TestInput?: contractsTypes.TestInput;
  TestResult?: contractsTypes.TestResult;
  ArchiveInput?: contractsTypes.ArchiveInput;
  ArchiveResult?: contractsTypes.ArchiveResult;
  BuildDriver?: contractsTypes.BuildDriver;
  DeviceBackend?: contractsTypes.DeviceBackend;
  ProjectDiscovery?: contractsTypes.ProjectDiscovery;
  ProjectGraph?: contractsTypes.ProjectGraph;
  BuildSettingsQuery?: contractsTypes.BuildSettingsQuery;
  ResolvedBuildSettings?: contractsTypes.ResolvedBuildSettings;
  SourceScanInput?: contractsTypes.SourceScanInput;
  SourceFacts?: contractsTypes.SourceFacts;
  ResourceScanInput?: contractsTypes.ResourceScanInput;
  ResourceFacts?: contractsTypes.ResourceFacts;
  ProjectAnalyzerBackend?: contractsTypes.ProjectAnalyzerBackend;
  AgentEventType?: contractsTypes.AgentEventType;
  SessionStartedEvent?: contractsTypes.SessionStartedEvent;
  TurnStartedEvent?: contractsTypes.TurnStartedEvent;
  AssistantDeltaEvent?: contractsTypes.AssistantDeltaEvent;
  ToolRequestedEvent?: contractsTypes.ToolRequestedEvent;
  PermissionRequestedEvent?: contractsTypes.PermissionRequestedEvent;
  PermissionResolvedEvent?: contractsTypes.PermissionResolvedEvent;
  ToolStartedEvent?: contractsTypes.ToolStartedEvent;
  ToolProgressEvent?: contractsTypes.ToolProgressEvent;
  ToolCompletedEvent?: contractsTypes.ToolCompletedEvent;
  ToolFailedEvent?: contractsTypes.ToolFailedEvent;
  RunStateChangedEvent?: contractsTypes.RunStateChangedEvent;
  ArtifactCreatedEvent?: contractsTypes.ArtifactCreatedEvent;
  TurnCompletedEvent?: contractsTypes.TurnCompletedEvent;
  SessionIdleEvent?: contractsTypes.SessionIdleEvent;
  SessionAbortedEvent?: contractsTypes.SessionAbortedEvent;
  SessionErrorEvent?: contractsTypes.SessionErrorEvent;
  AgentEvent?: contractsTypes.AgentEvent;
  TraceRecordInput?: contractsTypes.TraceRecordInput;
  TraceExportInput?: contractsTypes.TraceExportInput;
  TraceExportStatus?: contractsTypes.TraceExportStatus;
  TraceSummaryInput?: contractsTypes.TraceSummaryInput;
  TraceSummary?: contractsTypes.TraceSummary;
  SymbolicateInput?: contractsTypes.SymbolicateInput;
  BaselineCompareInput?: contractsTypes.BaselineCompareInput;
  BaselineDelta?: contractsTypes.BaselineDelta;
  PerformanceBackend?: contractsTypes.PerformanceBackend;
  ArtifactInput?: contractsTypes.ArtifactInput;
  StoreDriver?: contractsTypes.StoreDriver;
  SecretStore?: contractsTypes.SecretStore;
  ArtifactStore?: contractsTypes.ArtifactStore;
  RunStatus?: contractsTypes.RunStatus;
  PerformanceMetrics?: contractsTypes.PerformanceMetrics;
  ExecutionSummary?: contractsTypes.ExecutionSummary;
  TestCaseResult?: contractsTypes.TestCaseResult;
  FailureExplanation?: contractsTypes.FailureExplanation;
  RunStep?: contractsTypes.RunStep;
  RunResult?: contractsTypes.RunResult;
  ArtifactIndex?: contractsTypes.ArtifactIndex;
  Scope?: contractsTypes.Scope;
  Intent?: contractsTypes.Intent;
  Clarification?: contractsTypes.Clarification;
  IntentParseResult?: contractsTypes.IntentParseResult;
  CompleteResult?: contractsTypes.CompleteResult;
  IncompleteResult?: contractsTypes.IncompleteResult;
  DeviceSelector?: contractsTypes.DeviceSelector;
  PhysicalDeviceSelector?: contractsTypes.PhysicalDeviceSelector;
  SimulatorDeviceSelector?: contractsTypes.SimulatorDeviceSelector;
  Target?: contractsTypes.Target;
  AppSource?: contractsTypes.AppSource;
  BackendPreference?: contractsTypes.BackendPreference;
  ExecutionPlan?: contractsTypes.ExecutionPlan;
  AssertionPolicy?: contractsTypes.AssertionPolicy;
  TestDataPolicy?: contractsTypes.TestDataPolicy;
  ArtifactPolicy?: contractsTypes.ArtifactPolicy;
  PerformancePlan?: contractsTypes.PerformancePlan;
  PermissionPolicyRef?: contractsTypes.PermissionPolicyRef;
  TestPlan?: contractsTypes.TestPlan;
  AssertionConditionType?: contractsTypes.AssertionConditionType;
  AssertionCondition?: contractsTypes.AssertionCondition;
  AssertionSource?: contractsTypes.AssertionSource;
  UserAssertion?: contractsTypes.UserAssertion;
  AssertionEvaluationResult?: contractsTypes.AssertionEvaluationResult;
  AssertionEvaluateInput?: contractsTypes.AssertionEvaluateInput;
  AssertionEvaluateOutput?: contractsTypes.AssertionEvaluateOutput;
  SuggestedAction?: contractsTypes.SuggestedAction;
  RecordingStep?: contractsTypes.RecordingStep;
  RecordingResult?: contractsTypes.RecordingResult;
  TestDataItemType?: contractsTypes.TestDataItemType;
  TestDataItem?: contractsTypes.TestDataItem;
  GeneratedTestData?: contractsTypes.GeneratedTestData;
  TestDataContext?: contractsTypes.TestDataContext;
  CredentialKind?: contractsTypes.CredentialKind;
  CredentialRequest?: contractsTypes.CredentialRequest;
  CredentialResponse?: contractsTypes.CredentialResponse;
  CredentialEntry?: contractsTypes.CredentialEntry;
  CredentialResolveStatus?: contractsTypes.CredentialResolveStatus;
  CredentialResolveResult?: contractsTypes.CredentialResolveResult;
  CredentialManager?: contractsTypes.CredentialManager;
  BaselineRecord?: contractsTypes.BaselineRecord;
  BuildBaselineKeyInput?: contractsTypes.BuildBaselineKeyInput;
  BaselineListFilter?: contractsTypes.BaselineListFilter;
  BaselineStore?: contractsTypes.BaselineStore;
} = {};

test('every baseline value export (158) is still present in the barrel', () => {
  expect(BASELINE_VALUE_EXPORTS).toHaveLength(158);
  const missing: string[] = [];
  for (const name of BASELINE_VALUE_EXPORTS) {
    if (!(name in contracts)) {
      missing.push(name);
    }
  }
  expect(missing).toEqual([]);
});

test('every baseline value export is defined (not undefined)', () => {
  const undefinedNames = BASELINE_VALUE_EXPORTS.filter(
    (name) => (contracts as Record<string, unknown>)[name] === undefined,
  );
  expect(undefinedNames).toEqual([]);
});

test('barrel does not lose baseline symbols after device-core split', () => {
  // Spot-check the moved device-core symbols through the barrel.
  expect(contracts.TargetKindSchema).toBe(artifacts.TargetKindSchema);
  expect(contracts.ArtifactRefSchema).toBe(artifacts.ArtifactRefSchema);
  expect(contracts.parseArtifactRef).toBe(artifacts.parseArtifactRef);
  expect(contracts.DeviceInfoSchema).toBe(identity.DeviceInfoSchema);
  expect(contracts.BackendCapabilitiesSchema).toBe(identity.BackendCapabilitiesSchema);
  expect(contracts.ActionResultSchema).toBe(runtime.ActionResultSchema);
  expect(contracts.RecordingHandleSchema).toBe(runtime.RecordingHandleSchema);
  expect(contracts.LaunchAppInputSchema).toBe(actionInputs.LaunchAppInputSchema);
  expect(contracts.LogCollectInputSchema).toBe(actionInputs.LogCollectInputSchema);
});

test('compile-time type-presence guard object is wired', () => {
  // The guard's protection lives in its type annotations (enforced by
  // `bun run typecheck`), not in runtime values — all keys are optional.
  expect(_baselineTypePresence).toEqual({});
});

// ─── New focused modules export their slice symbols ──────────

test('device-artifacts module exports its slice', () => {
  const expected = [
    'TargetKindSchema',
    'ArtifactTypeSchema',
    'RedactionStatusSchema',
    'ArtifactRefSchema',
    'parseArtifactRef',
  ];
  for (const name of expected) {
    expect(name in artifacts).toBe(true);
  }
});

test('device-identity module exports its slice', () => {
  const expected = [
    'DeviceInfoSchema',
    'DeviceSnapshotSchema',
    'DeviceTargetSchema',
    'HealthCheckResultSchema',
    'BackendCapabilitiesSchema',
  ];
  for (const name of expected) {
    expect(name in identity).toBe(true);
  }
});

test('device-runtime module exports its slice', () => {
  const expected = [
    'ActionResultSchema',
    'UiTreeSnapshotSchema',
    'CrashSummarySchema',
    'RecordingHandleSchema',
  ];
  for (const name of expected) {
    expect(name in runtime).toBe(true);
  }
});

test('device-action-inputs module exports its slice', () => {
  const expected = [
    'LaunchAppInputSchema',
    'TerminateAppInputSchema',
    'TapInputSchema',
    'SwipeInputSchema',
    'TypeTextInputSchema',
    'PressButtonInputSchema',
    'OpenUrlInputSchema',
    'ScreenshotInputSchema',
    'RecordingInputSchema',
    'LogCollectInputSchema',
  ];
  for (const name of expected) {
    expect(name in actionInputs).toBe(true);
  }
});

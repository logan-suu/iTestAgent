import type { Intent, IntentParseResult, TestPlan } from 'itestagent-contracts';
import type {
  CandidateLink,
  ProjectAnalysisResult,
  ProjectProfile,
} from 'itestagent-project-analyzer';
import {
  type ExecutionRouteResolution,
  resolveExecutionRoute,
} from './execution-route-resolver.js';
import { parseIntent } from './intent-parser.js';
import { compileTestPlan } from './test-plan-compiler.js';

export type PlanningStatus =
  | 'idle'
  | 'awaiting_clarification'
  | 'awaiting_candidate_confirmation'
  | 'awaiting_execution_route_selection'
  | 'execution_route_blocked'
  | 'awaiting_plan_confirmation'
  | 'confirmed'
  | 'cancelled';

export interface PlanningSnapshot {
  readonly status: PlanningStatus;
  readonly analysis: ProjectAnalysisResult;
  readonly intentResult: IntentParseResult | null;
  readonly candidates: readonly CandidateLink[];
  readonly plan: TestPlan | null;
  readonly executionRoute: ExecutionRouteResolution | null;
}

export class PlanningSessionError extends Error {
  readonly code:
    | 'intent_incomplete'
    | 'candidate_confirmation_required'
    | 'candidate_not_confirmed'
    | 'execution_route_selection_required'
    | 'execution_route_blocked'
    | 'plan_unavailable'
    | 'invalid_transition';

  constructor(code: PlanningSessionError['code'], message: string) {
    super(`${code}: ${message}`);
    this.name = 'PlanningSessionError';
    this.code = code;
  }
}

/**
 * State holder for the production S1→S3 planning boundary.
 * It owns no device/build capability and cannot execute a TestPlan.
 */
export class PlanningSession {
  private readonly analysis: ProjectAnalysisResult;
  private status: PlanningStatus = 'idle';
  private intentResult: IntentParseResult | null = null;
  private candidates: CandidateLink[];
  private reviewedProfile: ProjectProfile;
  private plan: TestPlan | null = null;
  private executionRoute: ExecutionRouteResolution | null = null;
  private conversation: string[] = [];

  constructor(analysis: ProjectAnalysisResult) {
    this.analysis = clonePlanningValue(analysis);
    this.candidates = this.analysis.profile.features.map((candidate) => ({
      ...candidate,
      confirmed: false,
    }));
    this.reviewedProfile = { ...this.analysis.profile, features: this.candidates };
  }

  begin(input: string): PlanningSnapshot {
    this.requireStatus('idle', 'begin');
    this.conversation = [input];
    return this.parseConversation();
  }

  clarify(input: string): PlanningSnapshot {
    if (this.status !== 'awaiting_clarification') {
      throw new PlanningSessionError('intent_incomplete', 'there is no pending clarification');
    }
    this.conversation.push(input);
    return this.parseConversation();
  }

  confirmCandidates(reviewedCandidates: readonly CandidateLink[]): PlanningSnapshot {
    this.requireStatus('awaiting_candidate_confirmation', 'confirm candidates');
    if (!this.intentResult || this.intentResult.status !== 'complete') {
      throw new PlanningSessionError('intent_incomplete', 'complete the intent before review');
    }

    const reviewed = clonePlanningValue([...reviewedCandidates]);
    const confirmed = reviewed.filter((candidate) => candidate.confirmed);
    if (confirmed.length === 0) {
      throw new PlanningSessionError(
        'candidate_confirmation_required',
        'select at least one evidence-backed candidate',
      );
    }

    const unmatchedSources = [...this.analysis.profile.features];
    for (const candidate of reviewed) {
      const sourceIndex = unmatchedSources.findIndex(
        (source) =>
          source.confidence === candidate.confidence &&
          sameEvidence(source.evidence, candidate.evidence),
      );
      if (sourceIndex === -1) {
        throw new PlanningSessionError(
          'candidate_confirmation_required',
          `candidate ${candidate.name} does not have unique evidence from the analyzed Project Profile`,
        );
      }
      unmatchedSources.splice(sourceIndex, 1);
    }

    for (const candidate of confirmed) {
      if (candidate.evidence.length === 0 || candidate.confidence < 0 || candidate.confidence > 1) {
        throw new PlanningSessionError(
          'candidate_confirmation_required',
          `candidate ${candidate.name} is missing valid evidence or confidence`,
        );
      }
    }

    const candidates = reviewed.map((candidate, displayOrder) => ({
      ...candidate,
      displayOrder,
    }));
    const reviewedProfile = { ...this.analysis.profile, features: candidates };
    const intent: Intent = {
      ...this.intentResult.intent,
      features: confirmed.map((candidate) => candidate.name),
    };
    this.candidates = candidates;
    this.reviewedProfile = reviewedProfile;
    this.intentResult = { status: 'complete', intent };
    return this.resolvePlan(intent);
  }

  selectExecutionRoute(scheme: string, testPlan?: string): PlanningSnapshot {
    this.requireStatus('awaiting_execution_route_selection', 'select execution route');
    if (!this.intentResult || this.intentResult.status !== 'complete') {
      throw new PlanningSessionError(
        'intent_incomplete',
        'complete the intent before route review',
      );
    }
    const intent: Intent = {
      ...this.intentResult.intent,
      xcuitestScheme: scheme,
      ...(testPlan ? { xcuitestTestPlan: testPlan } : {}),
    };
    return this.resolvePlan(intent, true);
  }

  selectExecutionRouteFromInput(input: string): PlanningSnapshot {
    this.requireStatus('awaiting_execution_route_selection', 'select execution route');
    const parsed = parseIntent(input, this.reviewedProfile).intent;
    if (!parsed.xcuitestScheme) {
      throw new PlanningSessionError(
        'execution_route_selection_required',
        'specify the route as: scheme <name> [test plan <name>]',
      );
    }
    return this.selectExecutionRoute(parsed.xcuitestScheme, parsed.xcuitestTestPlan);
  }

  modifyPlan(input: string): PlanningSnapshot {
    this.requireStatus('awaiting_plan_confirmation', 'modify plan');
    if (!this.plan || !this.intentResult || this.intentResult.status !== 'complete') {
      throw new PlanningSessionError('plan_unavailable', 'there is no draft plan to modify');
    }

    const currentIntent = this.intentResult.intent;
    const parsed = parseIntent(input, this.reviewedProfile);
    const requested = parsed.intent.features;
    const confirmedNames = new Set(
      this.candidates.filter((candidate) => candidate.confirmed).map((candidate) => candidate.name),
    );
    const unconfirmed = requested.filter((name) => !confirmedNames.has(name));
    if (unconfirmed.length > 0) {
      throw new PlanningSessionError(
        'candidate_not_confirmed',
        `confirm these candidates before adding them: ${unconfirmed.join(', ')}`,
      );
    }

    const features = resolveModifiedFeatures(
      input,
      currentIntent.features,
      requested,
      this.candidates,
    );
    if (features.length === 0) {
      throw new PlanningSessionError(
        'candidate_confirmation_required',
        'a plan must retain at least one confirmed candidate',
      );
    }

    const intent: Intent = {
      ...currentIntent,
      goal: parsed.intent.goal || currentIntent.goal,
      targetKind: parsed.intent.targetKind ?? currentIntent.targetKind,
      executionPreference: parsed.intent.executionPreference ?? currentIntent.executionPreference,
      xcuitestScheme: parsed.intent.xcuitestScheme ?? currentIntent.xcuitestScheme,
      xcuitestTestPlan: parsed.intent.xcuitestTestPlan ?? currentIntent.xcuitestTestPlan,
      features,
      metricsRequested: parsed.intent.metricsRequested || currentIntent.metricsRequested,
      scope: parsed.intent.scope === 'custom' ? currentIntent.scope : parsed.intent.scope,
      sourceText: `${currentIntent.sourceText}\nModification: ${input}`,
    };
    this.intentResult = { status: 'complete', intent };
    return this.resolvePlan(intent, false, {
      runId: this.plan.runId,
      projectProfileRef: this.plan.projectProfileRef,
    });
  }

  confirmPlan(): TestPlan {
    this.requireStatus('awaiting_plan_confirmation', 'confirm plan');
    if (!this.plan) {
      throw new PlanningSessionError('plan_unavailable', 'there is no draft plan to confirm');
    }
    this.status = 'confirmed';
    return clonePlanningValue(this.plan);
  }

  cancel(): PlanningSnapshot {
    this.requireStatus('awaiting_plan_confirmation', 'cancel plan');
    this.status = 'cancelled';
    this.plan = null;
    return this.snapshot();
  }

  getConfirmedPlan(): TestPlan | null {
    return this.status === 'confirmed' && this.plan ? clonePlanningValue(this.plan) : null;
  }

  getSnapshot(): PlanningSnapshot {
    return this.snapshot();
  }

  private parseConversation(): PlanningSnapshot {
    this.intentResult = parseIntent(this.conversation.join('\n'), this.analysis.profile);
    this.status =
      this.intentResult.status === 'complete'
        ? 'awaiting_candidate_confirmation'
        : 'awaiting_clarification';
    return this.snapshot();
  }

  private requireStatus(expected: PlanningStatus, action: string): void {
    if (this.status !== expected) {
      throw new PlanningSessionError(
        'invalid_transition',
        `${action} requires ${expected}; current status is ${this.status}`,
      );
    }
  }

  private snapshot(): PlanningSnapshot {
    return clonePlanningValue({
      status: this.status,
      analysis: this.analysis,
      intentResult: this.intentResult,
      candidates: this.candidates,
      plan: this.plan,
      executionRoute: this.executionRoute,
    });
  }

  private resolvePlan(
    intent: Intent,
    selectedAfterAmbiguity = false,
    identity?: { runId: string; projectProfileRef: string },
  ): PlanningSnapshot {
    const resolution = resolveExecutionRoute({
      preference: intent.executionPreference ?? 'auto',
      targetKind: intent.targetKind ?? 'physical',
      configurations: this.analysis.analysis.executionAssets?.configurations ?? [],
      ...(intent.xcuitestScheme ? { selectedScheme: intent.xcuitestScheme } : {}),
      ...(intent.xcuitestTestPlan ? { selectedTestPlan: intent.xcuitestTestPlan } : {}),
      selectedAfterAmbiguity,
    });
    this.executionRoute = resolution;
    this.intentResult = { status: 'complete', intent };
    this.plan = null;

    if (resolution.status === 'ambiguous') {
      this.status = 'awaiting_execution_route_selection';
      return this.snapshot();
    }
    if (resolution.status === 'blocked') {
      this.status = 'execution_route_blocked';
      return this.snapshot();
    }

    this.plan = compileTestPlan(intent, this.reviewedProfile, {
      confirmedOnly: true,
      executionRoute: resolution,
      ...(identity ?? {}),
    });
    this.status = 'awaiting_plan_confirmation';
    return this.snapshot();
  }
}

function clonePlanningValue<T>(value: T): T {
  return structuredClone(value);
}

function sameEvidence(source: readonly string[], reviewed: readonly string[]): boolean {
  return (
    source.length === reviewed.length && source.every((value, index) => value === reviewed[index])
  );
}

function resolveModifiedFeatures(
  input: string,
  current: readonly string[],
  requested: readonly string[],
  candidates: readonly CandidateLink[],
): string[] {
  const normalized = input.toLowerCase();
  const onlyMode = /(?:只|仅|only)\s*/i.test(input);
  const requestedSet = new Set(requested);
  const negativeNames = new Set<string>();

  for (const candidate of candidates) {
    const terms = [candidate.name, ...(candidate.keywords ?? [])];
    if (terms.some((term) => isNegated(normalized, term.toLowerCase()))) {
      negativeNames.add(candidate.name);
    }
  }

  const base = onlyMode && requested.length > 0 ? requested : [...current, ...requested];
  return [...new Set(base)]
    .filter((name) => requestedSet.has(name) || current.includes(name))
    .filter((name) => !negativeNames.has(name));
}

function isNegated(input: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(?:不要|不跑|排除|去掉|without|exclude|skip|not)(?:\\s|[^,，。;；]){0,12}${escaped}`,
    'i',
  ).test(input);
}

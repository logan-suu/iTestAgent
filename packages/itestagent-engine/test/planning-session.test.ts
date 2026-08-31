import { describe, expect, it } from 'bun:test';
import type { ProjectAnalysisResult } from 'itestagent-project-analyzer';
import { PlanningSession, PlanningSessionError } from '../src/planning-session.js';

function analysis(): ProjectAnalysisResult {
  return {
    profile: {
      schemaVersion: 'itestagent.project-profile.v1',
      projectHash: 'a'.repeat(64),
      app: { name: 'Demo', workspace: '/workspace/Demo.xcworkspace', scheme: 'Demo' },
      targets: [{ name: 'Demo', type: 'app' }],
      testAssets: { hasXCUITest: false, hasScheme: true },
      features: [
        {
          name: 'Login',
          keywords: ['login', '登录'],
          evidence: ['LoginViewController.swift'],
          confidence: 0.8,
          confirmed: false,
          displayOrder: 0,
        },
        {
          name: 'Checkout',
          keywords: ['checkout', '下单'],
          evidence: ['CheckoutViewController.swift'],
          confidence: 0.7,
          confirmed: false,
          displayOrder: 1,
        },
      ],
      suggestedSmoke: ['launch', 'Login', 'Checkout'],
    },
    analysis: {
      analysisTier: 'tier1_static',
      enabledCapabilities: ['xcodebuild_discovery', 'static_source_candidates'],
      limitations: ['Candidates require confirmation.'],
    },
  };
}

describe('PlanningSession', () => {
  it('supports clarification before candidate review', () => {
    const session = new PlanningSession(analysis());
    expect(session.begin('跑登录 smoke').status).toBe('awaiting_clarification');
    const clarified = session.clarify('用本机 iPhone');
    expect(clarified.status).toBe('awaiting_candidate_confirmation');
    expect(clarified.intentResult?.intent.targetKind).toBe('physical');
  });

  it('refuses compilation until a candidate is explicitly confirmed', () => {
    const session = new PlanningSession(analysis());
    const snapshot = session.begin('用本机 iPhone 跑登录 smoke');
    expect(() => session.confirmCandidates(snapshot.candidates)).toThrow(
      'candidate_confirmation_required',
    );
    expect(session.getConfirmedPlan()).toBeNull();
  });

  it('compiles only confirmed candidates and waits for plan confirmation', () => {
    const session = new PlanningSession(analysis());
    const snapshot = session.begin('用本机 iPhone 跑登录和下单 smoke');
    const reviewed = snapshot.candidates.map((candidate) => ({
      ...candidate,
      confirmed: candidate.name === 'Login',
    }));
    const planned = session.confirmCandidates(reviewed);
    expect(planned.status).toBe('awaiting_plan_confirmation');
    expect(planned.plan?.execution.features).toEqual(['Login']);
    expect(session.getConfirmedPlan()).toBeNull();
  });

  it('applies natural-language removal without changing run identity', () => {
    const session = new PlanningSession(analysis());
    const snapshot = session.begin('用本机 iPhone 跑登录和下单 smoke');
    const planned = session.confirmCandidates(
      snapshot.candidates.map((candidate) => ({ ...candidate, confirmed: true })),
    );
    const modified = session.modifyPlan('只跑登录，不要下单');
    expect(modified.plan?.execution.features).toEqual(['Login']);
    expect(modified.plan?.runId).toBe(planned.plan?.runId);
    expect(modified.plan?.projectProfileRef).toBe(planned.plan?.projectProfileRef);
  });

  it('returns a plan only after explicit confirmation and clears it on cancel', () => {
    const session = new PlanningSession(analysis());
    const snapshot = session.begin('用本机 iPhone 跑登录 smoke');
    session.confirmCandidates(
      snapshot.candidates.map((candidate) => ({
        ...candidate,
        confirmed: candidate.name === 'Login',
      })),
    );
    expect(session.getConfirmedPlan()).toBeNull();
    expect(session.confirmPlan().execution.features).toEqual(['Login']);
    expect(session.getConfirmedPlan()?.execution.features).toEqual(['Login']);
    expect(session.cancel().status).toBe('cancelled');
    expect(session.getConfirmedPlan()).toBeNull();
  });

  it('rejects a modification that adds an unconfirmed candidate', () => {
    const session = new PlanningSession(analysis());
    const snapshot = session.begin('用本机 iPhone 跑登录 smoke');
    session.confirmCandidates(
      snapshot.candidates.map((candidate) => ({
        ...candidate,
        confirmed: candidate.name === 'Login',
      })),
    );
    expect(() => session.modifyPlan('再加上下单')).toThrow(PlanningSessionError);
    expect(() => session.modifyPlan('再加上下单')).toThrow('candidate_not_confirmed');
  });

  it('rejects candidates that do not originate from the analyzed Project Profile', () => {
    const session = new PlanningSession(analysis());
    const snapshot = session.begin('用本机 iPhone 跑登录 smoke');
    expect(() =>
      session.confirmCandidates([
        ...snapshot.candidates,
        {
          name: 'Injected',
          keywords: ['injected'],
          evidence: ['untrusted-input'],
          confidence: 1,
          confirmed: true,
          displayOrder: 2,
        },
      ]),
    ).toThrow('does not have unique evidence from the analyzed Project Profile');
  });

  it('rejects altered evidence or confidence during candidate review', () => {
    const session = new PlanningSession(analysis());
    const snapshot = session.begin('用本机 iPhone 跑登录 smoke');
    expect(() =>
      session.confirmCandidates(
        snapshot.candidates.map((candidate) => ({
          ...candidate,
          evidence: candidate.name === 'Login' ? ['fabricated'] : candidate.evidence,
          confirmed: candidate.name === 'Login',
        })),
      ),
    ).toThrow('does not have unique evidence from the analyzed Project Profile');
  });

  it('allows the user to correct a candidate name while retaining its evidence', () => {
    const session = new PlanningSession(analysis());
    const snapshot = session.begin('用本机 iPhone 跑登录 smoke');
    const planned = session.confirmCandidates(
      snapshot.candidates.map((candidate) => ({
        ...candidate,
        name: candidate.name === 'Login' ? 'Account Login' : candidate.name,
        confirmed: candidate.name === 'Login',
      })),
    );
    expect(planned.plan?.execution.features).toEqual(['Account Login']);
  });
});

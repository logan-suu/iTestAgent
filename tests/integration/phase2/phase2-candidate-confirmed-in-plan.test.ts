/**
 * Phase 2 integration test — Candidate link confirmation in TestPlan.
 *
 * US-3.3 AC3: only user-confirmed candidate links enter TestPlan execution.
 * Cross-package chain: project-analyzer → engine → contracts
 */
import { describe, expect, it } from 'bun:test';
import { type TestPlan, TestPlanSchema } from 'itestagent-contracts';
import { compileTestPlan, parseIntent, parseTestPlanYaml, testPlanToYaml } from 'itestagent-engine';
import type { CandidateLink, ProjectProfile } from 'itestagent-project-analyzer';

// ─── Helpers ─────────────────────────────────────────────────

function makeProfile(features: CandidateLink[], suggestedSmoke?: string[]): ProjectProfile {
  return {
    schemaVersion: 'itestagent.project-profile.v1',
    projectHash: 'b'.repeat(64),
    app: { name: 'TestApp', bundleId: 'com.example.TestApp' },
    targets: [{ name: 'TestApp', type: 'app' }],
    testAssets: { hasXCUITest: false, hasScheme: true },
    features,
    suggestedSmoke: suggestedSmoke ?? ['launch', 'login', 'checkout', 'search'],
  };
}

function makeValidTestPlan(plan: TestPlan): void {
  const result = TestPlanSchema.safeParse(plan);
  if (!result.success) {
    throw new Error(`TestPlan validation failed: ${result.error.message}`);
  }
}

// ─── Tests ───────────────────────────────────────────────────

describe('Phase 2 integration: confirmedOnly filter', () => {
  it('includes only confirmed features in TestPlan when confirmedOnly=true', () => {
    const profile = makeProfile([
      {
        name: 'login',
        entry: 'LoginViewController',
        keywords: ['登录'],
        testability: 'device_backend',
        evidence: ['Source: LoginViewController.swift'],
        confidence: 0.8,
        confirmed: true,
        displayOrder: 0,
      },
      {
        name: 'checkout',
        entry: 'CheckoutViewController',
        keywords: ['结算'],
        testability: 'device_backend',
        evidence: ['Source: CheckoutViewController.swift'],
        confidence: 0.6,
        confirmed: false,
        displayOrder: 1,
      },
      {
        name: 'search',
        entry: 'SearchViewController',
        keywords: ['search'],
        testability: 'device_backend',
        evidence: ['Source: SearchViewController.swift'],
        confidence: 0.5,
        confirmed: true,
        displayOrder: 2,
      },
    ]);

    const intentResult = parseIntent('test login checkout search', profile);
    expect(intentResult.status).toBe('complete');
    if (intentResult.status !== 'complete') return;

    const plan = compileTestPlan(intentResult.intent, profile, { confirmedOnly: true });

    // Only login + search (confirmed) should appear; checkout (unconfirmed) filtered out
    expect(plan.execution.features).toContain('login');
    expect(plan.execution.features).toContain('search');
    expect(plan.execution.features).not.toContain('checkout');

    makeValidTestPlan(plan);
  });

  it('falls back to suggestedSmoke when no confirmed features match intent', () => {
    const profile = makeProfile([
      {
        name: 'login',
        entry: 'LoginViewController',
        keywords: ['登录'],
        testability: 'device_backend',
        evidence: ['Source: LoginViewController.swift'],
        confidence: 0.8,
        confirmed: false,
        displayOrder: 0,
      },
      {
        name: 'checkout',
        entry: 'CheckoutViewController',
        keywords: ['结算'],
        testability: 'device_backend',
        evidence: ['Source: CheckoutViewController.swift'],
        confidence: 0.6,
        confirmed: false,
        displayOrder: 1,
      },
    ]);

    const intentResult = parseIntent('test login checkout', profile);
    expect(intentResult.status).toBe('complete');
    if (intentResult.status !== 'complete') return;

    const plan = compileTestPlan(intentResult.intent, profile, { confirmedOnly: true });

    // Both features matched by intent but NEITHER confirmed → filtered out
    // Should fall back to suggestedSmoke as default feature set
    expect(plan.execution.features).toEqual(profile.suggestedSmoke);

    makeValidTestPlan(plan);
  });

  it('includes all matched features when confirmedOnly is false (default)', () => {
    const profile = makeProfile([
      {
        name: 'login',
        entry: 'LoginViewController',
        keywords: ['登录'],
        testability: 'device_backend',
        evidence: ['Source: LoginViewController.swift'],
        confidence: 0.8,
        confirmed: true,
        displayOrder: 0,
      },
      {
        name: 'checkout',
        entry: 'CheckoutViewController',
        keywords: ['结算'],
        testability: 'device_backend',
        evidence: ['Source: CheckoutViewController.swift'],
        confidence: 0.6,
        confirmed: false,
        displayOrder: 1,
      },
    ]);

    const intentResult = parseIntent('test login checkout', profile);
    expect(intentResult.status).toBe('complete');
    if (intentResult.status !== 'complete') return;

    // Default: confirmedOnly omitted → all matched features included
    const plan = compileTestPlan(intentResult.intent, profile);

    expect(plan.execution.features).toContain('login');
    expect(plan.execution.features).toContain('checkout');

    makeValidTestPlan(plan);
  });

  it('returns empty features array when confirmedOnly and no confirmed candidates', () => {
    const profile = makeProfile([
      {
        name: 'launch',
        entry: 'AppDelegate',
        keywords: ['launch'],
        testability: 'device_backend',
        evidence: ['Source: AppDelegate.swift'],
        confidence: 0.9,
        confirmed: false,
        displayOrder: 0,
      },
    ]);

    const intentResult = parseIntent('test launch on device', profile);
    expect(intentResult.status).toBe('complete');
    if (intentResult.status !== 'complete') return;

    const plan = compileTestPlan(intentResult.intent, profile, { confirmedOnly: true });

    // Feature matched but NOT confirmed → filtered out, fallback to suggestedSmoke
    expect(plan.execution.features).toEqual(profile.suggestedSmoke);

    makeValidTestPlan(plan);
  });

  it('preserves confirmed-only behavior across YAML round-trip', () => {
    const profile = makeProfile([
      {
        name: 'login',
        entry: 'LoginViewController',
        keywords: ['登录'],
        testability: 'device_backend',
        evidence: ['Source: LoginViewController.swift'],
        confidence: 0.8,
        confirmed: true,
        displayOrder: 0,
      },
      {
        name: 'settings',
        entry: 'SettingsViewController',
        keywords: ['settings'],
        testability: 'device_backend',
        evidence: ['Source: SettingsViewController.swift'],
        confidence: 0.4,
        confirmed: false,
        displayOrder: 1,
      },
    ]);

    const intentResult = parseIntent('test login settings', profile);
    expect(intentResult.status).toBe('complete');
    if (intentResult.status !== 'complete') return;

    const plan = compileTestPlan(intentResult.intent, profile, { confirmedOnly: true });

    // Only login is confirmed
    expect(plan.execution.features).toContain('login');
    expect(plan.execution.features).not.toContain('settings');

    // YAML serialization preserves the filtered features
    const yamlStr = testPlanToYaml(plan);
    const parsed = parseTestPlanYaml(yamlStr);

    expect(parsed.execution.features).toEqual(plan.execution.features);
    expect(parsed.execution.features).toContain('login');
    expect(parsed.execution.features).not.toContain('settings');

    makeValidTestPlan(parsed);
  });
});

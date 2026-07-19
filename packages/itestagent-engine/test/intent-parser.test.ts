import { describe, expect, it } from 'bun:test';
import type { ProjectProfile } from 'itestagent-project-analyzer';
import { parseIntent } from '../src/intent-parser.js';

function makeProfile(overrides?: Partial<ProjectProfile>): ProjectProfile {
  return {
    schemaVersion: 'itestagent.project-profile.v1',
    projectHash: 'a'.repeat(64),
    app: {
      name: 'TestApp',
      bundleId: 'com.example.testapp',
      scheme: 'TestApp',
    },
    targets: [{ name: 'TestApp', type: 'app', bundleId: 'com.example.testapp' }],
    testAssets: {
      hasXCUITest: false,
      hasScheme: true,
      testTargets: [],
    },
    features: [
      {
        name: 'Login',
        entry: 'LoginViewController',
        keywords: ['login', 'signin'],
        testability: 'device_backend',
        requiresAccount: true,
        evidence: ['Source: LoginViewController.swift'],
        confidence: 0.75,
        confirmed: false,
        displayOrder: 0,
      },
      {
        name: 'Settings',
        entry: 'SettingsViewController',
        keywords: ['settings'],
        testability: 'device_backend',
        evidence: ['Source: SettingsViewController.swift'],
        confidence: 0.75,
        confirmed: false,
        displayOrder: 1,
      },
      {
        name: 'Search',
        entry: 'SearchViewController',
        keywords: ['search'],
        testability: 'device_backend',
        evidence: ['Source: SearchViewController.swift'],
        confidence: 0.75,
        confirmed: false,
        displayOrder: 2,
      },
    ],
    suggestedSmoke: ['launch', 'Login', 'Settings', 'Search'],
    ...overrides,
  };
}

const profile = makeProfile();

describe('parseIntent', () => {
  // ── Complete results ──────────────────────────────────────

  describe('complete intent (no profile needed)', () => {
    it('parses a simple explore request', () => {
      const result = parseIntent('explore the app', undefined);
      expect(result.status).toBe('complete');
      if (result.status === 'complete') {
        expect(result.intent.scope).toBe('explore');
        expect(result.intent.metricsRequested).toBe(false);
        expect(result.intent.features).toEqual([]);
        expect(result.intent.goal).toBe('exploration');
        expect(result.intent.sourceText).toBe('explore the app');
      }
    });

    it('parses English smoke test request', () => {
      const result = parseIntent('run a smoke test on my phone', undefined);
      expect(result.status).toBe('complete');
      if (result.status === 'complete') {
        expect(result.intent.scope).toBe('smoke');
        expect(result.intent.targetKind).toBe('physical');
      }
    });

    it('parses Chinese input with device and metrics', () => {
      const result = parseIntent('帮我用本机iPhone跑一下性能测试', undefined);
      expect(result.status).toBe('complete');
      if (result.status === 'complete') {
        expect(result.intent.scope).toBe('perf');
        expect(result.intent.targetKind).toBe('physical');
        expect(result.intent.metricsRequested).toBe(true);
      }
    });

    it('parses Chinese simulator request', () => {
      const result = parseIntent('在模拟器上跑冒烟测试', undefined);
      expect(result.status).toBe('complete');
      if (result.status === 'complete') {
        expect(result.intent.targetKind).toBe('simulator');
        expect(result.intent.scope).toBe('smoke');
      }
    });

    it('parses full regression request', () => {
      const result = parseIntent('full regression test on simulator', undefined);
      expect(result.status).toBe('complete');
      if (result.status === 'complete') {
        expect(result.intent.scope).toBe('full');
        expect(result.intent.targetKind).toBe('simulator');
      }
    });
  });

  // ── Feature matching with profile ─────────────────────────

  describe('feature matching with profile', () => {
    it('matches feature by exact name', () => {
      const result = parseIntent('run login test on my iPhone', profile);
      expect(result.status).toBe('complete');
      if (result.status === 'complete') {
        expect(result.intent.features).toEqual(['Login']);
        expect(result.intent.targetKind).toBe('physical');
      }
    });

    it('asks for targetKind when device not specified in smoke test with features', () => {
      const result = parseIntent('帮我跑一下登录的smoke测试', profile);
      expect(result.status).toBe('incomplete');
      if (result.status === 'incomplete') {
        const fieldSet = new Set(result.clarificationsNeeded.map((c) => c.field));
        expect(fieldSet.has('targetKind')).toBe(true);
        expect(result.intent.features).toContain('Login');
        expect(result.intent.scope).toBe('smoke');
      }
    });

    it('matches multiple features', () => {
      const result = parseIntent('测试登录和设置页面', profile);
      expect(result.status).toBe('complete');
      if (result.status === 'complete') {
        expect(result.intent.features).toContain('Login');
        expect(result.intent.features).toContain('Settings');
      }
    });

    it('matches feature by English keyword but incomplete without targetKind', () => {
      const result = parseIntent('run signin smoke test', profile);
      expect(result.status).toBe('incomplete');
      if (result.status === 'incomplete') {
        expect(result.intent.features).toContain('Login');
        expect(result.intent.scope).toBe('smoke');
      }
    });

    it('matches case-insensitively', () => {
      const result = parseIntent('test LOGIN and SEARCH', profile);
      expect(result.status).toBe('complete');
      if (result.status === 'complete') {
        expect(result.intent.features).toContain('Login');
        expect(result.intent.features).toContain('Search');
      }
    });

    it('matches partial features — at least one found is complete', () => {
      const result = parseIntent('测试登录和支付功能', profile);
      expect(result.status).toBe('complete');
      if (result.status === 'complete') {
        expect(result.intent.features).toContain('Login');
        // '支付' not in profile, but at least Login matched
        expect(result.intent.features.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  // ── Incomplete results (clarifications needed) ────────────

  describe('incomplete intent (clarifications)', () => {
    it('asks for targetKind when only scope given (no profile)', () => {
      const result = parseIntent('run a smoke test', undefined);
      expect(result.status).toBe('incomplete');
      if (result.status === 'incomplete') {
        expect(result.clarificationsNeeded[0]?.field).toBe('targetKind');
        expect(result.clarificationsNeeded[0]?.options).toEqual([
          '真机 (iPhone)',
          '模拟器 (Simulator)',
        ]);
      }
    });

    it('asks for features when smoke scope has no matches (with profile)', () => {
      const result = parseIntent('在真机上跑冒烟测试', profile);
      // "冒烟测试" → smoke, "真机" → physical, but no features matched
      expect(result.status).toBe('incomplete');
      if (result.status === 'incomplete') {
        const fieldSet = new Set(result.clarificationsNeeded.map((c) => c.field));
        expect(fieldSet.has('features')).toBe(true);
      }
    });

    it('smoke test with device and no profile is complete (generic smoke)', () => {
      const result = parseIntent('run smoke test on my iPhone', undefined);
      expect(result.status).toBe('complete');
      if (result.status === 'complete') {
        expect(result.intent.targetKind).toBe('physical');
        expect(result.intent.scope).toBe('smoke');
        expect(result.intent.features).toEqual([]);
      }
    });

    it('asks for targetKind when smoke test has no device keyword', () => {
      const result = parseIntent('run login smoke test', profile);
      expect(result.status).toBe('incomplete');
      if (result.status === 'incomplete') {
        const fieldSet = new Set(result.clarificationsNeeded.map((c) => c.field));
        expect(fieldSet.has('targetKind')).toBe(true);
        expect(result.intent.features).toContain('Login');
      }
    });

    it('explore scope does not ask for features', () => {
      const result = parseIntent('explore the app on simulator', undefined);
      expect(result.status).toBe('complete');
      if (result.status === 'complete') {
        expect(result.intent.features).toEqual([]);
        expect(result.intent.targetKind).toBe('simulator');
      }
    });
  });

  // ── Edge cases ────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles empty input gracefully', () => {
      const result = parseIntent('', undefined);
      expect(result.status).toBe('incomplete');
      if (result.status === 'incomplete') {
        expect(result.intent.scope).toBe('custom');
        expect(result.intent.goal).toBe('');
      }
    });

    it('handles whitespace-only input', () => {
      const result = parseIntent('   ', undefined);
      expect(result.status).toBe('incomplete');
    });

    it('preserves sourceText exactly', () => {
      const result = parseIntent(' 帮我用本机iPhone 跑一下登录 smoke ', profile);
      if (result.status === 'complete') {
        expect(result.intent.sourceText).toBe(' 帮我用本机iPhone 跑一下登录 smoke ');
      }
    });

    it('extracts goal without source text noise', () => {
      const result = parseIntent('帮我用本机 iPhone 跑一下登录 smoke 并分析失败原因', profile);
      if (result.status === 'complete') {
        expect(result.intent.goal).not.toBe('');
        expect(result.intent.goal).not.toBe('帮我用本机 iPhone 跑一下登录 smoke 并分析失败原因');
      }
    });
  });

  // ── No profile ────────────────────────────────────────────

  describe('without profile', () => {
    it('does not match any features when profile is undefined', () => {
      const result = parseIntent('test login on my phone', undefined);
      if (result.status === 'complete') {
        expect(result.intent.features).toEqual([]);
      }
      // May be incomplete due to smoke without features
    });
  });
});

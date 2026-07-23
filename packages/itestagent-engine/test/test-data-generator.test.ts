import { describe, expect, it } from 'bun:test';
import type { TestDataContext } from 'itestagent-contracts';
import { TestDataGenerator } from '../src/test-data/test-data-generator.js';

// ─── Helpers ────────────────────────────────────────────────

function makeContext(overrides?: Partial<TestDataContext>): TestDataContext {
  return {
    projectHash: 'test-hash-abc123',
    features: ['login', 'search', 'profile'],
    bundleId: 'com.example.myapp',
    urlSchemes: ['myapp://', 'myapp-deeplink://'],
    apiEndpoints: ['/api/v1/users', '/api/v1/login', '/api/v1/search'],
    formFields: ['email', 'password', 'username', 'comment'],
    locale: 'en-US',
    ...overrides,
  };
}

function isIso8601(str: string): boolean {
  return !Number.isNaN(Date.parse(str)) && str.includes('T');
}

// ────────────────────────────────────────────────────────────
//  AC1: 9 data types generated
// ────────────────────────────────────────────────────────────

describe('TestDataGenerator — US-10.1', () => {
  const generator = new TestDataGenerator();

  // ─── AC1: All 9 data type items ────────────────────────────────

  describe('AC1: 9 data types', () => {
    it('generates username with value and type', () => {
      const result = generator.generate(makeContext());
      const item = result.items.find((i) => i.type === 'username');
      expect(item).toBeDefined();
      expect(item?.type).toBe('username');
      expect(typeof item?.value).toBe('string');
      expect(item?.value.length).toBeGreaterThan(0);
    });

    it('generates phone_placeholder with value and type', () => {
      const result = generator.generate(makeContext());
      const item = result.items.find((i) => i.type === 'phone_placeholder');
      expect(item).toBeDefined();
      expect(item?.type).toBe('phone_placeholder');
      expect(typeof item?.value).toBe('string');
      expect(item?.value.length).toBeGreaterThan(0);
    });

    it('generates search_keyword with value and type', () => {
      const result = generator.generate(makeContext());
      const item = result.items.find((i) => i.type === 'search_keyword');
      expect(item).toBeDefined();
      expect(item?.type).toBe('search_keyword');
      expect(typeof item?.value).toBe('string');
      expect(item?.value.length).toBeGreaterThan(0);
    });

    it('generates form_text with value and type', () => {
      const result = generator.generate(makeContext());
      const item = result.items.find((i) => i.type === 'form_text');
      expect(item).toBeDefined();
      expect(item?.type).toBe('form_text');
      expect(typeof item?.value).toBe('string');
      expect(item?.value.length).toBeGreaterThan(0);
    });

    it('generates mock_payload with value as object', () => {
      const result = generator.generate(makeContext());
      const item = result.items.find((i) => i.type === 'mock_payload');
      expect(item).toBeDefined();
      expect(item?.type).toBe('mock_payload');
      expect(typeof item?.value).toBe('object');
      expect(item?.value).not.toBeNull();
    });

    it('generates deeplink_param with value and type', () => {
      const result = generator.generate(makeContext());
      const item = result.items.find((i) => i.type === 'deeplink_param');
      expect(item).toBeDefined();
      expect(item?.type).toBe('deeplink_param');
      expect(typeof item?.value).toBe('string');
      expect(item?.value.length).toBeGreaterThan(0);
    });

    it('generates fixture with value', () => {
      const result = generator.generate(makeContext());
      const item = result.items.find((i) => i.type === 'fixture');
      expect(item).toBeDefined();
      expect(item?.type).toBe('fixture');
      expect(item?.value).toBeDefined();
    });

    it('generates boundary_input with value and type', () => {
      const result = generator.generate(makeContext());
      const item = result.items.find((i) => i.type === 'boundary_input');
      expect(item).toBeDefined();
      expect(item?.type).toBe('boundary_input');
      expect(typeof item?.value).toBe('string');
    });

    it('generates edge_case_input with value and type', () => {
      const result = generator.generate(makeContext());
      const item = result.items.find((i) => i.type === 'edge_case_input');
      expect(item).toBeDefined();
      expect(item?.type).toBe('edge_case_input');
      expect(typeof item?.value).toBe('string');
      expect(item?.value.length).toBeGreaterThan(0);
    });

    it('generates all 9 items exactly', () => {
      const result = generator.generate(makeContext());
      expect(result.items.length).toBe(9);
      const types = result.items.map((i) => i.type).sort();
      expect(types).toEqual([
        'boundary_input',
        'deeplink_param',
        'edge_case_input',
        'fixture',
        'form_text',
        'mock_payload',
        'phone_placeholder',
        'search_keyword',
        'username',
      ]);
    });
  });

  // ─── Container metadata ────────────────────────────────────────

  describe('container metadata', () => {
    it('sets correct schemaVersion', () => {
      const result = generator.generate(makeContext());
      expect(result.schemaVersion).toBe('itestagent.test-data.v1');
    });

    it('sets generatedAt as ISO 8601 timestamp', () => {
      const result = generator.generate(makeContext());
      expect(isIso8601(result.generatedAt)).toBe(true);
    });

    it('sets contextRef when projectHash is provided', () => {
      const result = generator.generate(makeContext());
      expect(result.contextRef).toBe('test-hash-abc123');
    });

    it('omits contextRef when projectHash is not provided', () => {
      const result = generator.generate(makeContext({ projectHash: undefined }));
      expect(result.contextRef).toBeUndefined();
    });
  });

  // ─── AC2: Project-aware generation ─────────────────────────────

  describe('AC2: project-aware generation', () => {
    it('deeplink_param uses urlSchemes from context', () => {
      const result = generator.generate(makeContext());
      const item = result.items.find((i) => i.type === 'deeplink_param');
      expect(item).toBeDefined();
      const value = item?.value as string;
      const hasScheme = value.startsWith('myapp://') || value.startsWith('myapp-deeplink://');
      expect(hasScheme).toBe(true);
    });

    it('mock_payload uses apiEndpoints from context', () => {
      const result = generator.generate(makeContext());
      const item = result.items.find((i) => i.type === 'mock_payload');
      expect(item).toBeDefined();
      const value = item?.value as Record<string, unknown>;
      const hasEndpoint = Object.keys(value).some(
        (k) => k === 'endpoint' || k === 'path' || k === 'url',
      );
      expect(hasEndpoint).toBe(true);
    });

    it('form_text references formFields when available', () => {
      const result = generator.generate(makeContext());
      const item = result.items.find((i) => i.type === 'form_text');
      expect(item).toBeDefined();
      expect(item?.fieldType).toBeDefined();
    });
  });

  // ─── Uniqueness (randomization) ─────────────────────────────────

  describe('uniqueness (randomization)', () => {
    it('produces unique values across calls for username', () => {
      const r1 = generator.generate(makeContext());
      const r2 = generator.generate(makeContext());
      const u1 = r1.items.find((i) => i.type === 'username')?.value;
      const u2 = r2.items.find((i) => i.type === 'username')?.value;
      // With randomization, successive calls should differ
      expect(u1).not.toBe(u2);
    });

    it('produces unique values across calls for search_keyword', () => {
      const r1 = generator.generate(makeContext());
      const r2 = generator.generate(makeContext());
      const k1 = r1.items.find((i) => i.type === 'search_keyword')?.value;
      const k2 = r2.items.find((i) => i.type === 'search_keyword')?.value;
      expect(k1).not.toBe(k2);
    });
  });

  // ─── Locale influence ───────────────────────────────────────────

  describe('locale influence', () => {
    it('phone_placeholder reflects locale', () => {
      const enResult = generator.generate(makeContext({ locale: 'en-US' }));
      const zhResult = generator.generate(makeContext({ locale: 'zh-CN' }));
      const enPhone = enResult.items.find((i) => i.type === 'phone_placeholder');
      const zhPhone = zhResult.items.find((i) => i.type === 'phone_placeholder');
      expect(enPhone).toBeDefined();
      expect(zhPhone).toBeDefined();
      expect(enPhone?.locale).toBe('en-US');
      expect(zhPhone?.locale).toBe('zh-CN');
    });

    it('username reflects locale', () => {
      const enResult = generator.generate(makeContext({ locale: 'en-US' }));
      const zhResult = generator.generate(makeContext({ locale: 'zh-CN' }));
      const enUser = enResult.items.find((i) => i.type === 'username');
      const zhUser = zhResult.items.find((i) => i.type === 'username');
      expect(enUser).toBeDefined();
      expect(zhUser).toBeDefined();
      expect(enUser?.locale).toBe('en-US');
      expect(zhUser?.locale).toBe('zh-CN');
    });
  });

  // ─── AC3: Safe data (no real accounts) ─────────────────────────

  describe('AC3: safety', () => {
    it('username does not contain real-looking emails', () => {
      const result = generator.generate(makeContext());
      const item = result.items.find((i) => i.type === 'username');
      const val = item?.value as string;
      // Should not contain "@" (which would indicate a real email pattern)
      expect(val.includes('@')).toBe(false);
    });

    it('phone_placeholder uses placeholder patterns (contains *)', () => {
      const result = generator.generate(makeContext());
      const item = result.items.find((i) => i.type === 'phone_placeholder');
      const val = item?.value as string;
      // Phone placeholder should have masking asterisks
      expect(val.includes('*')).toBe(true);
    });

    it('mock_payload contains no real credentials', () => {
      const result = generator.generate(makeContext());
      const item = result.items.find((i) => i.type === 'mock_payload');
      const val = item?.value as Record<string, unknown>;
      const str = JSON.stringify(val).toLowerCase();
      // Should not contain actual password/token values
      expect(str.includes('real_password')).toBe(false);
      expect(str.includes('prod_token')).toBe(false);
    });

    it('generator makes no network calls (pure function)', async () => {
      // Calling generate multiple times should be instantaneous
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        generator.generate(makeContext());
      }
      const elapsed = performance.now() - start;
      // 100 generations should complete in well under 1 second (no I/O)
      expect(elapsed).toBeLessThan(1000);
    });
  });

  // ─── Edge cases ─────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles empty context gracefully', () => {
      const result = generator.generate({});
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.schemaVersion).toBe('itestagent.test-data.v1');
    });

    it('handles context with only locale', () => {
      const result = generator.generate({ locale: 'ja-JP' });
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.contextRef).toBeUndefined();
    });

    it('boundary_input generates both empty string and max-length variants', async () => {
      // Across multiple calls, boundary_input should produce different constraints
      const constraints = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const r = generator.generate(makeContext());
        const item = r.items.find((i) => i.type === 'boundary_input');
        if (item?.constraint) {
          constraints.add(item?.constraint);
        }
      }
      // Should have at least 2 different constraint types
      expect(constraints.size).toBeGreaterThanOrEqual(2);
    });

    it('edge_case_input generates various scenarios across calls', async () => {
      const scenarios = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const r = generator.generate(makeContext());
        const item = r.items.find((i) => i.type === 'edge_case_input');
        if (item?.scenario) {
          scenarios.add(item?.scenario);
        }
      }
      // Should have at least 3 different edge case scenarios
      expect(scenarios.size).toBeGreaterThanOrEqual(3);
    });
  });
});

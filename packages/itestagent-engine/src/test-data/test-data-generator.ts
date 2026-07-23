import type { GeneratedTestData, TestDataContext, TestDataItem } from 'itestagent-contracts';

// ─── Data pools for randomization ───────────────────────────

/** Username prefixes for generated usernames (safe, fake). */
const USER_PREFIXES = [
  'test_user',
  'demo_user',
  'qa_user',
  'sample_user',
  'mock_user',
  'fake_user',
  'tester',
  'user',
] as const;

/** Phonetic-compatible username parts for locale-aware generation. */
const USER_SUFFIXES_EN = [
  'alice',
  'bob',
  'charlie',
  'dave',
  'eve',
  'frank',
  'grace',
  'henry',
  'ivy',
  'jack',
  'kate',
  'leo',
  'mia',
  'noah',
  'olivia',
  'peter',
  'quinn',
  'rose',
  'sam',
  'tina',
  'uma',
  'vince',
  'wendy',
  'xander',
] as const;

const USER_SUFFIXES_ZH = [
  'xiaoming',
  'xiaohong',
  'xiaogang',
  'xiaoli',
  'daming',
  'dafang',
  'xiaowei',
  'xiaowen',
] as const;

/** Search keywords by category (safe, fake). */
const SEARCH_KEYWORDS: Record<string, readonly string[]> = {
  product: [
    'wireless charger',
    'bluetooth speaker',
    'mechanical keyboard',
    'usb cable',
    'laptop stand',
  ],
  user_name: ['john doe', 'jane smith', 'alex wong', 'sarah chen'],
  location: ['san francisco', 'beijing haidian', 'tokyo shibuya', 'london bridge'],
  default: ['test search', 'sample query', 'demo keyword'],
} as const;

/** Form field input templates by field type. */
const FORM_INPUTS: Record<string, readonly string[]> = {
  email: ['test@example.com', 'demo@example.com', 'qa@test.org'],
  password: ['TestPass123!', 'Demo@2024', 'QATest!456'],
  address: ['123 Test Street, Suite 100', '456 Demo Ave, Apt 2B', '789 QA Boulevard'],
  comment: [
    'This is a test comment for quality assurance.',
    'Sample feedback text for demo purposes.',
    'Automated test input — please ignore.',
  ],
  default: ['test input value', 'sample form text'],
} as const;

/** Deep link URL patterns by scheme. */
const DEEPLINK_PATHS = [
  '/open?param=test',
  '/navigate/to/page?id=123',
  '/action/share?content=sample',
  '/settings/profile',
  '/detail/42',
] as const;

/** Boundary input constraints. */
const BOUNDARY_CONSTRAINTS: Array<{ constraint: string; value: string }> = [
  { constraint: 'empty', value: '' },
  { constraint: 'max_length=255', value: 'a'.repeat(255) },
  { constraint: 'max_length=1000', value: 'x'.repeat(1000) },
  { constraint: 'min_length=1', value: 'a' },
  { constraint: 'unicode_boundary', value: '\u0000'.repeat(10) },
  { constraint: 'whitespace_only', value: '   ' },
];

/** Edge case scenarios. */
const EDGE_CASE_SCENARIOS: Array<{ scenario: string; value: string }> = [
  { scenario: 'sql_injection', value: "'; DROP TABLE users; --" },
  { scenario: 'xss_script', value: '<script>alert("xss")</script>' },
  { scenario: 'unicode_emoji', value: '😀🎉🔥💯✅❌🚀' },
  { scenario: 'rtl_override', value: '\u202E\u202Dtest\u202C' },
  { scenario: 'zero_width_chars', value: 'test\u200B\u200C\u200Dtext' },
  { scenario: 'very_long_string', value: 'A'.repeat(10000) },
  { scenario: 'special_chars', value: '!@#$%^&*()_+-=[]{}|;:\'",.<>?/`~' },
  { scenario: 'newlines_tabs', value: 'line1\nline2\r\nline3\tindented' },
];

/** Phone area codes by locale. */
const PHONE_AREAS: Record<string, readonly string[]> = {
  'en-US': ['+1 555', '+1 212', '+1 415'],
  'zh-CN': ['+86 138', '+86 139', '+86 186'],
  'ja-JP': ['+81 90', '+81 80', '+81 70'],
  default: ['+1 555'],
} as const;

// ─── Helpers ────────────────────────────────────────────────

let seqCounter = 0;

/** Return a monotonic sequence number (wraps at large values). */
function nextSeq(): number {
  seqCounter = (seqCounter + 1) % 1000000;
  return seqCounter;
}

/** Pick a random element from an array. Uses the sequence counter for uniqueness. */
function pick<T>(arr: readonly T[], salt = 0): T {
  if (arr.length === 0) {
    throw new Error('Cannot pick from empty array');
  }
  const idx = (nextSeq() + salt) % arr.length;
  const item: T | undefined = arr[idx];
  if (item === undefined) {
    throw new Error('Unexpected undefined at index');
  }
  return item;
}

/**
 * Resolve a value from a string-keyed record with a default fallback key.
 * Works around noUncheckedIndexedAccess by using an explicit variable.
 */
function recordGet<V>(record: Record<string, V>, key: string, fallbackKey: string): V {
  const raw: V | undefined = record[key];
  if (raw !== undefined) return raw;
  const fallback: V | undefined = record[fallbackKey];
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing both key "${key}" and fallback "${fallbackKey}" in record`);
}

/** Generate a unique suffix using timestamp + sequence counter. */
function uniqueSuffix(): string {
  return `${Date.now().toString(36)}_${nextSeq().toString(36)}`;
}

// ─── Generator ──────────────────────────────────────────────

/**
 * TestDataGenerator — produces safe, project-aware test data.
 *
 * AC1 (US-10.1): Generates 9 types of test data:
 *   username, phone_placeholder, search_keyword, form_text,
 *   mock_payload, deeplink_param, fixture, boundary_input, edge_case_input.
 *
 * AC2: Data generation references project context
 *   (urlSchemes → deeplink_param, apiEndpoints → mock_payload).
 *
 * AC3: All generated data is random, fake, safe — never uses real
 *   accounts, payments, or permissions. Pure function, no network calls.
 */
export class TestDataGenerator {
  /**
   * Generate a full set of test data items for the given context.
   * Each call produces unique values (randomization).
   */
  generate(context: TestDataContext): GeneratedTestData {
    const locale = context.locale ?? 'en-US';
    const items: TestDataItem[] = [
      this.generateUsername(locale),
      this.generatePhonePlaceholder(locale),
      this.generateSearchKeyword(context),
      this.generateFormText(context),
      this.generateMockPayload(context),
      this.generateDeeplinkParam(context),
      this.generateFixture(),
      this.generateBoundaryInput(),
      this.generateEdgeCaseInput(),
    ];

    return {
      schemaVersion: 'itestagent.test-data.v1',
      generatedAt: new Date().toISOString(),
      contextRef: context.projectHash,
      items,
    };
  }

  // ── Per-type generators ───────────────────────────────────

  private generateUsername(locale: string): TestDataItem {
    const isZh = locale.startsWith('zh');
    const suffix = isZh ? pick(USER_SUFFIXES_ZH) : pick(USER_SUFFIXES_EN);
    const prefix = pick(USER_PREFIXES);
    const value = `${prefix}_${suffix}_${uniqueSuffix()}`;

    return { type: 'username', value, locale };
  }

  private generatePhonePlaceholder(locale: string): TestDataItem {
    const areas = recordGet(PHONE_AREAS, locale, 'default');
    const area = pick(areas);
    const masked = '****'.repeat(1 + (nextSeq() % 3));
    const value = `${area} ${masked}`;

    return { type: 'phone_placeholder', value, locale };
  }

  private generateSearchKeyword(context: TestDataContext): TestDataItem {
    const features = context.features ?? [];
    const category = features.length > 0 ? pick(features) : 'default';
    const pool = recordGet(SEARCH_KEYWORDS, category, 'default');
    const value = `${pick(pool)} ${uniqueSuffix()}`.trim();

    return { type: 'search_keyword', value, category };
  }

  private generateFormText(context: TestDataContext): TestDataItem {
    const formFields = context.formFields ?? [];
    const fieldType = formFields.length > 0 ? pick(formFields) : 'default';
    const pool = recordGet(FORM_INPUTS, fieldType, 'default');
    const value = pick(pool);

    return { type: 'form_text', value, fieldType };
  }

  private generateMockPayload(context: TestDataContext): TestDataItem {
    const endpoints = context.apiEndpoints ?? [];
    const endpoint = endpoints.length > 0 ? pick(endpoints) : '/api/v1/default';

    // Simpler endpoint extraction for the schema reference
    const schema = endpoint.split('?')[0];

    const value: Record<string, unknown> = {
      endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: {
        id: `mock_${uniqueSuffix()}`,
        name: `test_entry_${nextSeq()}`,
        timestamp: new Date().toISOString(),
      },
    };

    return { type: 'mock_payload', value, schema };
  }

  private generateDeeplinkParam(context: TestDataContext): TestDataItem {
    const schemes = context.urlSchemes ?? [];
    const scheme = schemes.length > 0 ? pick(schemes) : 'itestagent://';
    const path = pick(DEEPLINK_PATHS);
    const value = `${scheme}${path}?seq=${uniqueSuffix()}`;

    return { type: 'deeplink_param', value, scheme };
  }

  private generateFixture(): TestDataItem {
    const format = pick<'json' | 'yaml' | 'text'>(['json', 'yaml', 'text']);
    const value = this.buildFixture(format);

    return { type: 'fixture', value, format };
  }

  private buildFixture(format: 'json' | 'yaml' | 'text'): unknown {
    const seq = nextSeq();
    const fixtureData = {
      id: `fixture_${uniqueSuffix()}`,
      name: `Test Fixture #${seq}`,
      items: [
        { key: 'item_1', value: `val_${seq}_a` },
        { key: 'item_2', value: `val_${seq}_b` },
      ],
    };

    if (format === 'yaml') {
      return `id: fixture_${uniqueSuffix()}\nname: Test Fixture #${seq}\nitems:\n  - key: item_1\n    value: val_${seq}_a\n  - key: item_2\n    value: val_${seq}_b\n`;
    }

    if (format === 'text') {
      return `Fixture #${seq}: ${fixtureData.name}\n  item_1 = val_${seq}_a\n  item_2 = val_${seq}_b`;
    }

    return fixtureData;
  }

  private generateBoundaryInput(): TestDataItem {
    const entry = pick(BOUNDARY_CONSTRAINTS);

    return { type: 'boundary_input', value: entry.value, constraint: entry.constraint };
  }

  private generateEdgeCaseInput(): TestDataItem {
    const entry = pick(EDGE_CASE_SCENARIOS);

    return { type: 'edge_case_input', value: entry.value, scenario: entry.scenario };
  }
}

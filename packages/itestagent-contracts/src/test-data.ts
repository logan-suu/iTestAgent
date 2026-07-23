import { z } from 'zod';

/**
 * Test Data & Credential schemas — E10: US-10.1 + US-10.2
 *
 * US-10.1 (P1): Agent generates safe test data — 9 data types, project-aware, no real accounts.
 * US-10.2 (P0): User provides real credentials via TUI — session-only default,
 *   optional Keychain persistence with user confirmation.
 *
 * R6: Sensitive data (account/OTP/token) must not be persisted in plaintext,
 *   logs, reports, or commits.
 * R7: High-risk operations (storing credentials) require secondary confirmation.
 * Data flow §15: TUI input → memory only → execution adapter → Keychain (if confirmed).
 *
 * These schemas are consumed by:
 *   - itestagent-engine: TestDataGenerator, CredentialManager
 *   - itestagent-tui: CredentialPromptPanel
 */

// ─── Generated Test Data Types (US-10.1 AC1) ──────────────────

/**
 * Discriminant for generated test data item types.
 *
 * AC1: Can generate: random username, phone placeholder, search keyword,
 *   form text, mock payload, deeplink parameter, fixture,
 *   boundary input, edge case input.
 */
export const TestDataItemTypeSchema = z.enum([
  'username',
  'phone_placeholder',
  'search_keyword',
  'form_text',
  'mock_payload',
  'deeplink_param',
  'fixture',
  'boundary_input',
  'edge_case_input',
]);

export type TestDataItemType = z.infer<typeof TestDataItemTypeSchema>;

// ─── Individual Data Item Schemas ─────────────────────────────

export const UsernameDataSchema = z.object({
  type: z.literal('username'),
  /** The generated username string */
  value: z.string(),
  /** Locale hint for locale-aware generation (e.g. "zh-CN", "en-US") */
  locale: z.string().optional(),
});

export const PhonePlaceholderDataSchema = z.object({
  type: z.literal('phone_placeholder'),
  /** Phone number placeholder (e.g. "+86 138****1234") */
  value: z.string(),
  /** Locale for country-specific formatting */
  locale: z.string().optional(),
});

export const SearchKeywordDataSchema = z.object({
  type: z.literal('search_keyword'),
  /** Search keyword text */
  value: z.string(),
  /** Semantic category hint (e.g. "product", "user_name") */
  category: z.string().optional(),
});

export const FormTextDataSchema = z.object({
  type: z.literal('form_text'),
  /** Generated form input text */
  value: z.string(),
  /** Target field type hint (e.g. "email", "address", "comment") */
  fieldType: z.string().optional(),
});

export const MockPayloadDataSchema = z.object({
  type: z.literal('mock_payload'),
  /** JSON-serializable mock payload (AC3: safe data only) */
  value: z.unknown(),
  /** Referenced schema name or endpoint path (AC2) */
  schema: z.string().optional(),
});

export const DeeplinkParamDataSchema = z.object({
  type: z.literal('deeplink_param'),
  /** Generated deeplink URL or parameter value */
  value: z.string(),
  /** URL scheme hint (e.g. "myapp://") */
  scheme: z.string().optional(),
});

export const FixtureDataSchema = z.object({
  type: z.literal('fixture'),
  /** Fixture content (JSON object, YAML string, or plain text) */
  value: z.unknown(),
  /** Output format hint */
  format: z.enum(['json', 'yaml', 'text']).optional(),
});

export const BoundaryInputDataSchema = z.object({
  type: z.literal('boundary_input'),
  /** Boundary test value (e.g. empty string, max-length string) */
  value: z.string(),
  /** The constraint being tested (e.g. "max_length=255", "empty") */
  constraint: z.string().optional(),
});

export const EdgeCaseInputDataSchema = z.object({
  type: z.literal('edge_case_input'),
  /** Edge case value (e.g. unicode, SQL injection attempt, XSS payload) */
  value: z.string(),
  /** Scenario description (e.g. "sql_injection", "unicode_emoji") */
  scenario: z.string().optional(),
});

// ─── Discriminated Union ──────────────────────────────────────

export const TestDataItemSchema = z.discriminatedUnion('type', [
  UsernameDataSchema,
  PhonePlaceholderDataSchema,
  SearchKeywordDataSchema,
  FormTextDataSchema,
  MockPayloadDataSchema,
  DeeplinkParamDataSchema,
  FixtureDataSchema,
  BoundaryInputDataSchema,
  EdgeCaseInputDataSchema,
]);

export type TestDataItem = z.infer<typeof TestDataItemSchema>;

// ─── Generated Test Data Container ────────────────────────────

/**
 * Container for all generated test data items.
 *
 * AC2: Data generation references project code/config/docs/interface
 *   definitions/mock rules — context is provided via `contextRef`.
 */
export const GeneratedTestDataSchema = z.object({
  /** Schema version for forward-compat migrations (G2) */
  schemaVersion: z.literal('itestagent.test-data.v1'),
  /** ISO 8601 timestamp of generation */
  generatedAt: z.string(),
  /** Reference to the source Project Profile (AC2: project-aware) */
  contextRef: z.string().optional(),
  /** Generated test data items */
  items: z.array(TestDataItemSchema),
});

export type GeneratedTestData = z.infer<typeof GeneratedTestDataSchema>;

// ─── Test Data Generation Context (AC2) ───────────────────────

/**
 * Context passed to the TestDataGenerator for project-aware generation.
 *
 * AC2: Data generation references project code/config/docs/interface
 *   definitions/mock rules. The context carries whatever the generator
 *   needs to produce relevant test data.
 */
export const TestDataContextSchema = z.object({
  /** Project hash for looking up the ProjectProfile */
  projectHash: z.string().optional(),
  /** Feature names in scope (from TestPlan execution.features) */
  features: z.array(z.string()).optional(),
  /** App bundle identifier (for deeplink scheme inference) */
  bundleId: z.string().optional(),
  /** Known URL schemes from project analysis */
  urlSchemes: z.array(z.string()).optional(),
  /** API endpoint paths discovered in project (for mock payloads) */
  apiEndpoints: z.array(z.string()).optional(),
  /** Form field names found in source analysis */
  formFields: z.array(z.string()).optional(),
  /** Locale preference (e.g. "zh-CN") */
  locale: z.string().optional(),
});

export type TestDataContext = z.infer<typeof TestDataContextSchema>;

// ─── Credential Types (US-10.2) ───────────────────────────────

/**
 * Kind of credential being requested.
 *
 * text     — plain text input (e.g. username, email)
 * password — masked input (never shown in TUI, AC4)
 * token    — opaque token string (API key, bearer token)
 * otp      — one-time password / verification code
 */
export const CredentialKindSchema = z.enum(['text', 'password', 'token', 'otp']);

export type CredentialKind = z.infer<typeof CredentialKindSchema>;

/**
 * A request to the user for a credential value.
 *
 * AC1: Real account/OTP/payment/permission/token are prompted in TUI
 *   for user input or confirmation.
 * AC5: When `required` is false and the user skips, login-related flows
 *   are marked as unable to complete rather than failed.
 */
export const CredentialRequestSchema = z.object({
  /** Unique key for referencing this credential (e.g. "login_username") */
  key: z.string().min(1),
  /** Human-readable label shown in TUI prompt */
  label: z.string().min(1),
  /** Type of credential (affects masking behavior) */
  kind: CredentialKindSchema,
  /** Whether this credential is required for the flow to proceed (AC5) */
  required: z.boolean(),
  /** Optional help text explaining why this credential is needed */
  helpText: z.string().optional(),
});

export type CredentialRequest = z.infer<typeof CredentialRequestSchema>;

// ─── Credential Response ──────────────────────────────────────

/**
 * User's response to a CredentialRequest.
 *
 * AC2: Default: session-only use, not persisted to disk.
 * AC3: User chooses "remember" → save to macOS Keychain.
 * AC5: When status is "skipped" and credential is required,
 *   login-related flows are marked as unable to complete, not failed.
 */
export const CredentialResponseSchema = z.object({
  /** Matches CredentialRequest.key */
  key: z.string(),
  /** Whether the user provided the credential or chose to skip */
  status: z.enum(['provided', 'skipped']),
  /**
   * The credential value — only present when status is "provided".
   * This value exists ONLY in memory (R6, AC4).
   * It is never written to config, logs, reports, or step recording.
   */
  value: z.string().optional(),
  /**
   * Whether the user chose to persist this credential to Keychain (AC3).
   * Requires explicit user confirmation per R7.
   */
  remembered: z.boolean().optional(),
});

export type CredentialResponse = z.infer<typeof CredentialResponseSchema>;

// ─── Credential Entry (for Keychain/Store) ────────────────────

/**
 * Internal representation of a stored credential.
 *
 * sessionOnly entries are held in MemorySecretStore;
 * persisted entries are held in KeychainSecretStore (AC3).
 *
 * R6: The value is never serialized to JSONC or plaintext files.
 */
export const CredentialEntrySchema = z.object({
  /** Credential key */
  key: z.string(),
  /** Credential value (only in memory / Keychain, never in plaintext files) */
  value: z.string(),
  /** Credential kind */
  kind: CredentialKindSchema,
  /** ISO 8601 timestamp of storage */
  storedAt: z.string(),
  /** Whether this entry is session-only (not persisted) */
  sessionOnly: z.boolean(),
  /** Human-readable label */
  label: z.string().optional(),
});

export type CredentialEntry = z.infer<typeof CredentialEntrySchema>;

// ─── Credential Resolution Result ─────────────────────────────

/**
 * Result of resolving a credential through the CredentialManager pipeline.
 *
 * found    — Credential was found in session memory or Keychain.
 * prompted — Credential requested from user via TUI.
 * skipped  — User chose not to provide; flow marked unable_to_complete (AC5).
 * not_found — No stored credential and no prompt was made.
 */
export const CredentialResolveStatusSchema = z.enum(['found', 'prompted', 'skipped', 'not_found']);

export type CredentialResolveStatus = z.infer<typeof CredentialResolveStatusSchema>;

export const CredentialResolveResultSchema = z.object({
  /** Resolution status */
  status: CredentialResolveStatusSchema,
  /** The resolved CredentialEntry (only when status is "found" or "prompted") */
  entry: CredentialEntrySchema.optional(),
  /** Reason for skip / not_found */
  reason: z.string().optional(),
});

export type CredentialResolveResult = z.infer<typeof CredentialResolveResultSchema>;

// ─── Credential Manager Interface ─────────────────────────────

/**
 * Source of credentials for execution.
 *
 * The CredentialManager implements the pipeline:
 *   1. Check session memory (MemorySecretStore)
 *   2. Check Keychain (KeychainSecretStore)
 *   3. Prompt user in TUI (via callback)
 *   4. On "remember": store to Keychain with R7 confirmation
 *
 * AC2: Default session-only, not persisted to disk.
 * AC3: "Remember" → macOS Keychain with explicit confirmation.
 * AC4: Passwords/tokens never in plaintext config/reports/logs.
 * AC5: Skip → status = skipped, flow marked unable_to_complete.
 */
export interface CredentialManager {
  /**
   * Resolve a single credential through the pipeline.
   *
   * If the credential exists in memory or Keychain, returns it immediately.
   * Otherwise, delegates to the prompt callback (TUI integration).
   */
  resolveCredential(request: CredentialRequest): Promise<CredentialResolveResult>;

  /**
   * Resolve multiple credentials in batch.
   * Returns a map of key → result for each requested credential.
   */
  resolveCredentials(requests: CredentialRequest[]): Promise<Map<string, CredentialResolveResult>>;

  /**
   * Clear all session-only credentials from memory.
   * Persisted Keychain entries are NOT affected.
   */
  clearSession(): void;
}

// ─── Parse Helpers ────────────────────────────────────────────

/**
 * Safely parse a GeneratedTestData from unknown input (G2 compliance).
 */
export function parseGeneratedTestData(raw: unknown): GeneratedTestData {
  return GeneratedTestDataSchema.parse(raw);
}

/**
 * Safely parse a CredentialRequest from unknown input.
 */
export function parseCredentialRequest(raw: unknown): CredentialRequest {
  return CredentialRequestSchema.parse(raw);
}

/**
 * Safely parse a CredentialResponse from unknown input.
 */
export function parseCredentialResponse(raw: unknown): CredentialResponse {
  return CredentialResponseSchema.parse(raw);
}

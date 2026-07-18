import { z } from 'zod';

/**
 * iTestAgent Configuration Schema (Zod)
 *
 * US-18.2 AC1: Config paths: ~/.itestagent/config/itestagent.jsonc,
 *   <project>/.itestagent/itestagent.jsonc, <project>/itestagent.jsonc
 * US-18.2 AC2: Use JSONC, support $schema
 * US-18.2 AC3: Sensitive credentials must not be written to JSONC in plaintext
 *
 * AGENTS.md §5 data contracts: artifacts must carry schemaVersion, code against schema.
 * AGENTS.md §5 config layering: ~/.itestagent/config/itestagent.jsonc < .itestagent/itestagent.jsonc < itestagent.jsonc
 * Red line R6: Sensitive data (account/OTP/token) must not be persisted in plaintext, logs, reports, or commits.
 *
 * Note: US-18.2 AC3 (credential masking + Keychain integration) is implemented by task 1.10.
 * apiKeyRef stores only the reference name (never a plaintext key). Real credentials are
 * injected at runtime via SecretStore and never enter the config object.
 * maskSensitiveFields therefore requires no additional masking.
 */

// ─── Model Config Section ──────────────────────────────────

/**
 * US-18.1 AC2: Requires only local dependencies + OpenAI-compatible model API Key.
 * apiKeyRef stores a Keychain reference name or environment variable name, not the plaintext key (R6).
 * Credential access (Keychain) is handled by task 1.10.
 */
export const ModelConfigSchema = z
  .object({
    /** OpenAI-compatible provider name (e.g., "openai", "anthropic") */
    provider: z.string().optional().default('openai'),
    /** Custom API base URL (OpenAI-compatible endpoint) */
    baseURL: z.string().optional(),
    /**
     * API Key reference name (Keychain key or environment variable name).
     * Plaintext API Key is never stored (R6 / US-18.2 AC3).
     * Credential access is implemented by task 1.10.
     */
    apiKeyRef: z.string().optional(),
    /** Model name (e.g., "gpt-4o", "claude-3-5-sonnet") */
    model: z.string().optional(),
  })
  .strict();

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

// ─── Device Config Section ─────────────────────────────────

/**
 * ADR-011: First-class support for both physical devices and Simulator.
 * Backend selection is configured independently per targetKind with same-type fallback;
 * cross-type fallback requires user confirmation.
 */
export const DeviceConfigSchema = z
  .object({
    /** Per-targetKind preferred backend list (highest priority first) */
    preferredBackends: z
      .object({
        physical: z.array(z.enum(['appium', 'mobile-mcp', 'mock'])).optional(),
        simulator: z.array(z.enum(['appium', 'mock'])).optional(),
      })
      .optional(),
    /** Whether to allow cross-targetKind fallback (default false, requires ask) */
    allowCrossTargetFallback: z.boolean().optional().default(false),
  })
  .strict();

export type DeviceConfig = z.infer<typeof DeviceConfigSchema>;

// ─── TUI Config Section ────────────────────────────────────

/**
 * Tech selection §5: OpenTUI+SolidJS is the target mainline, Ink is the verified fallback.
 */
export const TuiConfigSchema = z
  .object({
    /** TUI framework */
    framework: z.enum(['opentui', 'ink']).optional().default('opentui'),
  })
  .strict();

export type TuiConfig = z.infer<typeof TuiConfigSchema>;

// ─── Root Config Schema ────────────────────────────────────

/**
 * iTestAgent root config schema.
 * Corresponds to config file: itestagent.jsonc
 * Three-layer merge priority (later overrides earlier):
 *   1. ~/.itestagent/config/itestagent.jsonc (global)
 *   2. <project>/.itestagent/itestagent.jsonc (project-local)
 *   3. <project>/itestagent.jsonc (project root)
 *
 * Note: nested objects use .optional() + transform to fill defaults,
 * because Zod 4's .default({}) requires a complete output type.
 */
export const ItestAgentConfigSchema = z
  .object({
    /** Config schema version (AGENTS.md §5 data contracts) */
    schemaVersion: z.string().default('1.0'),
    /** JSONC $schema reference (US-18.2 AC2) */
    $schema: z.string().optional(),
    /** Model config (US-18.1 AC2) */
    model: ModelConfigSchema.optional(),
    /** Device config */
    device: DeviceConfigSchema.optional(),
    /** TUI config */
    tui: TuiConfigSchema.optional(),
  })
  .strict()
  .transform((data) => ({
    ...data,
    model: data.model ?? ModelConfigSchema.parse({}),
    device: data.device ?? DeviceConfigSchema.parse({}),
    tui: data.tui ?? TuiConfigSchema.parse({}),
  }));

export type ItestAgentConfig = z.infer<typeof ItestAgentConfigSchema>;

// ─── Utility Functions ─────────────────────────────────────

/** Default config (all fields at schema defaults) */
export const DEFAULT_CONFIG: ItestAgentConfig = ItestAgentConfigSchema.parse({});

/**
 * Safely parse config, returning a config with defaults applied.
 * Invalid fields will throw ZodError.
 */
export function parseConfig(raw: unknown): ItestAgentConfig {
  return ItestAgentConfigSchema.parse(raw);
}

/**
 * Mask sensitive fields in config for display/logging (R6).
 * apiKeyRef is not masked (it is a reference name, not a plaintext key — US-18.2 AC3).
 * Real credentials are injected at runtime via SecretStore and never enter the config object.
 */
export function maskSensitiveFields(config: ItestAgentConfig): ItestAgentConfig {
  return config;
}

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ItestAgentConfig } from 'itestagent-contracts';
import type { SecretStore } from 'itestagent-contracts';
import { confirmAction } from './confirm.js';

/**
 * High-risk action descriptions for confirmation prompts (US-18.3 AC2).
 */
interface WriteProjectConfigContext {
  /** Absolute path to the config file being written. */
  configPath: string;
  /** Whether to skip the confirmation prompt (useful for tests with mock confirmation). */
  skipConfirmation?: boolean;
  /** A SecretStore to resolve credentials from (resolved values not written to file per R6). */
  secretStore?: SecretStore;
}

/**
 * Save a project-level configuration file to `<projectDir>/itestagent.jsonc`.
 *
 * US-18.3 AC2: "写项目级配置 需用户确认"
 * US-18.3 AC1: "默认不写项目目录，运行产物写 ~/.itestagent/"
 *
 * This function:
 * 1. Prompts the user for confirmation before writing (R7)
 * 2. Ensures the parent directory exists
 * 3. Writes the config as formatted JSON (with $schema reference)
 * 4. Strips sensitive values — only apiKeyRef is serialized, not actual credentials (R6)
 *
 * @param config - The full merged config to serialize
 * @param projectDir - Project root directory (must be absolute)
 * @param ctx - Additional context including skipConfirmation flag
 * @returns configPath on success
 * @throws Error if user denies confirmation or write fails
 */
export async function saveProjectConfig(
  config: ItestAgentConfig,
  projectDir: string,
  ctx: WriteProjectConfigContext = { configPath: join(projectDir, 'itestagent.jsonc') },
): Promise<string> {
  const configPath = ctx.configPath;

  // US-18.3 AC2: require user confirmation for writing to project directory
  if (!ctx.skipConfirmation) {
    const result = await confirmAction({
      action: 'Write project-level config',
      details: `This will write ${configPath}`,
    });
    if (result !== 'yes') {
      throw new Error('User declined to write project config.');
    }
  }

  // Ensure parent directory exists
  await mkdir(projectDir, { recursive: true });

  // Build the config object to write (no sensitive values per R6)
  const toWrite: Record<string, unknown> = {
    $schema: 'https://itestagent.dev/schemas/config.schema.json',
    schemaVersion: config.schemaVersion,
  };

  // Include model config (apiKeyRef is a reference name, not the actual key — safe)
  if (
    config.model.apiKeyRef ||
    config.model.provider !== 'openai' ||
    config.model.baseURL ||
    config.model.model
  ) {
    const modelConfig: Record<string, unknown> = {};
    if (config.model.provider !== 'openai') {
      modelConfig.provider = config.model.provider;
    }
    if (config.model.apiKeyRef) {
      modelConfig.apiKeyRef = config.model.apiKeyRef;
    }
    if (config.model.baseURL) {
      modelConfig.baseURL = config.model.baseURL;
    }
    if (config.model.model) {
      modelConfig.model = config.model.model;
    }
    toWrite.model = modelConfig;
  }

  // Include device config if non-default
  const device = config.device;
  const hasDeviceCustom =
    device.preferredBackends?.physical?.length ||
    device.preferredBackends?.simulator?.length ||
    device.allowCrossTargetFallback;
  if (hasDeviceCustom) {
    toWrite.device = {};
    if (device.preferredBackends?.physical?.length) {
      (toWrite.device as Record<string, unknown>).preferredBackends = {
        physical: device.preferredBackends.physical,
      };
    }
    if (device.preferredBackends?.simulator?.length) {
      if (!(toWrite.device as Record<string, unknown>).preferredBackends) {
        (toWrite.device as Record<string, unknown>).preferredBackends = {};
      }
      (
        (toWrite.device as Record<string, unknown>).preferredBackends as Record<string, unknown[]>
      ).simulator = device.preferredBackends.simulator;
    }
    if (device.allowCrossTargetFallback) {
      (toWrite.device as Record<string, unknown>).allowCrossTargetFallback = true;
    }
  }

  // Include TUI config if non-default
  if (config.tui.framework !== 'opentui') {
    toWrite.tui = { framework: config.tui.framework };
  }

  // Write as formatted JSON (2-space indent, trailing newline)
  const content = `${JSON.stringify(toWrite, null, 2)}\n`;
  await writeFile(configPath, content, 'utf-8');

  return configPath;
}

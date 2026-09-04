import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type ItestAgentConfig, ItestAgentConfigSchema } from 'itestagent-contracts';
import { type ParseError, parse as parseJsonc } from 'jsonc-parser';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function merge(base: Record<string, unknown>, next: Record<string, unknown>) {
  const result = { ...base };
  for (const [key, value] of Object.entries(next)) {
    result[key] = isRecord(result[key]) && isRecord(value) ? merge(result[key], value) : value;
  }
  return result;
}

export interface TuiRuntimeConfigOptions {
  readonly workspace: string;
  readonly homeDir?: string;
}

/** Load the canonical three config layers and reject project permission rules. */
export function loadTuiRuntimeConfig(options: TuiRuntimeConfigOptions): ItestAgentConfig {
  const home = options.homeDir ?? homedir();
  const paths = [
    join(home, '.itestagent', 'config', 'itestagent.jsonc'),
    join(options.workspace, '.itestagent', 'itestagent.jsonc'),
    join(options.workspace, 'itestagent.jsonc'),
  ];
  let merged: Record<string, unknown> = {};
  for (const [index, path] of paths.entries()) {
    if (!existsSync(path)) continue;
    const errors: ParseError[] = [];
    const parsed = parseJsonc(readFileSync(path, 'utf8'), errors);
    if (errors.length > 0 || !isRecord(parsed)) {
      throw new Error(`Invalid JSONC config: ${path}`);
    }
    if (index > 0 && 'permissions' in parsed) {
      throw new Error(`Project config cannot declare global-only permissions: ${path}`);
    }
    if (index > 0 && isRecord(parsed.model)) {
      const model = parsed.model;
      if ('baseURL' in model || 'apiKeyRef' in model) {
        throw new Error(
          `Project config cannot override credential-bound model.baseURL or model.apiKeyRef: ${path}`,
        );
      }
    }
    merged = merge(merged, parsed);
  }
  return ItestAgentConfigSchema.parse(merged);
}

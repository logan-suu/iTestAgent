import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { ItestAgentConfigSchema, type PermissionRule } from 'itestagent-contracts';
import { type ParseError, parse as parseJsonc } from 'jsonc-parser';

export function globalConfigPath(homeDir: string = homedir()): string {
  return join(homeDir, '.itestagent', 'config', 'itestagent.jsonc');
}

async function readRaw(path: string): Promise<Record<string, unknown>> {
  try {
    const errors: ParseError[] = [];
    const parsed = parseJsonc(await readFile(path, 'utf8'), errors);
    if (
      errors.length > 0 ||
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error(`Invalid global JSONC config: ${path}`);
    }
    return parsed as Record<string, unknown>;
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      return { schemaVersion: '1.0' };
    }
    throw error;
  }
}

async function writeRaw(path: string, raw: Record<string, unknown>): Promise<void> {
  ItestAgentConfigSchema.parse(raw);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(raw, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporary, path);
}

function deniedRulesFrom(raw: Record<string, unknown>): PermissionRule[] {
  return ItestAgentConfigSchema.parse(raw).permissions.deniedRules;
}

export async function listGlobalDeniedRules(homeDir?: string): Promise<PermissionRule[]> {
  return deniedRulesFrom(await readRaw(globalConfigPath(homeDir)));
}

export async function persistGlobalDeniedRule(
  rule: PermissionRule,
  homeDir?: string,
): Promise<void> {
  if (rule.effect !== 'deny') throw new Error('Only deny rules may be persisted');
  const path = globalConfigPath(homeDir);
  const raw = await readRaw(path);
  const rules = deniedRulesFrom(raw).filter(
    (existing) => existing.action !== rule.action || existing.resource !== rule.resource,
  );
  raw.permissions = { deniedRules: [...rules, rule] };
  await writeRaw(path, raw);
}

export async function revokeGlobalDeniedRule(
  action: string,
  resource: string,
  homeDir?: string,
): Promise<boolean> {
  const path = globalConfigPath(homeDir);
  const raw = await readRaw(path);
  const before = deniedRulesFrom(raw);
  const after = before.filter((rule) => rule.action !== action || rule.resource !== resource);
  if (after.length === before.length) return false;
  raw.permissions = { deniedRules: after };
  await writeRaw(path, raw);
  return true;
}

import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
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

async function withGlobalConfigLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = `${path}.permissions.lock`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      const handle = await open(lockPath, 'wx', 0o600);
      try {
        await handle.writeFile(`${process.pid}\n`, 'utf8');
        return await operation();
      } finally {
        await handle.close();
        await unlink(lockPath).catch(() => undefined);
      }
    } catch (error: unknown) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? (error as { code?: string }).code
          : undefined;
      if (code !== 'EEXIST') throw error;
      try {
        const ownerPid = Number.parseInt((await readFile(lockPath, 'utf8')).trim(), 10);
        if (Number.isInteger(ownerPid) && ownerPid > 0) process.kill(ownerPid, 0);
      } catch (ownerError: unknown) {
        const ownerCode =
          typeof ownerError === 'object' && ownerError !== null && 'code' in ownerError
            ? (ownerError as { code?: string }).code
            : undefined;
        if (ownerCode === 'ESRCH' || ownerCode === 'ENOENT') {
          await unlink(lockPath).catch(() => undefined);
          continue;
        }
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for the global permission config lock: ${lockPath}`);
      }
      await Bun.sleep(25);
    }
  }
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
  await withGlobalConfigLock(path, async () => {
    const raw = await readRaw(path);
    const rules = deniedRulesFrom(raw).filter(
      (existing) => existing.action !== rule.action || existing.resource !== rule.resource,
    );
    raw.permissions = { deniedRules: [...rules, rule] };
    await writeRaw(path, raw);
  });
}

export async function revokeGlobalDeniedRule(
  action: string,
  resource: string,
  homeDir?: string,
): Promise<boolean> {
  const path = globalConfigPath(homeDir);
  return withGlobalConfigLock(path, async () => {
    const raw = await readRaw(path);
    const before = deniedRulesFrom(raw);
    const after = before.filter((rule) => rule.action !== action || rule.resource !== resource);
    if (after.length === before.length) return false;
    raw.permissions = { deniedRules: after };
    await writeRaw(path, raw);
    return true;
  });
}

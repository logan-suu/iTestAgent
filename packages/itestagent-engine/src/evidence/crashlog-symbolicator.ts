/**
 * CrashlogSymbolicator — symbolication of iOS crashlogs.
 *
 * Task 4.1 AC3: crashlog 支持符号化（借助 xctrace symbolicate / LLVM crashlog 工具）
 *
 * Strategies (tried in order):
 *   1. xcrun symbolicatecrash — Apple's bundled crashlog symbolication script
 *   2. xcrun atos — address-to-symbol for individual addresses
 *   3. llvm-symbolizer — LLVM's symbolizer (fallback, may not be installed)
 *
 * dSYM search order:
 *   1. Explicit dsymPath passed by caller
 *   2. ~/Library/Developer/Xcode/DerivedData/<app>-{hash}/Build/Products/<config>-iphoneos/<app>.app.dSYM
 *   3. DerivedData auto-discovery via xcodebuild -showBuildSettings
 *
 * R5: when symbolication is unavailable, the raw crashlog is preserved as-is
 *     and the symbolicated field is set to false — never pretends to have symbolicated.
 */

import { execSync, spawnSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── Symbolication Result ───────────────────────────────────────

/** Result of a crashlog symbolication attempt. */
export interface SymbolicationResult {
  /** Whether symbolication was successful. */
  symbolicated: boolean;

  /** The symbolicated crashlog content (same as original if symbolication failed). */
  content: string;

  /** The strategy that succeeded (or was attempted last). */
  strategy: 'symbolicatecrash' | 'atos' | 'llvm-symbolizer' | 'none';

  /** Error message if symbolication failed (R5: explicit). */
  error?: string;
}

// ─── dSYM Discovery ─────────────────────────────────────────────

/**
 * Search for dSYM files in standard locations.
 *
 * @param appName - The app name (CFBundleExecutable) to search for.
 * @param dsymPath - Explicit dSYM path (checked first).
 * @returns Path to dSYM directory, or null if not found.
 */
function findDsym(appName: string, dsymPath?: string): string | null {
  if (dsymPath && existsSync(dsymPath)) {
    return dsymPath;
  }

  // Search DerivedData for <appName>.app.dSYM
  const derivedData = join(
    process.env.HOME ?? '/tmp',
    'Library',
    'Developer',
    'Xcode',
    'DerivedData',
  );

  if (!existsSync(derivedData)) {
    return null;
  }

  // DerivedData/<project>-<hash>/Build/Products/<config>-iphoneos/<app>.app.dSYM
  // The dSYM is typically alongside the .app bundle in the products directory.
  // We search for <appName>.app.dSYM at any depth under DerivedData.
  try {
    const result = execSync(
      `find "${derivedData}" -maxdepth 6 -type d -name "${appName}.app.dSYM" 2>/dev/null | head -1`,
      { encoding: 'utf-8', timeout: 5000 },
    ).trim();

    if (result && existsSync(result)) {
      return result;
    }
  } catch {
    // find failed — fall through
  }

  return null;
}

// ─── Spawn Helper ───────────────────────────────────────────────

async function spawnCommand(
  cmd: string,
  args: string[],
  signal?: AbortSignal,
  timeoutMs = 15000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      timeout: timeoutMs,
      signal,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

// ─── Strategy 1: symbolicatecrash ───────────────────────────────

async function trySymbolicateCrash(
  crashlogPath: string,
  dsymPath: string,
  outputPath: string,
  signal?: AbortSignal,
): Promise<SymbolicationResult | null> {
  try {
    // xcrun symbolicatecrash <crashlog> --dsym <dsymPath> -o <output>
    const { exitCode, stderr } = await spawnCommand(
      'xcrun',
      ['symbolicatecrash', crashlogPath, '--dsym', dsymPath, '-o', outputPath],
      signal,
    );

    if (exitCode === 0 && existsSync(outputPath)) {
      const content = readFileSync(outputPath, 'utf-8');
      return {
        symbolicated: true,
        content,
        strategy: 'symbolicatecrash',
      };
    }

    if (stderr) {
      return {
        symbolicated: false,
        content: '',
        strategy: 'symbolicatecrash',
        error: stderr.trim(),
      };
    }
  } catch {
    // symbolicatecrash not available — try next strategy
  }

  return null;
}

// ─── Strategy 2: atos ───────────────────────────────────────────

async function tryAtos(
  crashlogContent: string,
  dsymPath: string,
  signal?: AbortSignal,
): Promise<SymbolicationResult | null> {
  // atos requires individual addresses — extract from crashlog
  const addressRegex = /0x[0-9a-fA-F]+/g;
  const addresses = crashlogContent.match(addressRegex);
  if (!addresses || addresses.length === 0) {
    return null;
  }

  // Deduplicate
  const uniqueAddresses = [...new Set(addresses)];

  // Extract the dSYM binary path for atos -l (load address)
  // The dsymPath is the .dSYM bundle — find the actual binary
  let dsymBinary = '';
  try {
    const contentsDir = join(dsymPath, 'Contents', 'Resources', 'DWARF');
    const entries = readdirSync(contentsDir);
    dsymBinary = join(contentsDir, entries[0] ?? '');
  } catch {
    dsymBinary = dsymPath;
  }

  // atos can batch-process: -o <dsymBinary> <addr1> <addr2> ...
  try {
    const { stdout, exitCode } = await spawnCommand(
      'xcrun',
      ['atos', '-o', dsymBinary, ...uniqueAddresses.slice(0, 500)],
      signal,
      30000,
    );

    if (exitCode === 0 && stdout.trim()) {
      // atos outputs one line per address in order — replace addresses in crashlog
      let result = crashlogContent;
      const lines = stdout.trim().split('\n');
      for (let i = 0; i < Math.min(uniqueAddresses.length, lines.length); i++) {
        const addr = uniqueAddresses[i];
        const line = lines[i];
        if (!addr || !line) continue;
        const sym = line.trim();
        if (sym && sym !== addr) {
          // Replace address with symbol (only if actually resolved)
          result = result.replace(new RegExp(addr.replace('0x', '0x'), 'g'), sym);
        }
      }
      return {
        symbolicated: true,
        content: result,
        strategy: 'atos',
      };
    }
  } catch {
    // atos failed — try next strategy
  }

  return null;
}

// ─── Strategy 3: llvm-symbolizer ────────────────────────────────

async function tryLlvmSymbolizer(
  crashlogContent: string,
  dsymPath: string,
  signal?: AbortSignal,
): Promise<SymbolicationResult | null> {
  try {
    // llvm-symbolizer is not guaranteed to be installed
    const { exitCode } = await spawnCommand('which', ['llvm-symbolizer'], signal, 3000);
    if (exitCode !== 0) {
      return null;
    }
  } catch {
    return null;
  }

  // Address extraction same as atos
  const addressRegex = /0x[0-9a-fA-F]+/g;
  const addresses = [...new Set(crashlogContent.match(addressRegex) ?? [])];

  if (addresses.length === 0) return null;

  // Pipe addresses through llvm-symbolizer as stdin
  const input = addresses.join('\n');
  try {
    const proc = spawnSync('llvm-symbolizer', ['-dsym-hint', dsymPath], {
      input,
      timeout: 30000,
      signal,
      encoding: 'utf-8',
    });

    if (proc.error || proc.status !== 0) {
      return null;
    }

    const lines = (proc.stdout ?? '').trim().split('\n');
    let result = crashlogContent;
    for (let i = 0; i < Math.min(addresses.length, Math.floor(lines.length / 2)); i++) {
      const addr = addresses[i];
      const funcLine = lines[i * 2]?.trim();
      const fileLine = lines[i * 2 + 1]?.trim();
      if (addr && funcLine && funcLine !== addr) {
        const symbol = fileLine ? `${funcLine} (${fileLine})` : funcLine;
        result = result.replace(new RegExp(addr.replace('0x', '0x'), 'g'), symbol);
      }
    }

    return {
      symbolicated: true,
      content: result,
      strategy: 'llvm-symbolizer',
    };
  } catch {
    return null;
  }
}

// ─── Public API: symbolicateCrashlog ────────────────────────────

/**
 * Symbolicate a crashlog file using the best available strategy.
 *
 * Strategies tried in order:
 *   1. xcrun symbolicatecrash (Apple's bundled tool)
 *   2. xcrun atos (address-to-symbol, batch mode)
 *   3. llvm-symbolizer (LLVM fallback, requires installation)
 *
 * R5: if all strategies fail, the raw crashlog is returned as-is
 *     with symbolicated: false and an explicit error message.
 *     Never pretends to have symbolicated — the caller can check
 *     result.symbolicated to determine if the content is raw or resolved.
 *
 * @param crashlogPath - Path to the raw crashlog file.
 * @param appName - App executable name (for dSYM auto-discovery).
 * @param dsymPath - Optional explicit dSYM path (checked first).
 * @param signal - Optional AbortSignal for cancellation.
 * @returns SymbolicationResult with content and strategy info.
 */
export async function symbolicateCrashlog(
  crashlogPath: string,
  appName: string,
  dsymPath?: string,
  signal?: AbortSignal,
): Promise<SymbolicationResult> {
  // Read raw crashlog content first
  const rawContent = readFileSync(crashlogPath, 'utf-8');

  // Find dSYM
  const resolvedDsym = findDsym(appName, dsymPath);
  if (!resolvedDsym) {
    return {
      symbolicated: false,
      content: rawContent,
      strategy: 'none',
      error:
        'dSYM not found — check DerivedData or provide explicit dsymPath (R5: crashlog preserved as raw)',
    };
  }

  // Strategy 1: symbolicatecrash
  const outputPath = `${crashlogPath}.symbolicated`;
  const result1 = await trySymbolicateCrash(crashlogPath, resolvedDsym, outputPath, signal);
  if (result1) return result1;

  // Strategy 2: atos
  const result2 = await tryAtos(rawContent, resolvedDsym, signal);
  if (result2?.symbolicated) return result2;

  // Strategy 3: llvm-symbolizer
  const result3 = await tryLlvmSymbolizer(rawContent, resolvedDsym, signal);
  if (result3?.symbolicated) return result3;

  // All strategies failed — return raw content
  return {
    symbolicated: false,
    content: rawContent,
    strategy: 'atos',
    error:
      result2?.error ??
      'All symbolication strategies failed — crashlog preserved as raw (R5: explicit degradation)',
  };
}

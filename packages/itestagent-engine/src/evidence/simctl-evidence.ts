import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ArtifactRef } from 'itestagent-contracts';

async function spawnCommand(
  cmd: string,
  args: string[],
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { timeout: timeoutMs ?? 15000, signal });

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

function makeScreenshotRef(path: string): ArtifactRef {
  const stat = statSync(path);
  return {
    id: ['simctl_screenshot', Date.now()].join('_'),
    type: 'screenshot',
    path: basename(path),
    mimeType: 'image/png',
    sizeBytes: stat.size,
    backend: 'simctl',
    redactionStatus: 'raw-local-only',
  };
}

export async function simctlScreenshot(
  udid: string,
  outputPath: string,
  signal?: AbortSignal,
): Promise<ArtifactRef | null> {
  const dir = join(outputPath, '..');
  mkdirSync(dir, { recursive: true });

  try {
    const res = await spawnCommand(
      'xcrun',
      ['simctl', 'io', udid, 'screenshot', outputPath],
      signal,
      10000,
    );

    if (res.exitCode === 0 && existsSync(outputPath)) {
      return makeScreenshotRef(outputPath);
    }

    const stderrMsg = res.stderr || 'no output';
    console.warn(`simctlScreenshot failed, exit ${res.exitCode}: ${stderrMsg}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`simctlScreenshot error: ${msg}`);
  }

  return null;
}

export interface SimctlRecordingHandle {
  stop(): Promise<ArtifactRef | null>;
  abort(): void;
}

export function simctlStartRecording(
  udid: string,
  outputPath: string,
  signal?: AbortSignal,
): SimctlRecordingHandle | null {
  const dir = join(outputPath, '..');
  mkdirSync(dir, { recursive: true });

  let proc: ReturnType<typeof spawn> | null = null;
  let stopped = false;

  try {
    proc = spawn('xcrun', ['simctl', 'io', udid, 'recordVideo', outputPath], {
      stdio: 'pipe',
      signal,
    });

    let stderr = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    return {
      async stop(): Promise<ArtifactRef | null> {
        if (stopped || !proc) return null;
        stopped = true;
        proc.kill('SIGINT');

        await new Promise<void>((resolve) => {
          if (!proc) {
            resolve();
            return;
          }
          proc.on('close', () => resolve());
          setTimeout(resolve, 5000);
        });

        if (existsSync(outputPath)) {
          const stat = statSync(outputPath);
          return {
            id: ['simctl_video', Date.now()].join('_'),
            type: 'video',
            path: basename(outputPath),
            mimeType: 'video/mp4',
            sizeBytes: stat.size,
            backend: 'simctl',
            redactionStatus: 'raw-local-only',
          };
        }

        console.warn(`simctlStartRecording.stop: Video file not found at ${outputPath}`);
        return null;
      },

      abort(): void {
        if (stopped || !proc) return;
        stopped = true;
        proc.kill('SIGKILL');
        proc = null;
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`simctlStartRecording error: ${msg}`);
    if (proc && !stopped) {
      proc.kill('SIGKILL');
    }
    return null;
  }
}

export async function simctlCollectSyslog(
  udid: string,
  outputPath: string,
  bundleId?: string,
  durationSeconds?: number,
  signal?: AbortSignal,
): Promise<ArtifactRef | null> {
  const dir = join(outputPath, '..');
  mkdirSync(dir, { recursive: true });

  const predicates: string[] = [];
  if (bundleId) {
    predicates.push(`process == "${bundleId}"`);
  }
  const predicate = predicates.length > 0 ? predicates.join(' AND ') : undefined;

  const args = [
    'simctl',
    'spawn',
    udid,
    'log',
    'show',
    '--last',
    `${(durationSeconds ?? 60).toString()}s`,
  ];
  if (predicate) {
    args.push('--predicate', predicate);
  }

  try {
    const res = await spawnCommand('xcrun', args, signal, 15000);

    if (res.exitCode === 0 && res.stdout.trim()) {
      writeFileSync(outputPath, res.stdout, 'utf-8');
      const stat = statSync(outputPath);
      return {
        id: ['simctl_syslog', Date.now()].join('_'),
        type: 'log',
        path: basename(outputPath),
        mimeType: 'text/plain',
        sizeBytes: stat.size,
        backend: 'simctl',
        redactionStatus: 'raw-local-only',
      };
    }

    if (res.exitCode !== 0 && !res.stdout.trim()) {
      return {
        id: ['simctl_syslog_empty', Date.now()].join('_'),
        type: 'log',
        path: basename(outputPath),
        mimeType: 'text/plain',
        sizeBytes: 0,
        backend: 'simctl',
        redactionStatus: 'safe',
      };
    }

    const stderrMsg = res.stderr || 'no output';
    console.warn(`simctlCollectSyslog failed, exit ${res.exitCode}: ${stderrMsg}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`simctlCollectSyslog error: ${msg}`);
  }

  return null;
}

export async function simctlCollectCrashLogs(
  outputDir: string,
  appName?: string,
  signal?: AbortSignal,
): Promise<ArtifactRef[]> {
  mkdirSync(outputDir, { recursive: true });

  const home = process.env.HOME ?? '/tmp';
  const diagnosticDir = join(home, 'Library', 'Logs', 'DiagnosticReports');

  if (!existsSync(diagnosticDir)) {
    return [];
  }

  let crashFiles: string[];
  try {
    crashFiles = readdirSync(diagnosticDir).filter(
      (f) => f.endsWith('.crash') || f.endsWith('.ips'),
    );
  } catch {
    crashFiles = [];
  }

  if (appName) {
    crashFiles = crashFiles.filter((f) => f.includes(appName));
  }

  const artifacts: ArtifactRef[] = [];
  for (const file of crashFiles.slice(0, 10)) {
    const srcPath = join(diagnosticDir, file);
    const destPath = join(outputDir, file);
    try {
      copyFileSync(srcPath, destPath);
      const stat = statSync(destPath);
      const safeName = file.replace(/[^a-zA-Z0-9]/g, '_');
      artifacts.push({
        id: ['simctl_crash', safeName, Date.now()].join('_'),
        type: 'crashlog',
        path: join(basename(outputDir), file),
        mimeType: 'text/plain',
        sizeBytes: stat.size,
        backend: 'simctl',
        redactionStatus: 'raw-local-only',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`simctlCollectCrashLogs copy failed for ${file}: ${msg}`);
    }
  }

  return artifacts;
}

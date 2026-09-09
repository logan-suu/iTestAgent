import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createAppiumDeviceDiscoveryProvider } from '../../../../packages/itestagent-backends/device-appium/src/device-discovery.ts';
import { TestPlanSchema } from '../../../../packages/itestagent-contracts/src/index.ts';
import { createRunStore, createStoreCore, initStore } from '../../../../packages/itestagent-store/src/index.ts';
import { createProductionAgentSessionDependencies } from '../../../../packages/itestagent-engine/src/production-agent-session.ts';
import { createProductionPhysicalPreflight, runProductionPhysicalCommand } from '../../../../packages/itestagent-engine/src/production-physical-preflight.ts';
import { executeProductionTestPlan } from '../../../../packages/itestagent-engine/src/production-run-executor.ts';

// Opt-in local physical acceptance harness. No application/WDA write is reachable.
const stage = process.argv[2];
if (!['build', 'settings', 'validation'].includes(stage ?? '')) throw new Error('Expected build, settings, or validation');
const workspace = process.argv[3];
if (!workspace || process.argv[4] !== '--approved') throw new Error('Supply the approved SpikeApp fixture workspace and --approved; this performs real signed builds.');
const bundleId = 'com.itestagent.spike.SpikeApp';
const root = mkdtempSync('/private/tmp/itestagent-def034-');
console.log(JSON.stringify({ event: 'verification-start', stage, root }));
const discovery = await createAppiumDeviceDiscoveryProvider().discover({ lanes: ['physical'] });
const devices = discovery.devices.filter((d) => d.targetKind === 'physical' && d.availability === 'ready');
if (discovery.status !== 'ok' || devices.length !== 1) throw new Error('Exactly one ready physical target is required');
const device = devices[0]!;
console.log(JSON.stringify({ event: 'target', model: device.model, osVersion: device.osVersion, availability: device.availability }));
const controller = new AbortController();
const runId = `def034-${stage}-${Date.now()}`;
const staging = join(root, 'runs', runId, 'staging');
const audit: any = {
  schemaVersion: 'itestagent.def034-physical-verification.v1', stage, runId,
  timestamp: new Date().toISOString(), runtime: Bun.version,
  target: { kind: device.targetKind, model: device.model, osVersion: device.osVersion, availability: device.availability },
  permissionsScope: 'Build authorized by project owner; fixture confirmation adapter with all device writes blocked. Not a permission/TUI acceptance test.',
  commands: [], progress: [], abort: null, deviceGuardHits: 0, modelCalls: 0, backendCloses: 0,
  processSamples: 0, manualRescue: [], result: null,
};
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const sourceFiles = ['SpikeApp.xcodeproj/project.pbxproj', 'SpikeApp/SpikeApp.swift'];
const sourceBefore = sourceFiles.map((p) => digest(join(workspace, p)));
type Proc = { pid: number; ppid: number; start: string; state: string; command: string };
function processes(): Proc[] {
  const raw = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,stat=,lstart=,comm='], { encoding: 'utf8' });
  return raw.split('\n').flatMap((line) => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.{24})\s+(.+)$/);
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), state: m[3]!, start: m[4]!, command: basename(m[5]!) }] : [];
  });
}
const baseline = processes();
if (!baseline.length) throw new Error('Process observer failed');
const owned = new Map<number, Proc>();
const nativeSpawn = Bun.spawn.bind(Bun);
let activeCommand: any;
let abortPid: number | undefined;
let abortCommand: string | undefined;
let abortAt = 0;
let executionFinished = false;
function sample() {
  const rows = processes();
  audit.processSamples++;
  for (const command of audit.commands) {
    for (const pid of command.pids) {
      const row = rows.find((r) => r.pid === pid);
      if (row && !baseline.some((b) => b.pid === row.pid && b.start === row.start)) owned.set(row.pid, row);
    }
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of rows) {
      const parent = owned.get(row.ppid);
      if (parent && !owned.has(row.pid) && rows.some((r) => r.pid === parent.pid && r.start === parent.start)) {
        owned.set(row.pid, row);
        grew = true;
      }
    }
  }
  return rows;
}
function inventory(path: string, prefix = ''): string[] {
  if (!existsSync(path)) return [];
  const result: string[] = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const name = join(prefix, entry.name);
    result.push(name);
    if (entry.isDirectory() && result.length < 250) result.push(...inventory(join(path, entry.name), name));
    if (result.length >= 250) break;
  }
  return result.slice(0, 250);
}
function abort(reason: string) {
  if (controller.signal.aborted) return;
  const rows = sample();
  const target = rows.find((r) => r.pid === abortPid);
  let live = false;
  if (abortPid && target && !target.state.includes('Z')) { try { process.kill(abortPid, 0); live = true; } catch {} }
  audit.abort = {
    reason, pid: abortPid, command: abortCommand, targetAliveAtRequest: live, targetState: target?.state,
    observed: rows.filter((r) => owned.has(r.pid)).map(({ pid, ppid, command, state }) => ({ pid, ppid, command, state })),
    stagingExists: existsSync(staging), stagingEntries: inventory(staging),
  };
  abortAt = Date.now();
  controller.abort(new DOMException('DEF-034 acceptance cancellation', 'AbortError'));
  console.log(JSON.stringify({ event: 'abort-requested', stage, reason, targetAlive: live, observedOwned: audit.abort.observed.length }));
}
// Observe the real production runner without replacing its spawn/kill/await logic.
Bun.spawn = ((...args: any[]) => {
  const child = (nativeSpawn as any)(...args);
  const argv = Array.isArray(args[0]) ? args[0] : args[0]?.cmd;
  if (activeCommand && argv?.[0] === activeCommand.executable) {
    activeCommand.pids.push(child.pid);
    const isTarget = (stage === 'build' && argv[1] === 'build') ||
      (stage === 'settings' && argv[1] === '-showBuildSettings') ||
      (stage === 'validation' && argv[0] === '/usr/bin/codesign');
    if (isTarget) {
      abortPid = child.pid;
      abortCommand = basename(argv[0]);
      if (stage !== 'build') setImmediate(() => abort('target-process-spawned'));
    }
  }
  return child;
}) as typeof Bun.spawn;
const start = Date.now();
const monitor = setInterval(() => {
  const rows = sample();
  if (stage === 'build' && abortPid && !controller.signal.aborted) {
    const descendants = rows.filter((r) => owned.has(r.pid) && r.pid !== abortPid);
    if (descendants.some((r) => !r.state.includes('Z') && /swift-frontend|clang|ibtool/.test(r.command))) abort('compiler-descendant-observed');
    else if (Date.now() - start > 10000) abort('build-process-observed-for-10s');
  }
  if (Date.now() - start > 150000 && !controller.signal.aborted) abort('acceptance-watchdog');
  // Rescue only identified owned processes; any rescue makes acceptance fail.
  if (abortAt && !executionFinished && Date.now() - abortAt > 10000) {
    for (const row of rows) {
      const prior = owned.get(row.pid);
      if (prior?.start === row.start && !audit.manualRescue.includes(row.pid)) {
        audit.manualRescue.push(row.pid);
        try { process.kill(row.pid, 'SIGKILL'); } catch {}
      }
    }
  }
}, 100);
initStore(root);
const core = createStoreCore(join(root, 'db', 'itestagent.db'));
await core.driver.migrate();
const store = createRunStore(core.db, root);
const sentinel = join(root, 'unrelated-run-sentinel.txt');
writeFileSync(sentinel, 'Must survive production staging cleanup.');
const guard = () => { audit.deviceGuardHits++; throw new Error('Verification safety guard: device writes are not authorized'); };
const production = createProductionAgentSessionDependencies();
const originalClose = production.closeDeviceBackend!;
production.closeDeviceBackend = async (...args) => { audit.backendCloses++; return originalClose(...args); };
production.physicalPreflight = createProductionPhysicalPreflight({
  createDevicectlOps: guard,
  runCommand: async (cmd, args, options) => {
    const record: any = { executable: cmd, action: args[0], pids: [], startedMs: Date.now() - start, signalMatches: options?.signal === controller.signal };
    audit.commands.push(record);
    activeCommand = record;
    const promise = runProductionPhysicalCommand(cmd, args, options);
    activeCommand = undefined;
    try {
      const result = await promise;
      record.exitCode = result.exitCode;
      // Keep only fixed classifications, never raw provisioning/build output.
      if (result.exitCode !== 0) record.failureClass = /sign|provision|certificate/i.test(result.stderr + result.stdout) ? 'signing-or-provisioning' : 'command-failed';
      return result;
    } finally { record.endedMs = Date.now() - start; }
  },
});
const plan = TestPlanSchema.parse({
  schemaVersion: 'itestagent.test-plan.v3', runId,
  projectProfileRef: `projects/${createHash('sha256').update(workspace).digest('hex')}/project-profile.json`,
  target: { type: 'current_workspace' },
  device: { kind: 'physical', physical: { selector: 'by_udid', udid: device.udid } },
  appSource: { strategy: 'auto_from_workspace' }, backendPreference: {},
  execution: {
    prefer: 'device_backend', fallback: 'abort', resolvedPath: 'device_backend', selectionReason: 'explicit_preference',
    features: ['Validation'], goal: 'Cancel AUT preparation and verify owner cleanup without installing or launching the application.',
    testData: { allowAgentGeneratedData: false, askUserInTuiWhenRequired: true },
    assertion: { policy: 'user_goal_then_profile_then_agent_confirmed' },
  },
  artifacts: { collect: ['screenshot'], report: { outputs: ['summary_md', 'result_json', 'artifact_index_json'] } },
  performance: { baseline: 'skip', baselineDomain: 'physical', thresholdRequired: false },
  safety: { defaultMode: 'ask', highRiskActions: [] },
});
try {
  const result = await executeProductionTestPlan({
    plan, workspace, device, bundleId, scheme: 'SpikeApp', store, storeRoot: root,
    production, signal: controller.signal, preparesWda: false,
    // Confirmation is fixture-scoped; the device-operation boundary is sealed above.
    authorize: async (action) => action === 'execute_project_build' || action === 'replace_device_app',
    suggest: async () => { audit.modelCalls++; throw new Error('No model request is permitted'); },
    onProgress: (p) => { audit.progress.push({ stage: p.stage, atMs: Date.now() - start }); console.log(JSON.stringify({ event: 'progress', stage: p.stage })); },
  });
  executionFinished = true;
  audit.result = { dispatchStatus: result.status, runStatus: result.runStatus, elapsedAfterAbortMs: abortAt ? Date.now() - abortAt : null };
  const bundle = await store.loadRunBundle(runId);
  audit.bundle = { schemaValidated: true, status: bundle.result.status, artifacts: bundle.artifactIndex.artifacts.length, files: readdirSync(result.runDir), cleanupOutcome: bundle.result.cleanupOutcome ?? null };
} catch (error) {
  executionFinished = true;
  audit.exception = error instanceof Error ? error.name : 'unknown';
} finally {
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const rows = sample();
  audit.ownedProcesses = [...owned.values()].map(({ pid, ppid, start, command, state }) => ({ pid, ppid, start, command, state }));
  audit.survivors = rows.filter((r) => owned.get(r.pid)?.start === r.start).map(({ pid, ppid, command, state }) => ({ pid, ppid, command, state }));
  audit.stagingAfter = existsSync(staging);
  audit.sentinelUnchanged = readFileSync(sentinel, 'utf8') === 'Must survive production staging cleanup.';
  audit.sourceUnchanged = sourceFiles.every((p, i) => digest(join(workspace, p)) === sourceBefore[i]);
  audit.pass = audit.abort?.targetAliveAtRequest === true && audit.abort.reason !== 'acceptance-watchdog' &&
    audit.result?.dispatchStatus === 'cancelled' && audit.result?.runStatus === 'cancelled' && audit.bundle?.status === 'cancelled' &&
    audit.survivors.length === 0 && audit.manualRescue.length === 0 && !audit.stagingAfter &&
    audit.sentinelUnchanged && audit.sourceUnchanged && audit.deviceGuardHits === 0 && audit.modelCalls === 0 && audit.backendCloses === 1 &&
    audit.commands.every((c: any) => c.signalMatches);
  clearInterval(monitor);
  Bun.spawn = nativeSpawn as typeof Bun.spawn;
  core.sqlite.close();
  writeFileSync(join(root, 'verification.json'), JSON.stringify(audit, null, 2));
  console.log(JSON.stringify({ event: 'verification-finished', stage, pass: audit.pass, root, result: audit.result, survivors: audit.survivors, stagingAfter: audit.stagingAfter, exception: audit.exception }));
}
process.exitCode = audit.pass ? 0 : 1;

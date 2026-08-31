/**
 * Phase 6 physical closed-loop production contract (Task 6.1).
 *
 * This is an intentionally RED contract for work delivered by Tasks 6.2-6.11.
 * It is skipped during the normal gate until the production composition exists;
 * run it explicitly with ITESTAGENT_PHASE6_RED=1 to reproduce the baseline.
 *
 * The assertions inspect user-reachable production entry points rather than
 * component test doubles. A passing component test is not closed-loop evidence.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RED_ENABLED = process.env.ITESTAGENT_PHASE6_RED === '1';
const contract = RED_ENABLED ? it : it.skip;

const repoRoot = resolve(import.meta.dir, '../../..');

function source(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf-8');
}

const tuiSession = source('packages/itestagent-tui/src/agent-session.ts');
const cli = source('packages/itestagent-cli/src/cli.ts');

function commandSlice(startMarker: string, endMarker: string): string {
  const start = cli.indexOf(startMarker);
  const end = cli.indexOf(endMarker, start + startMarker.length);
  expect(start, `missing CLI marker: ${startMarker}`).toBeGreaterThanOrEqual(0);
  expect(end, `missing CLI marker: ${endMarker}`).toBeGreaterThan(start);
  return cli.slice(start, end);
}

const exploreCommand = commandSlice('// ─── explore', '// ─── config');
const rerunCommand = commandSlice('// ─── rerun', '// ─── run flow');
const runFlowCommand = commandSlice('// ─── run flow', 'return program;');

describe('Phase 6 production physical closed-loop contract (RED baseline)', () => {
  contract('US-4.1/17.1: TUI production session does not register MockDeviceBackend', () => {
    expect(tuiSession).not.toContain("from 'itestagent-device-mock'");
    expect(tuiSession).not.toContain('new MockDeviceBackend()');
  });

  contract('US-17.2: TUI production session does not install an allow-all permission rule', () => {
    expect(tuiSession).not.toContain(
      "permissionEngine.addRule({ action: '*', resource: '*', effect: 'allow' })",
    );
  });

  contract(
    'US-4.1/6.1: TUI uses real project analysis instead of a canned workspace message',
    () => {
      expect(tuiSession).toContain("from 'itestagent-project-analyzer'");
      expect(tuiSession).not.toContain('Project analysis is available. Use');
    },
  );

  contract(
    'US-4.1/17.1: TUI uses real device discovery instead of a fixed connected result',
    () => {
      expect(tuiSession).not.toContain('connected: true');
      expect(tuiSession).not.toContain('Use `itestagent devices` for full device list.');
    },
  );

  contract('US-5.2/8.1/9.1: explore is driven by a confirmed plan, not fixed actions', () => {
    expect(exploreCommand).toContain('parseTestPlanYaml');
    expect(exploreCommand).not.toContain("{ action: 'launch', target: options.bundleId }");
    expect(exploreCommand).not.toContain("{ action: 'screenshot', target: 'explore' }");
  });

  contract(
    'US-13.1/15.1: explore persists the run under RunStore and synthesizes the report trio',
    () => {
      expect(exploreCommand).toContain('createDefaultRunStore');
      expect(exploreCommand).toContain('ReportSynthesizer');
      expect(exploreCommand).not.toContain("join(tmpdir(), 'itestagent', 'runs', runId)");
    },
  );

  contract('US-9.2/R5: flow execution never silently falls back to MockDeviceBackend', () => {
    expect(runFlowCommand).not.toContain('itestagent-backends/device-mock');
    expect(runFlowCommand).not.toContain('Using mock backend for dry-run');
  });

  contract('US-16.1: rerun performs dispatch and records a parentRunId', () => {
    expect(rerunCommand).not.toContain('Full re-execution dispatch requires engine integration');
    expect(rerunCommand).toContain('parentRunId');
  });
});

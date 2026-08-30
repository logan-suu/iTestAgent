/**
 * RemoteXPC tunnel check tests — injected exec, G5 finding regression.
 *
 * devicectl emits JSON only via `--json-output <path>` (Xcode 26.5) — the
 * scriptExec helper simulates that by writing the fixture JSON to the file
 * path passed by the check, mirroring real devicectl behavior.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { type ExecFn, type ExecResult, setExecOverride } from '../utils.js';
import { checkRemotexpcTunnel, extractWiredUdid } from './check-remotexpc-tunnel.js';

const WIRED_JSON = JSON.stringify({
  result: {
    devices: [
      {
        hardwareProperties: { udid: 'UDID-1' },
        connectionProperties: { transportType: 'wired', pairingState: 'paired' },
      },
    ],
  },
});
const ROOT_DEVICES_JSON = JSON.stringify({
  devices: [
    {
      hardwareProperties: { udid: 'UDID-ROOT' },
      connectionProperties: { transportType: 'wired' },
    },
  ],
});
const EMPTY_JSON = JSON.stringify({ result: { devices: [] } });

function scriptExec(
  script: Record<string, { exitCode: number; stdout: string; stderr: string }>,
): ExecFn {
  return (cmd, args): ExecResult => {
    const key = `${cmd} ${args.join(' ')}`;
    for (const [pattern, result] of Object.entries(script)) {
      if (!key.includes(pattern)) continue;
      const jsonIdx = args.indexOf('--json-output');
      if (jsonIdx !== -1) writeFileSync(args[jsonIdx + 1] as string, result.stdout);
      return result;
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  };
}

beforeEach(() => setExecOverride());

describe('extractWiredUdid', () => {
  it('extracts the first wired device UDID (Xcode 26 result shape)', () => {
    expect(extractWiredUdid(WIRED_JSON)).toBe('UDID-1');
  });
  it('extracts from the root-level devices shape (older devicectl)', () => {
    expect(extractWiredUdid(ROOT_DEVICES_JSON)).toBe('UDID-ROOT');
  });
  it('returns null for an empty device list', () => {
    expect(extractWiredUdid(EMPTY_JSON)).toBeNull();
  });
  it('returns null for non-JSON output', () => {
    expect(extractWiredUdid('progress: 50%\n')).toBeNull();
  });
});

describe('checkRemotexpcTunnel', () => {
  it('passes when both layers see the wired device', async () => {
    setExecOverride(
      scriptExec({
        'devicectl list devices': { exitCode: 0, stdout: WIRED_JSON, stderr: '' },
        'idevice_id -l': { exitCode: 0, stdout: 'UDID-1\n', stderr: '' },
      }),
    );
    const result = await checkRemotexpcTunnel();
    expect(result.status).toBe('pass');
  });

  it('fails with the tunnel-creation guide when the legacy layer is blind (G5 gap)', async () => {
    setExecOverride(
      scriptExec({
        'devicectl list devices': { exitCode: 0, stdout: WIRED_JSON, stderr: '' },
        'idevice_id -l': { exitCode: 0, stdout: '', stderr: '' },
      }),
    );
    const result = await checkRemotexpcTunnel();
    expect(result.status).toBe('fail');
    expect(result.fixGuide?.some((g) => g.includes('tunnel-creation'))).toBe(true);
  });

  it('is manual when no wired device is present', async () => {
    setExecOverride(
      scriptExec({
        'devicectl list devices': { exitCode: 0, stdout: EMPTY_JSON, stderr: '' },
      }),
    );
    const result = await checkRemotexpcTunnel();
    expect(result.status).toBe('manual');
  });

  it('is manual when devicectl is unavailable', async () => {
    setExecOverride(
      scriptExec({
        'devicectl list devices': { exitCode: -1, stdout: '', stderr: 'command not found' },
      }),
    );
    const result = await checkRemotexpcTunnel();
    expect(result.status).toBe('manual');
    expect(result.message).toContain('devicectl unavailable');
  });

  it('is manual when the legacy-layer probe (idevice_id) is not installed', async () => {
    setExecOverride(
      scriptExec({
        'devicectl list devices': { exitCode: 0, stdout: WIRED_JSON, stderr: '' },
        'idevice_id -l': { exitCode: -1, stdout: '', stderr: 'command not found' },
      }),
    );
    const result = await checkRemotexpcTunnel();
    expect(result.status).toBe('manual');
    expect(result.message).toContain('libimobiledevice');
  });
});

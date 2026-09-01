import { describe, expect, it } from 'bun:test';
import { runXcodebuildTests } from '../src/xcodebuild-test-runner.js';

describe('runXcodebuildTests', () => {
  it('maps the confirmed test plan and target filters to xcodebuild arguments', async () => {
    let recorded: string[] = [];
    const result = await runXcodebuildTests(
      {
        projectRoot: '/workspace/Demo',
        scheme: 'Demo',
        testPlan: 'Smoke',
        allowProvisioningUpdates: true,
        destination: { targetKind: 'simulator', simulatorId: 'SIM-1' },
        only: ['DemoUITests'],
        extraArgs: ['-resultBundlePath', '/tmp/result.xcresult'],
      },
      async (_cmd, args) => {
        recorded = args;
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    );
    expect(recorded).toEqual([
      'test',
      '-scheme',
      'Demo',
      '-destination',
      'platform=iOS Simulator,id=SIM-1',
      '-testPlan',
      'Smoke',
      '-allowProvisioningUpdates',
      '-only-testing:DemoUITests',
      '-resultBundlePath',
      '/tmp/result.xcresult',
    ]);
    expect(result.exitCode).toBe(0);
  });
});

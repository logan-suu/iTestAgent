import { describe, expect, it } from 'bun:test';
import { resolveSimulatorReportContext } from '../src/simulator-report-context.js';

describe('resolveSimulatorReportContext', () => {
  it('carries the run id', () => {
    expect(resolveSimulatorReportContext({ runId: 'r1' }).runId).toBe('r1');
  });
});

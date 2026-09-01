import { describe, expect, it } from 'bun:test';
import {
  migrateTestPlanToV3,
  migrateTestPlanV1,
  migrateTestPlanV2,
} from '../src/migrations/test-plan-v2.js';

describe('migrateTestPlanV2', () => {
  it('migrates an explicit DeviceBackend plan without retaining XCUITest state', () => {
    const result = migrateTestPlanV2({
      schemaVersion: 'itestagent.test-plan.v2',
      execution: { prefer: 'device_backend', fallback: 'device_backend' },
    });
    expect(result).toEqual({
      ok: true,
      value: {
        schemaVersion: 'itestagent.test-plan.v3',
        execution: {
          prefer: 'device_backend',
          fallback: 'device_backend',
          resolvedPath: 'device_backend',
          selectionReason: 'explicit_preference',
        },
      },
    });
  });

  it('migrates an explicit XCUITest plan and forces abort fallback', () => {
    const result = migrateTestPlanV2({
      schemaVersion: 'itestagent.test-plan.v2',
      execution: {
        prefer: 'xcuitest',
        fallback: 'device_backend',
        xcuitest: { scheme: 'DemoUITests' },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.execution).toMatchObject({
        resolvedPath: 'xcuitest',
        selectionReason: 'explicit_preference',
        fallback: 'abort',
      });
    }
  });

  it('fails closed for an auto legacy plan even when it retained a scheme hint', () => {
    const result = migrateTestPlanV2({
      schemaVersion: 'itestagent.test-plan.v2',
      execution: {
        prefer: 'auto',
        fallback: 'device_backend',
        xcuitest: { scheme: 'DemoUITests' },
      },
    });
    expect(result).toEqual({
      ok: false,
      issues: [expect.objectContaining({ code: 'execution_route_ambiguous' })],
    });
  });
});

describe('migrateTestPlanV1 / compatibility reader', () => {
  it('uses the same fail-closed rule for v1', () => {
    const result = migrateTestPlanV1({
      schemaVersion: 'itestagent.test-plan.v1',
      execution: { prefer: 'device_backend', fallback: 'device_backend' },
    });
    expect(result.ok).toBe(true);
  });

  it('passes canonical v3 through without rewriting persisted input', () => {
    const raw = { schemaVersion: 'itestagent.test-plan.v3', runId: 'r1' };
    const result = migrateTestPlanToV3(raw);
    expect(result).toEqual({ ok: true, value: raw });
    expect(result.ok && result.value).not.toBe(raw);
  });
});

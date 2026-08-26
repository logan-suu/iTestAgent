import { describe, expect, it } from 'bun:test';
import { createPhysicalMvpCleanup } from '../src/physical-mvp-cleanup.js';

describe('createPhysicalMvpCleanup', () => {
  it('runs cleanup in AUT-before-WDA order (recorder, appium, AUT, WDA)', async () => {
    const order: string[] = [];
    const cleanup = createPhysicalMvpCleanup({
      steps: {
        stopRecorder: async () => {
          order.push('recorder');
        },
        stopAppium: async () => {
          order.push('appium');
        },
        stopAut: async () => {
          order.push('aut');
        },
        stopWda: async () => {
          order.push('wda');
        },
      },
    });
    await cleanup.run();
    expect(order).toEqual(['recorder', 'appium', 'aut', 'wda']);
  });
});

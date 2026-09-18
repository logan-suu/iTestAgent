import { expect, test } from 'bun:test';
import { analyzeMemoryGrowth } from '../src/memory-growth.js';
import { waitForObservation } from '../src/observation-wait.js';

test('reports interval growth and recovery without declaring leaks or failure', () => {
  const samples = [
    { timestampMs: 1000, footprintMiB: 10 },
    { timestampMs: 31000, footprintMiB: 30 },
    { timestampMs: 61000, footprintMiB: 12 },
  ];
  const result = analyzeMemoryGrowth(samples);
  expect(result).toMatchObject({
    deltaMiB: 2,
    rateMiBPerMinute: 2,
    peakMiB: 30,
    sampleCount: 3,
    durationMs: 60000,
    direction: 'increased',
    scope: 'observed_interval',
    approximate: true,
  });
  if (samples[0]) samples[0].footprintMiB = 99;
  expect(result?.samples[0]?.footprintMiB).toBe(10);
  expect(
    analyzeMemoryGrowth([
      { timestampMs: 0, footprintMiB: 10 },
      { timestampMs: 1000, footprintMiB: 9 },
    ])?.direction,
  ).toBe('decreased');
});

test('missing, duplicated, unordered and nonfinite samples are not healthy results', () => {
  for (const samples of [
    [],
    [{ timestampMs: 0, footprintMiB: 1 }],
    [
      { timestampMs: 0, footprintMiB: 1 },
      { timestampMs: 0, footprintMiB: 2 },
    ],
    [
      { timestampMs: 1, footprintMiB: 1 },
      { timestampMs: 0, footprintMiB: 2 },
    ],
    [
      { timestampMs: 0, footprintMiB: 1 },
      { timestampMs: 1, footprintMiB: Number.NaN },
    ],
  ]) {
    expect(analyzeMemoryGrowth(samples)).toBeUndefined();
  }
});

test('observation wait aborts immediately instead of waiting out its deadline', async () => {
  const controller = new AbortController();
  const waiting = waitForObservation(60000, controller.signal);
  controller.abort();
  await expect(waiting).rejects.toThrow('performance.cancelled');
});

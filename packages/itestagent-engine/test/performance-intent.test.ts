import { expect, test } from 'bun:test';
import { MemoryObservationSchema } from 'itestagent-contracts';
import { parseIntent } from '../src/intent-parser.js';
import { parsePerformanceRequest } from '../src/performance-intent.js';

test('Chinese memory-growth and leak requests are explicit, not a generic performance bundle', () => {
  const { intent } = parseIntent('用真机测试应用的内存增长和泄漏，观察 1 分钟');
  expect(intent.metricsRequested).toBe(true);
  expect(intent.requestedMetrics).toEqual(['memory_peak', 'memory_growth', 'memory_leaks']);
  expect(intent.memoryObservation).toEqual({ minimumDurationMs: 60000, settleDurationMs: 5000 });
});

test('narrow requests and exclusions do not request unrelated metrics', () => {
  expect(parsePerformanceRequest('measure memory growth, without leaks').requestedMetrics).toEqual([
    'memory_peak',
    'memory_growth',
  ]);
  expect(parsePerformanceRequest('检查泄漏').requestedMetrics).toEqual(['memory_leaks']);
  expect(parsePerformanceRequest('检查内存峰值').requestedMetrics).toEqual(['memory_peak']);
  expect(parsePerformanceRequest('点击 Tap Me')).toEqual({});
  expect(
    MemoryObservationSchema.safeParse(
      parsePerformanceRequest('内存增长，观察 999 分钟').memoryObservation,
    ).success,
  ).toBe(false);
});

test.each([
  '内存增长，点击按钮，等待20秒，观察70秒，操作后等待10秒',
  '内存增长，操作后等待10秒，点击按钮，等待20秒，观察70秒',
  '内存增长，等待20秒，观察70秒，动作完成后静置10秒',
  'memory growth: wait 20 seconds; observe 70 seconds; after the actions, wait for 10 seconds',
  'memory growth: wait 20 seconds; observe 70 seconds; wait 10 seconds after actions',
  'memory growth: wait 10 seconds after actions; wait 20 seconds; observe 70 seconds',
])('explicit post-action settling takes precedence: %s', (request) => {
  expect(parseIntent(request).intent.memoryObservation).toEqual({
    minimumDurationMs: 70000,
    settleDurationMs: 10000,
  });
});

test('post-action settling preserves zero and rejects out-of-range durations', () => {
  expect(
    parsePerformanceRequest('内存增长，等待20秒，操作后等待0秒').memoryObservation
      ?.settleDurationMs,
  ).toBe(0);
  expect(
    MemoryObservationSchema.safeParse(
      parsePerformanceRequest('内存增长，等待20秒，操作后等待999秒').memoryObservation,
    ).success,
  ).toBe(false);
  expect(
    parsePerformanceRequest('memory growth; wait 8 seconds').memoryObservation?.settleDurationMs,
  ).toBe(8000);
});

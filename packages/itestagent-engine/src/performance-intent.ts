import type { Intent } from 'itestagent-contracts';

/** Explicit performance requests take precedence over the legacy broad metric bundle. */
export function parsePerformanceRequest(
  text: string,
): Pick<Intent, 'requestedMetrics' | 'memoryObservation'> {
  const requestedMetrics: NonNullable<Intent['requestedMetrics']> = [];
  // Handle simple exclusions without interpreting a negated metric as a request.
  const affirmative = text
    .toLowerCase()
    .replace(
      /(?:不要|不测|无需|do not|don't|without)\s*(?:检测|采集|测试|collect|measure|test)?\s*(?:内存泄漏|泄漏|memory leaks?|leaks?|内存增长|memory growth|fps)/gi,
      '',
    );
  if (/内存|memory|footprint/.test(affirmative)) requestedMetrics.push('memory_peak');
  if (/内存.{0,6}(?:增长|趋势)|(?:memory.{0,12}(?:growth|trend))/.test(affirmative))
    requestedMetrics.push('memory_growth');
  if (/泄漏|\bleaks?\b/.test(affirmative)) requestedMetrics.push('memory_leaks');
  if (/\bfps\b|帧率/.test(affirmative)) requestedMetrics.push('fps');
  if (/hitches|卡顿/.test(affirmative)) requestedMetrics.push('hitches');
  if (/crash|崩溃/.test(affirmative)) requestedMetrics.push('crash');
  if (/launch time|启动耗时|启动时间/.test(affirmative)) requestedMetrics.push('launch_time');
  if (/test duration|测试耗时/.test(affirmative)) requestedMetrics.push('test_duration');
  if (!requestedMetrics.length) return {};
  const memory = requestedMetrics.some((m) => m === 'memory_growth' || m === 'memory_leaks');
  const duration =
    /(?:观察|采样|持续|采集|record|observe|sample)(?:\s*for)?\s*(\d+)\s*(秒|分钟|seconds?|minutes?|s\b|min\b)/i.exec(
      text,
    );
  const millis = duration
    ? Number(duration[1]) * (/分钟|minute|min/i.test(duration[2] ?? '') ? 60_000 : 1000)
    : 30_000;
  // Explicit post-action settling wins over an earlier wait inside the workload.
  const settle =
    /(?:(?:操作|动作|测试)(?:结束|完成)?后|after\s+(?:the\s+)?(?:actions?|operations?|tests?))\s*[,，:]?\s*(?:等待|静置|wait)(?:\s*for)?\s*(\d+)\s*(?:秒|seconds?\b|s\b)/i.exec(
      text,
    ) ??
    /\bwait(?:\s+for)?\s*(\d+)\s*(?:seconds?\b|s\b)\s+after\s+(?:the\s+)?(?:actions?|operations?|tests?)\b/i.exec(
      text,
    ) ??
    /(?:等待|wait)(?:\s*for)?\s*(\d+)\s*(秒|seconds?|s\b)/i.exec(text);
  // Invalid durations are not silently clamped into another confirmed request.
  return {
    requestedMetrics,
    ...(memory
      ? {
          memoryObservation: {
            minimumDurationMs: millis,
            settleDurationMs: settle ? Number(settle[1]) * 1000 : 5000,
          },
        }
      : {}),
  };
}

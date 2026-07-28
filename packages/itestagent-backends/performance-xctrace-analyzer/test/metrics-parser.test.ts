/**
 * metrics-parser.test.ts — unit tests for xctrace XML → PerformanceMetrics parsing.
 *
 * Tests cover:
 *   - Hitches summary parsing (low/medium/high/inconclusive)
 *   - Memory peak extraction (MB and bytes→MB conversion)
 *   - Crash detection (EXC_CRASH, SIGABRT, SIGSEGV)
 *   - Launch duration parsing (ms and seconds→ms conversion)
 *   - Hang count extraction
 *   - R5 approximate flag enforcement
 *   - Empty/malformed XML handling
 */

import { describe, expect, it } from 'bun:test';
import type { PerformanceMetrics } from 'itestagent-contracts';
import {
  parsePerformanceMetrics,
  parseRawMetrics,
  parseTraceSummary,
} from '../src/metrics-parser.js';

// ─── Fixture helpers ──────────────────────────────────────────────

const HITCHES_XML = `<?xml version="1.0"?>
<trace-export>
  <schema name="com.apple.xctrace.hitches_summary">
    <row>
      <hitches-count>15</hitches-count>
      <hitches-duration-ms>320</hitches-duration-ms>
      <hitch-ratio>12.5</hitch-ratio>
      <total-duration-ms>45000</total-duration-ms>
    </row>
  </schema>
  <schema name="com.apple.xctrace.hang">
    <row><hang-duration-ms>520</hang-duration-ms></row>
    <row><hang-duration-ms>180</hang-duration-ms></row>
    <row><hang-duration-ms>340</hang-duration-ms></row>
  </schema>
  <schema name="com.apple.xctrace.memory">
    <row><peak-memory-MB>418.5</peak-memory-MB></row>
  </schema>
  <schema name="com.apple.xctrace.launch">
    <row><launch-duration-ms>1320</launch-duration-ms></row>
  </schema>
</trace-export>`;

const CRASH_XML = `<?xml version="1.0"?>
<trace-export>
  <schema name="com.apple.xctrace.crash">
    <row>
      <crash-type>EXC_CRASH (SIGABRT)</crash-type>
      <crash-reason>uncaught exception</crash-reason>
    </row>
  </schema>
</trace-export>`;

const LOW_HITCHES_XML = `<?xml version="1.0"?>
<trace-export>
  <schema name="com.apple.xctrace.hitches_summary">
    <row><hitches-count>2</hitches-count><hitch-ratio>0.5</hitch-ratio></row>
  </schema>
</trace-export>`;

const HIGH_HITCHES_XML = `<?xml version="1.0"?>
<trace-export>
  <schema name="com.apple.xctrace.hitches_summary">
    <row><hitches-count>50</hitches-count><hitch-ratio>35.0</hitch-ratio></row>
  </schema>
</trace-export>`;

const EMPTY_XML = `<?xml version="1.0"?>
<trace-export>
</trace-export>`;

const MALFORMED_XML = 'this is not xml at all';

const BYTES_MEMORY_XML = `<?xml version="1.0"?>
<trace-export>
  <schema name="com.apple.xctrace.memory">
    <row><peak-memory-MB>524288000</peak-memory-MB></row>
  </schema>
</trace-export>`;

const LAUNCH_SECONDS_XML = `<?xml version="1.0"?>
<trace-export>
  <schema name="com.apple.xctrace.launch">
    <row><launch-duration-s>2.5</launch-duration-s></row>
  </schema>
</trace-export>`;

const FPS_XML = `<?xml version="1.0"?>
<trace-export>
  <schema name="com.apple.xctrace.core-animation-fps-estimate">
    <row><fps>59.8</fps><frame-count>1800</frame-count><duration-s>30.1</duration-s></row>
  </schema>
</trace-export>`;

const FPS_PERFECT_XML = `<?xml version="1.0"?>
<trace-export>
  <schema name="com.apple.xctrace.core-animation-fps-estimate">
    <row><fps>60.0</fps></row>
  </schema>
</trace-export>`;

const FPS_LOW_XML = `<?xml version="1.0"?>
<trace-export>
  <schema name="com.apple.xctrace.core-animation-fps-estimate">
    <row><frame-rate>25.3</frame-rate></row>
  </schema>
</trace-export>`;

const FPS_FRAME_PER_SECOND_XML = `<?xml version="1.0"?>
<trace-export>
  <schema name="com.apple.xctrace.core-animation-fps-estimate">
    <row><frames-per-second>44.7</frames-per-second></row>
  </schema>
</trace-export>`;

const FPS_OUTLIER_XML = `<?xml version="1.0"?>
<trace-export>
  <schema name="com.apple.xctrace.core-animation-fps-estimate">
    <row><fps>9999.0</fps></row>
  </schema>
</trace-export>`;

const config = { isSimulator: false };
const simConfig = { isSimulator: true };

// ─── Hitches Summary ──────────────────────────────────────────────

describe('parsePerformanceMetrics — hitches summary', () => {
  it('parses medium hitches from ratio 12.5', () => {
    const metrics = parsePerformanceMetrics(HITCHES_XML, config);
    expect(metrics.hitchesSummary).toBe('medium');
  });

  it('parses low hitches from ratio 0.5', () => {
    const metrics = parsePerformanceMetrics(LOW_HITCHES_XML, config);
    expect(metrics.hitchesSummary).toBe('low');
  });

  it('parses high hitches from ratio 35.0', () => {
    const metrics = parsePerformanceMetrics(HIGH_HITCHES_XML, config);
    expect(metrics.hitchesSummary).toBe('high');
  });

  it('returns inconclusive for empty XML', () => {
    const metrics = parsePerformanceMetrics(EMPTY_XML, config);
    expect(metrics.hitchesSummary).toBe('inconclusive');
  });

  it('returns inconclusive for malformed XML', () => {
    const metrics = parsePerformanceMetrics(MALFORMED_XML, config);
    expect(metrics.hitchesSummary).toBe('inconclusive');
  });

  it('falls back to count-based level when no ratio', () => {
    const xml = `<?xml version="1.0"?><trace-export>
      <schema name="com.apple.xctrace.hitches_summary">
        <row><hitches-count>7</hitches-count></row>
      </schema>
    </trace-export>`;
    const metrics = parsePerformanceMetrics(xml, config);
    expect(metrics.hitchesSummary).toBe('medium');
  });
});

// ─── Hang Count ───────────────────────────────────────────────────

describe('parsePerformanceMetrics — hang count', () => {
  it('counts Hang elements in XML', () => {
    const metrics = parsePerformanceMetrics(HITCHES_XML, config);
    // HITCHES_XML contains 3 <Hang> elements
    expect(metrics.hangCount).toBe(3);
  });

  it('returns 0 when no Hang elements', () => {
    const metrics = parsePerformanceMetrics(CRASH_XML, config);
    expect(metrics.hangCount).toBe(0);
  });

  it('returns 0 for empty XML', () => {
    const metrics = parsePerformanceMetrics(EMPTY_XML, config);
    expect(metrics.hangCount).toBe(0);
  });
});

// ─── Memory Peak ──────────────────────────────────────────────────

describe('parsePerformanceMetrics — memory peak', () => {
  it('extracts memory peak in MB', () => {
    const metrics = parsePerformanceMetrics(HITCHES_XML, config);
    expect(metrics.memoryPeakMB).toBeCloseTo(418.5, 1);
  });

  it('returns undefined when no memory data', () => {
    const metrics = parsePerformanceMetrics(CRASH_XML, config);
    expect(metrics.memoryPeakMB).toBeUndefined();
  });

  it('R5: memory peak is always approximate', () => {
    const metrics = parsePerformanceMetrics(HITCHES_XML, config);
    expect(metrics.approximate).toBe(true);
  });
});

// ─── Crash Detection ──────────────────────────────────────────────

describe('parsePerformanceMetrics — crash detection', () => {
  it('detects crash from EXC_CRASH pattern', () => {
    const metrics = parsePerformanceMetrics(CRASH_XML, config);
    expect(metrics.crashDetected).toBe(true);
  });

  it('detects SIGABRT', () => {
    const xml = '<data>SIGABRT at 0x00000001</data>';
    const metrics = parsePerformanceMetrics(xml, config);
    expect(metrics.crashDetected).toBe(true);
  });

  it('detects SIGSEGV', () => {
    const xml = '<data>SIGSEGV: segmentation fault</data>';
    const metrics = parsePerformanceMetrics(xml, config);
    expect(metrics.crashDetected).toBe(true);
  });

  it('detects fatal error', () => {
    const xml = '<data>fatal error: index out of range</data>';
    const metrics = parsePerformanceMetrics(xml, config);
    expect(metrics.crashDetected).toBe(true);
  });

  it('detects uncaught exception', () => {
    const xml = '<data>uncaught exception: NSRangeException</data>';
    const metrics = parsePerformanceMetrics(xml, config);
    expect(metrics.crashDetected).toBe(true);
  });

  it('returns false when no crash patterns', () => {
    const metrics = parsePerformanceMetrics(HITCHES_XML, config);
    expect(metrics.crashDetected).toBe(false);
  });
});

// ─── Launch Duration ──────────────────────────────────────────────

describe('parsePerformanceMetrics — launch duration', () => {
  it('extracts launch duration in ms', () => {
    const metrics = parsePerformanceMetrics(HITCHES_XML, config);
    expect(metrics.launchDurationMs).toBe(1320);
  });

  it('converts launch duration from seconds to ms', () => {
    const metrics = parsePerformanceMetrics(LAUNCH_SECONDS_XML, config);
    expect(metrics.launchDurationMs).toBe(2500);
  });

  it('returns undefined when no launch data', () => {
    const metrics = parsePerformanceMetrics(CRASH_XML, config);
    expect(metrics.launchDurationMs).toBeUndefined();
  });
});

// ─── R5: Approximate Flag ─────────────────────────────────────────

describe('parsePerformanceMetrics — R5 approximate flag', () => {
  it('always sets approximate=true for xctrace data', () => {
    const metrics1 = parsePerformanceMetrics(HITCHES_XML, config);
    const metrics2 = parsePerformanceMetrics(EMPTY_XML, config);
    const metrics3 = parsePerformanceMetrics(MALFORMED_XML, config);

    expect(metrics1.approximate).toBe(true);
    expect(metrics2.approximate).toBe(true);
    expect(metrics3.approximate).toBe(true);
  });
});

// ─── TraceSummary ─────────────────────────────────────────────────

describe('parseTraceSummary', () => {
  it('produces a valid TraceSummary from XML', () => {
    const summary = parseTraceSummary(HITCHES_XML, config);

    expect(summary.launchDurationMs).toBe(1320);
    expect(summary.memoryPeakMB).toBeCloseTo(418.5, 1);
    expect(summary.crashDetected).toBe(false);
    expect(summary.hangCount).toBe(3);
    expect(summary.approximate).toBe(true);

    const hitches = summary.hitchesSummary as { level: string; hitchesPerSecond?: number };
    expect(hitches.level).toBe('medium');
  });

  it('produces minimal summary from empty XML', () => {
    const summary = parseTraceSummary(EMPTY_XML, config);

    expect(summary.approximate).toBe(true);
    expect(summary.launchDurationMs).toBeUndefined();
    expect(summary.memoryPeakMB).toBeUndefined();
    expect(summary.crashDetected).toBeFalsy();
    expect(summary.hangCount).toBe(0);
  });

  it('includes hitches count in summary structure', () => {
    const summary = parseTraceSummary(HITCHES_XML, config);
    const hitches = summary.hitchesSummary as { level: string; hitchesPerSecond?: number };
    expect(hitches).toBeDefined();
    expect(hitches.level).toBe('medium');
  });

  it('returns 0 hangCount when no Hang elements', () => {
    const summary = parseTraceSummary(CRASH_XML, config);
    expect(summary.hangCount).toBe(0);
  });
});

// ─── parseRawMetrics ──────────────────────────────────────────────

describe('parseRawMetrics', () => {
  it('returns ParsedMetrics structure', () => {
    const metrics = parseRawMetrics(HITCHES_XML, config);

    expect(metrics.launchDurationMs).toBe(1320);
    expect(metrics.memoryPeakMB).toBeCloseTo(418.5, 1);
    expect(metrics.crashDetected).toBe(false);
    expect(metrics.hangCount).toBe(3);
    expect(metrics.hitchesSummary).toBe('medium');
    expect(metrics.approximate).toBe(true);
  });

  it('handles empty data gracefully', () => {
    const metrics = parseRawMetrics(EMPTY_XML, config);

    expect(metrics.approximate).toBe(true);
    expect(metrics.hitchesSummary).toBe('inconclusive');
    expect(metrics.hangCount).toBe(0);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────

describe('parsePerformanceMetrics — edge cases', () => {
  it('handles XML with only whitespace', () => {
    const metrics = parsePerformanceMetrics('   \n  ', config);
    expect(metrics.approximate).toBe(true);
    expect(metrics.crashDetected).toBeFalsy();
    expect(metrics.hangCount).toBe(0);
  });

  it('handles very large XML input without crashing', () => {
    const largeXml = `<data>${'x'.repeat(100000)}</data>`;
    const metrics = parsePerformanceMetrics(largeXml, config);
    expect(metrics.approximate).toBe(true);
  });

  it('handles hitches count as zero correctly', () => {
    const xml = `<?xml version="1.0"?><trace-export>
      <schema name="com.apple.xctrace.hitches_summary">
        <row><hitches-count>0</hitches-count><hitch-ratio>0.0</hitch-ratio></row>
      </schema>
    </trace-export>`;
    const metrics = parsePerformanceMetrics(xml, config);
    expect(metrics.hitchesSummary).toBe('low');
    expect(metrics.hangCount).toBe(0);
  });
});

// ─── FPS Approximate ───────────────────────────────────────────────

describe('parsePerformanceMetrics — FPS approximate (AC2)', () => {
  it('extracts FPS from core-animation-fps-estimate schema', () => {
    const metrics = parsePerformanceMetrics(FPS_XML, config);
    expect(metrics.fpsApproximate).toBeCloseTo(59.8, 1);
  });

  it('extracts perfect FPS (60.0)', () => {
    const metrics = parsePerformanceMetrics(FPS_PERFECT_XML, config);
    expect(metrics.fpsApproximate).toBe(60.0);
  });

  it('extracts FPS from frame-rate element', () => {
    const metrics = parsePerformanceMetrics(FPS_LOW_XML, config);
    expect(metrics.fpsApproximate).toBeCloseTo(25.3, 1);
  });

  it('extracts FPS from frames-per-second element', () => {
    const metrics = parsePerformanceMetrics(FPS_FRAME_PER_SECOND_XML, config);
    expect(metrics.fpsApproximate).toBeCloseTo(44.7, 1);
  });

  it('returns undefined when no FPS data present', () => {
    const metrics = parsePerformanceMetrics(HITCHES_XML, config);
    expect(metrics.fpsApproximate).toBeUndefined();
  });

  it('returns undefined for empty XML', () => {
    const metrics = parsePerformanceMetrics(EMPTY_XML, config);
    expect(metrics.fpsApproximate).toBeUndefined();
  });

  it('rejects outlier FPS value (>120) as undefined', () => {
    const metrics = parsePerformanceMetrics(FPS_OUTLIER_XML, config);
    expect(metrics.fpsApproximate).toBeUndefined();
  });

  it('R5: all metrics including FPS are approximate', () => {
    const metrics = parsePerformanceMetrics(FPS_XML, config);
    expect(metrics.approximate).toBe(true);
  });
});

describe('parseTraceSummary — FPS approximate', () => {
  it('includes fpsApproximate in trace summary', () => {
    const summary = parseTraceSummary(FPS_XML, config);
    expect(summary.fpsApproximate).toBeCloseTo(59.8, 1);
  });

  it('returns undefined fpsApproximate when no FPS data', () => {
    const summary = parseTraceSummary(EMPTY_XML, config);
    expect(summary.fpsApproximate).toBeUndefined();
  });
});

describe('parseRawMetrics — FPS approximate', () => {
  it('includes fpsApproximate in raw metrics', () => {
    const metrics = parseRawMetrics(FPS_XML, config);
    expect(metrics.fpsApproximate).toBeCloseTo(59.8, 1);
  });

  it('returns undefined fpsApproximate when no FPS data', () => {
    const metrics = parseRawMetrics(EMPTY_XML, config);
    expect(metrics.fpsApproximate).toBeUndefined();
  });
});

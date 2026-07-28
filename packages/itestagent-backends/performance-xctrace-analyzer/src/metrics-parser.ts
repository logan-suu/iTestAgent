/**
 * metrics-parser — parse xctrace export XML data into PerformanceMetrics.
 *
 * AGENTS.md R5: all metrics from xctrace are approximate unless proven otherwise.
 *   - memoryPeakMB: always approximate (sampled, not peak)
 *   - hitchesSummary: from hitches_summary schema data
 *   - crashDetected: inferred from crash-related trace data
 *   - launchDurationMs: from app launch trace
 *
 * AC1 (US-12.1): cover launch time / memory peak (approximate) / crash / test duration / hitches/hangs
 * AC5 (US-12.1): memory peak labeled as approximate value
 *
 * Parsing is regex-based for robustness — XML can vary across Xcode versions.
 * Matches both kebab-case (<hitch-ratio>) and camelCase (hitchRatio) patterns.
 * Full xctrace summary deep parsing is deferred to task 4.4.
 */

import type { PerformanceMetrics, TraceSummary } from 'itestagent-contracts';

// ─── Types ────────────────────────────────────────────────────────

/** Parsed metrics from xctrace export data. */
export interface ParsedMetrics {
  launchDurationMs?: number;
  memoryPeakMB?: number;
  crashDetected?: boolean;
  hangCount?: number;
  hitchesSummary?: 'low' | 'medium' | 'high' | 'inconclusive';
  fpsApproximate?: number;
  approximate: boolean;
}

/** Configuration for metrics parsing. */
export interface MetricsParserConfig {
  /** Whether the source is a simulator (affects accuracy annotations). */
  isSimulator: boolean;
}

// ─── Constants ────────────────────────────────────────────────────

/** Regex to detect crash-related entries in trace XML. */
const CRASH_PATTERNS = [
  /<Crash\b/i,
  /<crash\b/i,
  /EXC_CRASH/i,
  /SIGABRT/i,
  /SIGSEGV/i,
  /fatal error/i,
  /uncaught exception/i,
];

/**
 * Extract a number from an XML element value.
 * Matches patterns like: <hitch-ratio>12.5</hitch-ratio>
 */
function extractFromXmlElement(xml: string, tagPattern: RegExp): number | undefined {
  const match = tagPattern.exec(xml);
  if (!match || match[1] === undefined) return undefined;
  const value = Number.parseFloat(match[1]);
  return Number.isNaN(value) ? undefined : value;
}

/**
 * Extract an integer from an XML element value.
 */
function extractIntFromXmlElement(xml: string, tagPattern: RegExp): number | undefined {
  const match = tagPattern.exec(xml);
  if (!match || match[1] === undefined) return undefined;
  const value = Number.parseInt(match[1], 10);
  return Number.isNaN(value) ? undefined : value;
}

/** Regex to extract hitches ratio: matches <hitch-ratio> or hitchRatio variants. */
const HITCHES_RATIO_RE = /<hitch[-_]?ratio[^>]*>(\d+(?:\.\d+)?)<\/hitch[-_]?ratio>/i;
const HITCHES_RATIO_ALT_RE = /hitch[-_]?ratio[^>]*?(\d+(?:\.\d+)?)/i;

/** Regex to extract hang count from trace data. Matches <Hang...> or <hang-...> elements. */
const HANG_COUNT_RE = /<hang[-_]duration[-_]ms\b[^>]*>/gi;

/**
 * Regex to extract memory peak (MB) from XML.
 * Matches: <peak-memory-MB>418.5</peak-memory-MB> or <peak-memory-MB>418.5</...
 */
const MEMORY_PEAK_XML_RE =
  /<peak[-_]?memory[-_]?MB[^>]*>(\d+(?:\.\d+)?)<\/peak[-_]?memory[-_]?MB>/i;
const MEMORY_PEAK_ALT_RE = /peak[-_]?memory[^>]*?(\d+(?:\.\d+)?)\s*(?:MB|MiB)?/i;

/** Regex for memory in bytes (from <peak-memory-MB> with large byte values). */
const MEMORY_BYTES_RE = /peak[-_]?memory[^>]*?(\d{6,})/i;

/**
 * Regex to extract launch duration in ms.
 * Matches: <launch-duration-ms>1320</launch-duration-ms>
 */
const LAUNCH_DURATION_MS_XML_RE =
  /<launch[-_]?duration[-_]?ms[^>]*>(\d+(?:\.\d+)?)<\/launch[-_]?duration[-_]?ms>/i;
const LAUNCH_DURATION_MS_ALT_RE = /launch[-_]?duration[^>]*?(\d+(?:\.?\d+)?)\s*ms/i;

/**
 * Regex to extract launch duration in seconds.
 * Matches: <launch-duration-s>2.5</launch-duration-s>
 */
const LAUNCH_DURATION_S_XML_RE =
  /<launch[-_]?duration[-_]?s[^>]*>(\d+(?:\.\d+)?)<\/launch[-_]?duration[-_]?s>/i;
const LAUNCH_DURATION_S_ALT_RE = /launch[-_]?duration[^>]*?(\d+(?:\.?\d+)?)\s*s(?:econds?)?/i;

/** Regex for hitches count in summary XML. */
const HITCHES_COUNT_XML_RE = /<hitches[-_]?count[^>]*>(\d+)<\/hitches[-_]?count>/i;
const HITCHES_COUNT_ALT_RE = /hitches[-_]?count[^>]*?(\d+)/i;

/**
 * Regex to extract FPS from core-animation-fps-estimate schema XML.
 * Matches: <fps>59.8</fps> or <FPS>60</FPS> or <frame-rate>59.8</frame-rate>
 * Also matches: <frames-per-second>60.0</frames-per-second>
 *
 * AC2 (US-12.1): FPS as FPS-like approximate indicator, not guaranteed precision.
 * R5: always marked approximate.
 */
const FPS_XML_RE =
  /<(?:fps|FPS|frame[-_]?rate)[^>]*>(\d+(?:\.\d+)?)<\/(?:fps|FPS|frame[-_]?rate)>/i;
const FPS_ALT_RE =
  /<(?:frames[-_]?per[-_]?second)[^>]*>(\d+(?:\.\d+)?)<\/(?:frames[-_]?per[-_]?second)>/i;

// ─── Parsing Functions ────────────────────────────────────────────

/**
 * Detect crash presence in trace data.
 */
function detectCrash(xml: string): boolean {
  for (const pattern of CRASH_PATTERNS) {
    if (pattern.test(xml)) {
      return true;
    }
  }
  return false;
}

/**
 * Parse hitches summary level from trace XML data.
 *
 * Hitches ratio thresholds (approximate):
 *   - low: hitch ratio < 5 hitches/sec
 *   - medium: 5-20 hitches/sec
 *   - high: > 20 hitches/sec
 *   - inconclusive: unable to determine
 */
function parseHitchesSummary(xml: string): {
  level: 'low' | 'medium' | 'high' | 'inconclusive';
  count?: number;
} {
  const count =
    extractIntFromXmlElement(xml, HITCHES_COUNT_XML_RE) ??
    extractIntFromXmlElement(xml, HITCHES_COUNT_ALT_RE);

  const ratio =
    extractFromXmlElement(xml, HITCHES_RATIO_RE) ??
    extractFromXmlElement(xml, HITCHES_RATIO_ALT_RE);

  if (ratio !== undefined) {
    if (ratio < 5) return { level: 'low', count };
    if (ratio <= 20) return { level: 'medium', count };
    return { level: 'high', count };
  }

  // Fallback: use count as a rough proxy
  if (count !== undefined) {
    if (count === 0) return { level: 'low', count };
    if (count <= 10) return { level: 'medium', count };
    return { level: 'high', count };
  }

  return { level: 'inconclusive' };
}

/**
 * Parse memory peak (MB) from trace XML data.
 *
 * R5: memory peak is always approximate — it's sampled, not true peak.
 */
function parseMemoryPeak(xml: string): number | undefined {
  // Try MB XML element pattern first
  const mbValue =
    extractFromXmlElement(xml, MEMORY_PEAK_XML_RE) ??
    extractFromXmlElement(xml, MEMORY_PEAK_ALT_RE);
  if (mbValue !== undefined) return mbValue;

  // Try bytes pattern, convert to MB
  const bytesValue = extractIntFromXmlElement(xml, MEMORY_BYTES_RE);
  if (bytesValue !== undefined) return Math.round(bytesValue / (1024 * 1024));

  return undefined;
}

/**
 * Parse launch duration in milliseconds from trace XML data.
 */
function parseLaunchDuration(xml: string): number | undefined {
  // Try milliseconds XML element pattern first
  const msValue =
    extractFromXmlElement(xml, LAUNCH_DURATION_MS_XML_RE) ??
    extractFromXmlElement(xml, LAUNCH_DURATION_MS_ALT_RE);
  if (msValue !== undefined) return Math.round(msValue);

  // Try seconds pattern, convert to ms
  const secValue =
    extractFromXmlElement(xml, LAUNCH_DURATION_S_XML_RE) ??
    extractFromXmlElement(xml, LAUNCH_DURATION_S_ALT_RE);
  if (secValue !== undefined) return Math.round(secValue * 1000);

  return undefined;
}

/**
 * Parse hang count from trace XML data.
 */
function parseHangCount(xml: string): number {
  const matches = xml.match(HANG_COUNT_RE);
  return matches ? matches.length : 0;
}

/**
 * Parse FPS approximate value from xctrace core-animation-fps-estimate XML data.
 *
 * Data source: xctrace schema `com.apple.xctrace.core-animation-fps-estimate`
 * (referenced in tech-selection §11 as XCTraceRunner's `core-animation-fps-estimate`).
 *
 * AC2 (US-12.1): FPS as FPS-like approximate indicator, not guaranteed precision.
 * R5: always marked approximate — this is sampled, not real-time frame pacing.
 *
 * @returns FPS value or undefined if no FPS data found
 */
function parseFpsApproximate(xml: string): number | undefined {
  const fpsValue = extractFromXmlElement(xml, FPS_XML_RE) ?? extractFromXmlElement(xml, FPS_ALT_RE);

  if (fpsValue === undefined) return undefined;

  // Clamp to a reasonable range (0–120). Anything outside is likely a parsing artifact.
  if (fpsValue < 0 || fpsValue > 120) return undefined;

  return fpsValue;
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Parse xctrace export XML data into structured PerformanceMetrics.
 *
 * @param xmlData - Raw XML output from `xcrun xctrace export`
 * @param _config - Parser configuration (reserved for future use)
 * @returns PerformanceMetrics with approximate flags per R5
 */
export function parsePerformanceMetrics(
  xmlData: string,
  _config: MetricsParserConfig,
): PerformanceMetrics {
  const hitches = parseHitchesSummary(xmlData);

  return {
    launchDurationMs: parseLaunchDuration(xmlData),
    memoryPeakMB: parseMemoryPeak(xmlData),
    crashDetected: detectCrash(xmlData),
    hangCount: parseHangCount(xmlData),
    hitchesSummary: hitches.level,
    fpsApproximate: parseFpsApproximate(xmlData),
    approximate: true, // R5: all xctrace-derived metrics are approximate by default
  };
}

/**
 * Convert parsed xctrace data into a TraceSummary.
 *
 * @param xmlData - Raw XML output from `xcrun xctrace export`
 * @param _config - Parser configuration
 * @returns TraceSummary with metadata
 */
export function parseTraceSummary(xmlData: string, _config: MetricsParserConfig): TraceSummary {
  const hitches = parseHitchesSummary(xmlData);
  return {
    launchDurationMs: parseLaunchDuration(xmlData),
    memoryPeakMB: parseMemoryPeak(xmlData),
    crashDetected: detectCrash(xmlData),
    hangCount: parseHangCount(xmlData),
    hitchesSummary: {
      level: hitches.level,
      hitchesPerSecond: hitches.count,
    },
    fpsApproximate: parseFpsApproximate(xmlData),
    approximate: true, // R5: always approximate
  };
}

/**
 * Parse raw exported metrics into ParsedMetrics structure.
 * Used internally by XctracePerformanceBackend.
 */
export function parseRawMetrics(xmlData: string, _config: MetricsParserConfig): ParsedMetrics {
  const hitches = parseHitchesSummary(xmlData);

  return {
    launchDurationMs: parseLaunchDuration(xmlData),
    memoryPeakMB: parseMemoryPeak(xmlData),
    crashDetected: detectCrash(xmlData),
    hangCount: parseHangCount(xmlData),
    hitchesSummary: hitches.level,
    fpsApproximate: parseFpsApproximate(xmlData),
    approximate: true, // R5
  };
}

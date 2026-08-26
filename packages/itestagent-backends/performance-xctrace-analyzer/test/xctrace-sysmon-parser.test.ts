/**
 * xctrace-sysmon-parser.test.ts — B21 nested sysmon frame parsing (promotion
 * guide §11.3 "generic xctrace mechanics").
 *
 * Locks the nested <frame> tree extraction against the sanitized sysmon
 * trace fixture produced in B12 (fixtures/device-responses/
 * xctrace-sysmon-nested-sanitized.xml): self-closing frames must not swallow
 * their siblings, and totals are summed recursively.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSysmonFrames, sumSampleCounts } from '../src/xctrace-sysmon-parser.js';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..');
const FIXTURE_PATH = join(
  REPO_ROOT,
  'fixtures',
  'device-responses',
  'xctrace-sysmon-nested-sanitized.xml',
);

describe('parseSysmonFrames', () => {
  it('parses the sanitized fixture into the nested frame tree', () => {
    const xml = readFileSync(FIXTURE_PATH, 'utf-8');
    const frames = parseSysmonFrames(xml);

    expect(frames).toHaveLength(1);
    const root = frames[0];
    if (!root) throw new Error('expected at least one root frame');
    expect(root.name).toBe('fixture_frame_root');
    expect(root.sampleCount).toBe(20);

    expect(root.children.map((child) => child.name)).toEqual([
      'fixture_frame_child_a',
      'fixture_frame_child_b',
    ]);
    expect(root.children[0]?.sampleCount).toBe(12);
    // Self-closing child_a has no children; child_b nests the leaf.
    expect(root.children[0]?.children).toEqual([]);
    const childB = root.children[1];
    if (!childB) throw new Error('expected child_b in the fixture tree');
    expect(childB.sampleCount).toBe(8);
    expect(childB.children[0]?.name).toBe('fixture_frame_leaf');
    expect(childB.children[0]?.sampleCount).toBe(6);
  });

  it('preserves addresses when present and omits them otherwise', () => {
    const xml =
      '<frame name="with_addr" addr="0xF1X7URE0009" sampleCount="1"><frame name="no_addr" sampleCount="2" /></frame>';
    const [frame] = parseSysmonFrames(xml);
    expect(frame?.addr).toBe('0xF1X7URE0009');
    expect(frame?.children[0]?.addr).toBeUndefined();
  });

  it('returns an empty list for input without frames', () => {
    expect(parseSysmonFrames('<trace-query-result></trace-query-result>')).toEqual([]);
  });
});

describe('sumSampleCounts', () => {
  it('sums samples recursively across the whole tree', () => {
    const xml = readFileSync(FIXTURE_PATH, 'utf-8');
    expect(sumSampleCounts(parseSysmonFrames(xml))).toBe(46); // 20 + 12 + 8 + 6
  });
});

import { expect, test } from 'bun:test';
import { parseLeaksDetail } from '../src/leaks-detail.js';

// Synthetic values preserving the public row shape observed in the physical control probe.
const row =
  '<row leaked-object="Fixture allocation" size="262144" responsible-frame="fixture" count="1" responsible-library="Fixture" address="0x1000"/>';
const wrap = (rows: string) =>
  `<?xml version="1.0"?><trace-query-result><node xpath='//trace-toc[1]/run[1]/tracks[1]/track[2]/details[1]/detail[1]'>${rows}</node></trace-query-result>`;
test('verified per-allocation diagnostic rows produce only safe counts and bytes', () => {
  expect(parseLeaksDetail(wrap(row + row.replace('0x1000', '0x2000')))).toEqual({
    source: 'xctrace-leaks-detail',
    status: 'detected',
    scope: 'observed_allocations',
    allocationCount: 2,
    totalBytes: 524288,
  });
});
test('empty, malformed, unknown, grouped, duplicate or overflowing evidence is not zero leaks', () => {
  for (const xml of [
    wrap(''),
    wrap(row).replace('</node>', ''),
    wrap('<row/>'),
    wrap(row + row),
    wrap(row.replace('count="1"', 'count="2"')),
    wrap(row.replace('262144', '-1')),
    wrap(row.replace('262144', '9007199254740992')),
    wrap(row.replace(' size=', ' size="1" size=')),
    `<!DOCTYPE test>${wrap(row)}`,
  ])
    expect(parseLeaksDetail(xml)).toBeUndefined();
});

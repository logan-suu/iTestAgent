import { expect, test } from 'bun:test';
import { parseActivityMonitorMemory } from '../src/activity-monitor-memory.js';

// Reduced public export structure; all names, PIDs and values are synthetic.
const xml = `<trace-query-result><node><schema name="activity-monitor-process-live">
<col><mnemonic>process</mnemonic><engineering-type>process</engineering-type></col>
<col><mnemonic>pid</mnemonic><engineering-type>pid</engineering-type></col>
<col><mnemonic>memory-physical-footprint</mnemonic><engineering-type>size-in-bytes</engineering-type></col>
</schema><row><process id="1" fmt="Demo (321)"><pid id="2">321</pid></process><pid ref="2"/><size-in-bytes id="3">1048576</size-in-bytes></row>
<row><process ref="1"/><pid ref="2"/><size-in-bytes id="4">2097152</size-in-bytes></row>
<row><process ref="1"/><pid ref="2"/><size-in-bytes ref="3"/></row>
</node></trace-query-result>`;

test('reads exact-target physical footprint and resolves typed id/ref values', () => {
  expect(parseActivityMonitorMemory(xml, 'Demo')).toEqual({ peakMiB: 2, sampleCount: 3 });
  expect(parseActivityMonitorMemory(xml, '321')).toEqual({ peakMiB: 2, sampleCount: 3 });
  expect(parseActivityMonitorMemory(xml, 'Other')).toBeUndefined();
});

test('rejects unknown units, wrong schema, broken references and truncated output', () => {
  for (const invalid of [
    xml.replace('<engineering-type>size-in-bytes', '<engineering-type>unknown'),
    xml.replace('activity-monitor-process-live', 'unknown'),
    xml.replace('size-in-bytes ref="3"', 'size-in-bytes ref="2"'),
    xml.replace('</trace-query-result>', ''),
    xml.replace('2097152', '-1'),
  ])
    expect(parseActivityMonitorMemory(invalid, 'Demo')).toBeUndefined();
});

test('reads actual nanosecond start-time values and keeps unknown timing out of growth', () => {
  let index = 0;
  const timed = xml
    .replace(
      '</schema>',
      '<col><mnemonic>start</mnemonic><engineering-type>start-time</engineering-type></col></schema>',
    )
    .replaceAll(
      '</row>',
      () => `<start-time id="t${index}">${index++ * 1000000000}</start-time></row>`,
    );
  expect(parseActivityMonitorMemory(timed, 'Demo')?.growth).toMatchObject({
    durationMs: 2000,
    sampleCount: 3,
    deltaMiB: 0,
    peakMiB: 2,
  });
  expect(
    parseActivityMonitorMemory(
      timed.replace('start-time id="t1">1000000000', 'start-time id="t1">invalid'),
      'Demo',
    )?.growth,
  ).toBeUndefined();
  expect(
    parseActivityMonitorMemory(
      timed.replace('start-time id="t1">1000000000', 'start-time id="t1">0'),
      'Demo',
    )?.growth,
  ).toBeUndefined();
  expect(parseActivityMonitorMemory(timed, 'Other')).toBeUndefined();
});

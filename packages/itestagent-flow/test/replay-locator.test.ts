import { expect, test } from 'bun:test';
import type { DeviceBackend } from 'itestagent-contracts';
import { resolveTapCoordinates } from '../src/replay-locator.js';

const button = '<XCUIElementTypeButton name="workload" x="24" y="541" width="380" height="31" />';
const locator = { strategy: 'identifier' as const, value: 'workload' };
function backend(raw: string): DeviceBackend {
  return {
    getUiTree: async () => ({ raw, format: 'xml', capturedAt: new Date().toISOString() }),
  } as unknown as DeviceBackend;
}

test('identifier tap maps UI points back into the actual button on a 428 by 926 viewport', async () => {
  const coords = await resolveTapCoordinates(
    locator,
    backend(
      `<XCUIElementTypeApplication x="0" y="0" width="428" height="926">${button}</XCUIElementTypeApplication>`,
    ),
    'fixture',
  );
  expect(coords).toEqual({ x: 0.5, y: 556.5 / 926 });
  // The receiving backend multiplies normalized coordinates by its measured window size.
  expect(Math.round((coords?.x ?? -1) * 428)).toBe(214);
  expect(Math.round((coords?.y ?? -1) * 926)).toBe(557);
});

test('landscape viewport uses the reported dimensions without portrait defaults', async () => {
  const coords = await resolveTapCoordinates(
    locator,
    backend(
      `<XCUIElementTypeApplication x="0" y="0" width="926" height="428"><XCUIElementTypeButton name="workload" x="600" y="100" width="100" height="40" /></XCUIElementTypeApplication>`,
    ),
    'fixture',
  );
  expect(coords).toEqual({ x: 650 / 926, y: 120 / 428 });
});

for (const root of [
  '<XCUIElementTypeApplication>',
  '<XCUIElementTypeApplication x="0" y="0" width="0" height="926">',
  '<XCUIElementTypeApplication x="0" y="0" width="Infinity" height="926">',
  '<XCUIElementTypeApplication x="0" y="0" width="428px" height="926">',
  '<XCUIElementTypeApplication x="1" y="0" width="428" height="926">',
  '<XCUIElementTypeApplication x="0" y="0" width="100" height="100">',
]) {
  test(`blocks an unproven viewport: ${root}`, async () => {
    expect(
      await resolveTapCoordinates(
        locator,
        backend(`${root}${button}</XCUIElementTypeApplication>`),
        'fixture',
      ),
    ).toBeNull();
  });
}

test('does not guess viewport size from a child window or ambiguous applications', async () => {
  expect(
    await resolveTapCoordinates(
      locator,
      backend(
        `<XCUIElementTypeWindow x="0" y="0" width="428" height="926">${button}</XCUIElementTypeWindow>`,
      ),
      'fixture',
    ),
  ).toBeNull();
  const app = `<XCUIElementTypeApplication x="0" y="0" width="428" height="926">${button}</XCUIElementTypeApplication>`;
  expect(
    await resolveTapCoordinates(locator, backend(`<AppiumAUT>${app}${app}</AppiumAUT>`), 'fixture'),
  ).toBeNull();
});

test('explicit normalized coordinates keep their existing meaning without requesting a UI tree', async () => {
  const noTree = {
    getUiTree: () => {
      throw new Error('must not read');
    },
  } as unknown as DeviceBackend;
  expect(
    await resolveTapCoordinates({ strategy: 'coordinate', value: '0.5,0.3' }, noTree, 'fixture'),
  ).toEqual({ x: 0.5, y: 0.3 });
});

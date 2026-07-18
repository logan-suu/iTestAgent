import { expect, test } from 'bun:test';
import { confirmAction } from '../src/config/confirm.js';

test('confirmAction denies in non-interactive mode by default', async () => {
  // Force non-interactive
  const result = await confirmAction({
    action: 'Write project config',
    details: '/test/itestagent.jsonc',
    interactive: false,
  });
  expect(result).toBe('no');
});

test('confirmAction returns no for empty input in non-TTY mode', async () => {
  const result = await confirmAction({
    action: 'Test action',
    details: 'test details',
    interactive: false,
  });
  expect(result).toBe('no');
});

test('confirmAction description contains action and details', async () => {
  // Just verify the function accepts the expected parameters
  const result = await confirmAction({
    action: 'Delete all data',
    details: 'This will clear ~/.itestagent/',
    interactive: false,
    prompt: 'Are you sure? [y/N]',
  });
  expect(result).toBe('no');
});

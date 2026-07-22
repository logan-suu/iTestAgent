/**
 * Tests for SystemAlertHandler — iOS system alert detection and dismissal.
 *
 * Task 3.12 AC2: system alert handling during DeviceBackend exploration.
 *
 * Covers all known alert patterns:
 *   - Permission dialogs (Allow / Don't Allow)
 *   - Confirmation dialogs (OK)
 *   - Chinese localized dialogs (允许 / 不允许)
 *   - Non-alert screen (no detection)
 */
import { expect, test } from 'bun:test';
import { SystemAlertHandler } from '../../src/exploration/system-alert-handler.js';
import {
  chineseAlertUiTree,
  loginScreenUiTree,
  okAlertUiTree,
  permissionAlertUiTree,
} from './fixtures/ui-trees.js';

// ─── Permission Alert (Allow / Don't Allow) ─────────────────────

test('permissionAlertUiTree: detectAndHandle returns detected=true, handled=true, action contains Allow', () => {
  const handler = new SystemAlertHandler();
  const result = handler.detectAndHandle(permissionAlertUiTree().raw);

  expect(result.detected).toBe(true);
  expect(result.handled).toBe(true);
  expect(result.action).toContain('Allow');
});

// ─── Simple OK Alert ────────────────────────────────────────────

test('okAlertUiTree: detectAndHandle returns detected=true, handled=true, action contains OK', () => {
  const handler = new SystemAlertHandler();
  const result = handler.detectAndHandle(okAlertUiTree().raw);

  expect(result.detected).toBe(true);
  expect(result.handled).toBe(true);
  expect(result.action).toContain('OK');
});

// ─── Chinese Localized Alert (允许 / 不允许) ─────────────────────

test('chineseAlertUiTree: detectAndHandle returns detected=true, handled=true, action contains 允许', () => {
  const handler = new SystemAlertHandler();
  const result = handler.detectAndHandle(chineseAlertUiTree().raw);

  expect(result.detected).toBe(true);
  expect(result.handled).toBe(true);
  expect(result.action).toContain('允许');
});

// ─── Login Screen (no alert) ────────────────────────────────────

test('loginScreenUiTree: detectAndHandle returns detected=false, handled=false', () => {
  const handler = new SystemAlertHandler();
  const result = handler.detectAndHandle(loginScreenUiTree().raw);

  expect(result.detected).toBe(false);
  expect(result.handled).toBe(false);
});

// ─── Dismiss Coordinates ────────────────────────────────────────

test('getDismissCoordinates on permissionAlertUiTree returns valid normalized coordinates', () => {
  const handler = new SystemAlertHandler();
  const coords = handler.getDismissCoordinates(permissionAlertUiTree().raw);

  expect(coords).not.toBeNull();
  expect(typeof coords?.x).toBe('number');
  expect(typeof coords?.y).toBe('number');
  // Normalized values must be in [0, 1] range
  expect(coords?.x).toBeGreaterThanOrEqual(0);
  expect(coords?.x).toBeLessThanOrEqual(1);
  expect(coords?.y).toBeGreaterThanOrEqual(0);
  expect(coords?.y).toBeLessThanOrEqual(1);
});

test('getDismissCoordinates on loginScreenUiTree returns null', () => {
  const handler = new SystemAlertHandler();
  const coords = handler.getDismissCoordinates(loginScreenUiTree().raw);

  expect(coords).toBeNull();
});

// ─── Alert Metadata Extraction ──────────────────────────────────

test('alert result contains extracted buttons array and alertText', () => {
  const handler = new SystemAlertHandler();
  const result = handler.detectAndHandle(permissionAlertUiTree().raw);

  // Buttons should list all available dismiss buttons from the alert
  expect(result.buttons).toBeDefined();
  expect(Array.isArray(result.buttons)).toBe(true);
  expect(result.buttons?.length).toBeGreaterThan(0);
  expect(result.buttons?.some((b) => b === 'Allow')).toBe(true);

  // alertText should contain the alert's label text
  expect(result.alertText).toBeDefined();
  expect(typeof result.alertText).toBe('string');
  expect(result.alertText?.length).toBeGreaterThan(0);
});

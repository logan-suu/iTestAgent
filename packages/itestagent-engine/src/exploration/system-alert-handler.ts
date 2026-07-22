/**
 * SystemAlertHandler — detects and dismisses iOS system dialogs.
 *
 * Task 3.12 AC2: system alert handling during DeviceBackend exploration.
 *
 * iOS system alerts (permission dialogs, error messages, etc.) block
 * the UI and prevent normal interaction. This module detects them in
 * the UI tree and returns tap coordinates to dismiss them.
 *
 * Known alert patterns:
 *   - Allow / Don't Allow  (permission dialogs)
 *   - OK / Cancel          (confirmation dialogs)
 *   - 允许 / 不允许         (Chinese localized)
 *   - Single OK / 好        (informational dialogs)
 */

import type { SystemAlertResult } from './types.js';

// ─── Alert Detection Patterns ───────────────────────────────────

/**
 * Check if the XML tree contains an XCUIElementTypeAlert element.
 */
function hasAlertElement(xml: string): boolean {
  return xml.includes('<XCUIElementTypeAlert');
}

/**
 * Find the first button in the alert that matches any label in the allow list.
 * Returns the button's label and normalized tap coordinates.
 */
function findAlertButton(
  xml: string,
  labels: string[],
): { label: string; x: number; y: number } | null {
  // Find all buttons inside the alert
  const alertMatch = xml.match(/<XCUIElementTypeAlert[\s\S]*?<\/XCUIElementTypeAlert>/);
  if (!alertMatch) return null;

  const alertBlock = alertMatch[0];

  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const buttonRegex = new RegExp(
      `<XCUIElementType(?:Button|Cell)[^>]*\\sname="[^"]*"[^>]*\\slabel="${escaped}"[^>]*\\sx="(\\d+)"\\sy="(\\d+)"\\swidth="(\\d+)"\\sheight="(\\d+)"`,
      'i',
    );
    const match = buttonRegex.exec(alertBlock);
    if (match) {
      const m1 = match[1];
      const m2 = match[2];
      const m3 = match[3];
      const m4 = match[4];
      if (!m1 || !m2 || !m3 || !m4) continue;
      const btnX = Number.parseInt(m1, 10);
      const btnY = Number.parseInt(m2, 10);
      const btnW = Number.parseInt(m3, 10);
      const btnH = Number.parseInt(m4, 10);
      // Parse screen dimensions from the application element
      const appMatch = xml.match(/<XCUIElementTypeApplication[^>]*\swidth="(\d+)"\sheight="(\d+)"/);
      const am1 = appMatch?.[1];
      const am2 = appMatch?.[2];
      const screenW = am1 ? Number.parseInt(am1, 10) : 390;
      const screenH = am2 ? Number.parseInt(am2, 10) : 844;

      return {
        label,
        x: (btnX + btnW / 2) / screenW,
        y: (btnY + btnH / 2) / screenH,
      };
    }
  }

  return null;
}

/**
 * Extract all button labels from the alert block for reporting.
 */
function extractAlertButtons(xml: string): string[] {
  const alertMatch = xml.match(/<XCUIElementTypeAlert[\s\S]*?<\/XCUIElementTypeAlert>/);
  if (!alertMatch) return [];

  const buttons: string[] = [];
  const buttonRegex = /<XCUIElementType(?:Button|Cell)[^>]*\slabel="([^"]*)"[^>]*>/g;
  const alertText = alertMatch[0];
  if (!alertText) return [];
  let match = buttonRegex.exec(alertText);
  while (match !== null) {
    const btnLabel = match[1];
    if (btnLabel) buttons.push(btnLabel);
    match = buttonRegex.exec(alertText);
  }
  return buttons;
}

/**
 * Extract alert title/description text.
 */
function extractAlertText(xml: string): string | undefined {
  const alertMatch = xml.match(/<XCUIElementTypeAlert[^>]*\slabel="([^"]*)"[^>]*>/);
  return alertMatch?.[1]?.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

// ─── Dismiss Button Priority ────────────────────────────────────

/**
 * Ordered list of dismiss button labels to try.
 * Priority: Allow/OK first (we want to proceed past the alert).
 */
const DISMISS_BUTTONS: string[][] = [
  ['Allow', '允许'], // Permission: prefer granting
  ['OK', '好'], // Confirmation: dismiss
  ["Don't Allow", '不允许'], // Permission: deny as last resort
  ['Cancel', '取消'], // Confirmation: cancel as last resort
];

// ─── SystemAlertHandler ─────────────────────────────────────────

/**
 * SystemAlertHandler — detects and handles iOS system dialogs.
 *
 * During DeviceBackend exploration, system alerts (permission dialogs,
 * error messages) can block the UI. This handler detects these alerts
 * in the UI tree and returns tap coordinates to dismiss them.
 *
 * Usage:
 *   const handler = new SystemAlertHandler();
 *   const result = handler.detectAndHandle(uiTreeXml);
 *   if (result.detected && result.handled) {
 *     // Tap at (result.tapX, result.tapY) to dismiss
 *   }
 */
export class SystemAlertHandler {
  /**
   * Detect and handle a system alert in the UI tree.
   *
   * @param uiTreeXml - Raw XML from DeviceBackend.getUiTree()
   * @returns SystemAlertResult with detection status and dismiss action
   */
  detectAndHandle(uiTreeXml: string): SystemAlertResult {
    if (!hasAlertElement(uiTreeXml)) {
      return { detected: false, handled: false };
    }

    const buttons = extractAlertButtons(uiTreeXml);
    const alertText = extractAlertText(uiTreeXml);

    // Try each set of dismiss buttons in priority order
    for (const buttonSet of DISMISS_BUTTONS) {
      const button = findAlertButton(uiTreeXml, buttonSet);
      if (button) {
        return {
          detected: true,
          handled: true,
          action: `tap "${button.label}" at (${button.x.toFixed(3)}, ${button.y.toFixed(3)})`,
          alertText,
          buttons,
        };
      }
    }

    // Alert detected but no known dismiss button found
    return {
      detected: true,
      handled: false,
      action: 'no known dismiss button found',
      alertText,
      buttons,
    };
  }

  /**
   * Get the tap coordinates to dismiss a detected alert.
   * Must call detectAndHandle() first.
   *
   * @param uiTreeXml - Raw XML from DeviceBackend.getUiTree()
   * @returns Tap coordinates { x, y } or null if no alert or no button found
   */
  getDismissCoordinates(uiTreeXml: string): { x: number; y: number } | null {
    for (const buttonSet of DISMISS_BUTTONS) {
      const button = findAlertButton(uiTreeXml, buttonSet);
      if (button) {
        return { x: button.x, y: button.y };
      }
    }
    return null;
  }
}

/**
 * ElementLocator — finds UI elements in iOS accessibility tree XML.
 *
 * Task 3.12 AC4: 5-level degradation strategy.
 * When element location is unstable, degradation is explicitly annotated
 * rather than pretending success (R5: no silent degradation).
 *
 * Strategy priority (highest confidence first):
 *   1. accessibility_id — exact match on element name attribute
 *   2. label            — exact match on element label attribute
 *   3. label_contains   — case-insensitive substring match
 *   4. xpath            — XPath query on XML tree
 *   5. coordinate       — fixed coordinate fallback (lowest confidence)
 */

import type { LocatorConfidence, LocatorResult, LocatorStrategy } from './types.js';

// ─── XML Parsing Helpers ────────────────────────────────────────

/** Parsed element from XML tree for matching. */
interface ParsedElement {
  name: string;
  label: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  enabled: boolean;
}

/** Screen dimensions for coordinate normalization. */
interface ScreenDimensions {
  width: number;
  height: number;
}

/**
 * Parse screen dimensions from the root XCUIElementTypeApplication element.
 * Falls back to iPhone 14 Pro dimensions (390×844) if not found.
 */
function parseScreenDimensions(xml: string): ScreenDimensions {
  const appMatch = xml.match(
    /<XCUIElementTypeApplication[^>]*\sx="(\d+)"\sy="(\d+)"\swidth="(\d+)"\sheight="(\d+)"/,
  );
  if (appMatch) {
    const w = appMatch[3];
    const h = appMatch[4];
    if (w && h) {
      return {
        width: Number.parseInt(w, 10),
        height: Number.parseInt(h, 10),
      };
    }
  }
  // Fallback: iPhone 14 Pro logical points (R5: explicit approximation)
  return { width: 390, height: 844 };
}

/**
 * Parse all leaf-level elements from the XML tree.
 * Only returns elements that are visible and have meaningful names/labels.
 */
function parseElements(xml: string): ParsedElement[] {
  const dims = parseScreenDimensions(xml);
  const elements: ParsedElement[] = [];

  // Match all XCUIElementType* elements with frame attributes
  const regex =
    /<XCUIElementType(\w+)[^>]*\sname="([^"]*)"(?:\s[^>]*)?\slabel="([^"]*)"(?:\s[^>]*)?\senabled="(\w+)"(?:\s[^>]*)?\svisible="(\w+)"[^>]*\sx="(\d+)"\sy="(\d+)"\swidth="(\d+)"\sheight="(\d+)"/g;

  let match = regex.exec(xml);
  while (match !== null) {
    const [, type, name, label, enabledStr, visibleStr, x, y, w, h] = match;
    if (!x || !y || !w || !h || !name || !label || !type) {
      match = regex.exec(xml);
      continue;
    }
    const enabled = enabledStr === 'true';
    const visible = visibleStr === 'true';

    // Skip non-visible or container-only elements
    if (!visible) {
      match = regex.exec(xml);
      continue;
    }

    const elX = Number.parseInt(x, 10);
    const elY = Number.parseInt(y, 10);
    const elW = Number.parseInt(w, 10);
    const elH = Number.parseInt(h, 10);

    // Skip full-screen wrappers (these are containers, not interactable leaves)
    if (elX === 0 && elY === 0 && elW === dims.width && elH === dims.height) {
      match = regex.exec(xml);
      continue;
    }

    elements.push({
      name,
      label,
      type,
      x: elX / dims.width,
      y: elY / dims.height,
      width: elW / dims.width,
      height: elH / dims.height,
      enabled: enabled && visible,
    });

    match = regex.exec(xml);
  }

  return elements;
}

// ─── Locator Strategies ─────────────────────────────────────────

/**
 * Try exact match on element `name` attribute (accessibilityIdentifier).
 * Confidence: high.
 */
function tryAccessibilityId(elements: ParsedElement[], target: string): LocatorResult | null {
  const match = elements.find((el) => el.name === target);
  if (!match) return null;

  return {
    found: true,
    strategy: 'accessibility_id',
    confidence: 'high',
    attemptedStrategies: ['accessibility_id'],
    element: {
      name: match.name,
      type: match.type,
      x: match.x + match.width / 2,
      y: match.y + match.height / 2,
      width: match.width,
      height: match.height,
      enabled: match.enabled,
    },
  };
}

/**
 * Try exact match on element `label` attribute (accessibilityLabel).
 * Confidence: high.
 */
function tryLabel(elements: ParsedElement[], target: string): LocatorResult | null {
  const match = elements.find((el) => el.label === target);
  if (!match) return null;

  return {
    found: true,
    strategy: 'label',
    confidence: 'high',
    attemptedStrategies: ['accessibility_id', 'label'],
    element: {
      name: match.name,
      type: match.type,
      x: match.x + match.width / 2,
      y: match.y + match.height / 2,
      width: match.width,
      height: match.height,
      enabled: match.enabled,
    },
  };
}

/**
 * Try case-insensitive substring match on element label.
 * Confidence: medium. Degradation if multiple candidates.
 */
function tryLabelContains(elements: ParsedElement[], target: string): LocatorResult | null {
  const targetLower = target.toLowerCase();
  const matches = elements.filter((el) => el.label.toLowerCase().includes(targetLower));
  if (matches.length === 0) return null;

  const match = matches[0];
  if (!match) return null;
  const result: LocatorResult = {
    found: true,
    strategy: 'label_contains',
    confidence: matches.length === 1 ? 'medium' : 'medium',
    attemptedStrategies: ['accessibility_id', 'label', 'label_contains'],
    element: {
      name: match.name,
      type: match.type,
      x: match.x + match.width / 2,
      y: match.y + match.height / 2,
      width: match.width,
      height: match.height,
      enabled: match.enabled,
    },
  };

  if (matches.length > 1) {
    result.degradation =
      `label_contains found ${matches.length} candidates for "${target}" — ` +
      `using first match "${match.label}" (name=${match.name}). AC4: multi-match ambiguity.`;
  }

  return result;
}

/**
 * Try XPath query on the XML tree.
 * Confidence: low. XPath is fragile and depends on XML structure.
 */
function tryXpath(xml: string, target: string): LocatorResult | null {
  // Simple XPath: //XCUIElementType*[contains(@label, "target") or contains(@name, "target")]
  const escaped = target.replace(/"/g, '&quot;');
  const xpathRegex = new RegExp(
    `<XCUIElementType\\w+[^>]*\\s(?:name|label)="[^"]*${escaped.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&',
    )}[^"]*"[^>]*\\sx="(\\d+)"\\sy="(\\d+)"\\swidth="(\\d+)"\\sheight="(\\d+)"[^>]*>`,
    'i',
  );

  const match = xpathRegex.exec(xml);
  if (!match) return null;

  const m1 = match[1];
  const m2 = match[2];
  const m3 = match[3];
  const m4 = match[4];
  if (!m1 || !m2 || !m3 || !m4) return null;
  const elX = Number.parseInt(m1, 10);
  const elY = Number.parseInt(m2, 10);
  const elW = Number.parseInt(m3, 10);
  const elH = Number.parseInt(m4, 10);
  const dims = parseScreenDimensions(xml);

  return {
    found: true,
    strategy: 'xpath',
    confidence: 'low',
    degradation: `xpath fallback for "${target}" — element matched via regex pattern. XPath-based location is fragile and may break with UI changes.`,
    attemptedStrategies: ['accessibility_id', 'label', 'label_contains', 'xpath'],
    element: {
      name: target,
      type: 'unknown',
      x: elX / dims.width + elW / dims.width / 2,
      y: elY / dims.height + elH / dims.height / 2,
      width: elW / dims.width,
      height: elH / dims.height,
      enabled: true,
    },
  };
}

// ─── Coordinate Fallback ────────────────────────────────────────

/**
 * Coordinate-based fallback when no element matches.
 * Confidence: low. Degradation is explicitly annotated per AC4.
 */
function coordinateFallback(): LocatorResult {
  return {
    found: true,
    strategy: 'coordinate',
    confidence: 'low',
    degradation:
      'coordinate-only fallback — element was not identified in the UI tree. ' +
      'Using screen center (0.5, 0.5) as best-guess tap target. ' +
      'This is explicitly degraded per AC4.',
    attemptedStrategies: ['accessibility_id', 'label', 'label_contains', 'xpath', 'coordinate'],
    element: {
      name: 'unknown',
      type: 'unknown',
      x: 0.5,
      y: 0.5,
      width: 0.1,
      height: 0.1,
      enabled: true,
    },
  };
}

// ─── Not Found Result ───────────────────────────────────────────

/**
 * Build a "not found" result with full degradation trail.
 */
function notFoundResult(target: string, attempted: LocatorStrategy[]): LocatorResult {
  return {
    found: false,
    strategy: attempted[attempted.length - 1] ?? 'coordinate',
    confidence: 'low',
    degradation: `Element "${target}" not found after trying: ${attempted.join(', ')}. No matching element in UI tree. AC4: explicitly reporting as not found.`,
    attemptedStrategies: attempted,
  };
}

// ─── ElementLocator ─────────────────────────────────────────────

/**
 * ElementLocator — finds UI elements in iOS accessibility tree XML.
 *
 * Applies a 5-level degradation strategy:
 *   1. accessibility_id (high confidence)
 *   2. label (high confidence)
 *   3. label_contains (medium confidence)
 *   4. xpath (low confidence)
 *   5. coordinate fallback (low confidence)
 *
 * AC4 compliant: when confidence is medium/low or not found, degradation
 * is explicitly annotated rather than pretending success.
 */
export class ElementLocator {
  /**
   * Locate an element in the given UI tree XML by target description.
   *
   * @param uiTreeXml - Raw XML from DeviceBackend.getUiTree()
   * @param target - Human-readable target (e.g., "Login", "username_field", "Settings")
   * @param useCoordinateFallback - Whether to use coordinate fallback as last resort (default: true)
   * @returns LocatorResult with found status, confidence, and degradation info
   */
  locate(uiTreeXml: string, target: string, useCoordinateFallback = true): LocatorResult {
    const elements = parseElements(uiTreeXml);

    if (elements.length === 0) {
      return {
        found: false,
        strategy: 'coordinate',
        confidence: 'low',
        degradation: `UI tree is empty or unparseable — cannot locate "${target}". AC4: no elements found in accessibility tree.`,
        attemptedStrategies: [],
      };
    }

    // Level 1: accessibility_id
    const idResult = tryAccessibilityId(elements, target);
    if (idResult) return idResult;

    // Level 2: label
    const labelResult = tryLabel(elements, target);
    if (labelResult) return labelResult;

    // Level 3: label_contains
    const containsResult = tryLabelContains(elements, target);
    if (containsResult) return containsResult;

    // Level 4: xpath
    const xpathResult = tryXpath(uiTreeXml, target);
    if (xpathResult) return xpathResult;

    // Level 5: coordinate fallback
    if (useCoordinateFallback) {
      return coordinateFallback();
    }

    // Not found
    return notFoundResult(target, ['accessibility_id', 'label', 'label_contains', 'xpath']);
  }
}

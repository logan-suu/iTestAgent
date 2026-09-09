/**
 * Locator resolution — B08 module split (promotion guide §11.3 "Flow
 * replay/redaction"). Moved verbatim from the former replay.ts monolith.
 *
 * Architecture §6.7: "归一化元素定位，不保存 Appium-specific locator".
 * Coordinate locators resolve directly; label/identifier/xpath strategies
 * search the UiTree XML snapshot.
 */
import type { DeviceBackend, UiTreeSnapshot } from 'itestagent-contracts';
import type { LocatorV2 } from './schema.js';

/** Parsed coordinate from locator value (e.g., "0.5,0.3" → {x:0.5, y:0.3}). */
export interface ParsedCoordinate {
  x: number;
  y: number;
}

/**
 * Parse a coordinate locator value like "0.5,0.3" into { x, y }.
 * Returns null if parsing fails.
 */
export function parseCoordinate(value: string): ParsedCoordinate | null {
  // Support formats: "0.5,0.3", "x:0.5,y:0.3", "{0.5,0.3}", "{x:0.5,y:0.3}"
  const cleaned = value.trim().replace(/[{}\s]/g, '');
  const parts = cleaned.split(/[,;]/);
  if (parts.length !== 2) return null;

  // Extract numeric values, skipping prefix labels like "x:" or "y:"
  const nums: number[] = [];
  for (const part of parts) {
    const match = part.match(/[+-]?\d*\.?\d+/);
    if (!match) return null;
    const n = Number.parseFloat(match[0]);
    if (Number.isNaN(n)) return null;
    nums.push(n);
  }

  if (nums.length !== 2) return null;
  const x = nums[0];
  const y = nums[1];
  if (x === undefined || y === undefined) return null;

  return { x, y };
}

/**
 * Result from finding an element in the UiTree XML.
 * Includes position and text attributes for assertions.
 */
export interface UiTreeElement {
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  label: string;
  value: string;
}

/**
 * Search a UiTree XML string for an element matching a locator.
 *
 * Strategies:
 *   - label: matches name="..." or label="..." attribute
 *   - identifier: matches name="..." or accessibility-id="..." attribute
 *   - xpath: simple path matching (element type + attribute)
 *
 * Returns the element with position and text attributes, or null if not found.
 */
export function findElementInUiTree(xml: string, locator: LocatorV2): UiTreeElement | null {
  if (locator.strategy === 'coordinate') {
    const coord = parseCoordinate(locator.value);
    if (!coord) return null;
    // Coordinates from coordinate strategy are normalized [0,1], not from UiTree
    // Callers should use parseCoordinate directly, not this function.
    return null;
  }

  const escapedValue = locator.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  let pattern: RegExp;
  switch (locator.strategy) {
    case 'label':
      // Match name="VALUE" or label="VALUE" case-insensitively
      pattern = new RegExp(`<(\\w+)[^>]*\\b(?:name|label)="(${escapedValue})"[^>]*>`, 'i');
      break;
    case 'identifier':
      pattern = new RegExp(
        `<(\\w+)[^>]*\\b(?:name|accessibility-id)="(${escapedValue})"[^>]*>`,
        'i',
      );
      break;
    case 'xpath': {
      // Simple xpath: //ElementType[@attr="value"] → match element type + attr
      const xpathMatch = locator.value.match(/\/\/(\w+)(?:\[@(\w+)="([^"]+)"\])?/);
      if (!xpathMatch) return null;
      const elementType = xpathMatch[1] ?? '';
      const attrName = xpathMatch[2];
      const attrValue = xpathMatch[3];
      if (attrName && attrValue) {
        pattern = new RegExp(
          `<${elementType}[^>]*\\b${attrName}="${attrValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`,
          'i',
        );
      } else {
        pattern = new RegExp(`<${elementType}[^>]*>`, 'i');
      }
      break;
    }
    case 'image':
      return null; // Image-based locator not supported in replay
    default:
      return null;
  }

  const match = xml.match(pattern);
  if (!match) return null;

  const elementStr = match[0];
  if (!elementStr) return null;
  const xStr = elementStr.match(/\bx="([^"]*)"/)?.[1];
  const yStr = elementStr.match(/\by="([^"]*)"/)?.[1];
  const wStr = elementStr.match(/\bwidth="([^"]*)"/)?.[1];
  const hStr = elementStr.match(/\bheight="([^"]*)"/)?.[1];

  if (!xStr || !yStr || !wStr || !hStr) return null;

  const x = Number.parseFloat(xStr);
  const y = Number.parseFloat(yStr);
  const width = Number.parseFloat(wStr);
  const height = Number.parseFloat(hStr);

  if ([x, y, width, height].some((v) => Number.isNaN(v))) return null;

  // Extract text attributes for assertion support
  const name = elementStr.match(/\bname="([^"]*)"/)?.[1] ?? '';
  const label = elementStr.match(/\blabel="([^"]*)"/)?.[1] ?? '';
  const value = elementStr.match(/\bvalue="([^"]*)"/)?.[1] ?? '';

  return { x, y, width, height, name, label, value };
}

/**
 * Resolve a FlowStepV2 locator to tap coordinates (normalized [0,1]).
 *
 * For 'coordinate' strategy: parse directly from locator value.
 * For 'label'/'identifier'/'xpath' strategies: search UiTree XML.
 *
 * Returns coordinates {x, y} or null if resolution fails.
 * Requires measured application bounds in the same coordinate space as the element.
 */
export async function resolveTapCoordinates(
  locator: LocatorV2,
  backend: DeviceBackend,
  deviceId: string,
  signal?: AbortSignal,
): Promise<ParsedCoordinate | null> {
  if (locator.strategy === 'coordinate') {
    return parseCoordinate(locator.value);
  }

  // For non-coordinate strategies, we need the UiTree
  let uiTree: UiTreeSnapshot;
  try {
    uiTree = await backend.getUiTree({ deviceId }, signal);
  } catch {
    return null;
  }

  const element = findElementInUiTree(uiTree.raw, locator);
  if (!element) return null;

  // Appium's application bounds and element bounds share the same UI coordinate space.
  // Missing or ambiguous viewport evidence must block instead of guessing a device model.
  const applications = [...uiTree.raw.matchAll(/<XCUIElementTypeApplication\b[^>]*>/g)];
  if (applications.length !== 1) return null;
  const application = applications[0]?.[0] ?? '';
  const attribute = (name: string): number => {
    const raw = application.match(new RegExp(`\\b${name}="([^"\\s]+)"`))?.[1];
    return raw === undefined ? Number.NaN : Number(raw);
  };
  const screenWidth = attribute('width');
  const screenHeight = attribute('height');
  if (
    attribute('x') !== 0 ||
    attribute('y') !== 0 ||
    !Number.isFinite(screenWidth) ||
    !Number.isFinite(screenHeight) ||
    screenWidth <= 0 ||
    screenHeight <= 0 ||
    ![element.x, element.y, element.width, element.height].every(Number.isFinite) ||
    element.width <= 0 ||
    element.height <= 0
  )
    return null;

  const centerX = (element.x + element.width / 2) / screenWidth;
  const centerY = (element.y + element.height / 2) / screenHeight;
  if (centerX < 0 || centerX > 1 || centerY < 0 || centerY > 1) return null;
  return { x: centerX, y: centerY };
}

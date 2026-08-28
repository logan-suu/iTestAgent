/**
 * Replay action utilities — B08 module split (promotion guide §11.3 "Flow
 * replay/redaction"). Moved verbatim from the former replay.ts monolith.
 */
import type { UiTreeElement } from './replay-locator.js';

/**
 * Convert a swipe direction to normalized from/to coordinates.
 */
export function directionToSwipePoints(direction: string): {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
} {
  switch (direction) {
    case 'up':
      return { fromX: 0.5, fromY: 0.7, toX: 0.5, toY: 0.3 };
    case 'down':
      return { fromX: 0.5, fromY: 0.3, toX: 0.5, toY: 0.7 };
    case 'left':
      return { fromX: 0.7, fromY: 0.5, toX: 0.3, toY: 0.5 };
    case 'right':
      return { fromX: 0.3, fromY: 0.5, toX: 0.7, toY: 0.5 };
    default:
      return { fromX: 0.5, fromY: 0.7, toX: 0.5, toY: 0.3 };
  }
}

/**
 * Normalize a button name to the PressButtonInput enum values.
 */
export function normalizePressButton(button: string): 'home' | 'back' | 'volumeUp' | 'volumeDown' {
  const normalized = button.toLowerCase().trim();
  const map: Record<string, 'home' | 'back' | 'volumeUp' | 'volumeDown'> = {
    home: 'home',
    back: 'back',
    'volume up': 'volumeUp',
    volumeup: 'volumeUp',
    'volume+': 'volumeUp',
    'volume down': 'volumeDown',
    volumedown: 'volumeDown',
    'volume-': 'volumeDown',
  };
  return map[normalized] ?? 'home';
}

/**
 * Extract visible text from a matched element in the UiTree XML.
 * Checks name, label, and value attributes.
 */
export function extractElementText(element: UiTreeElement, _xml: string): string {
  return element.label || element.name || element.value || '';
}

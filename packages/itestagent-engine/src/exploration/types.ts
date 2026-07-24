/**
 * Exploration types — lightweight types for DeviceBackend exploration.
 *
 * Task 3.12: DeviceBackend exploration execution.
 * US-8.1: RunStep recording + UI actions via pluggable DeviceBackend interface.
 *
 * These are plain TypeScript types (not Zod schemas) to keep exploration
 * internals lightweight. RunStep itself is validated via itestagent-contracts
 * Zod schema when serialized.
 */

// ─── Locator Strategy ──────────────────────────────────────────

/**
 * Priority-ordered element location strategies.
 * Level 1 (highest confidence) → Level 5 (lowest, coordinate fallback).
 *
 * AC4: When element location is unstable, degradation is explicitly annotated
 * rather than pretending success.
 */
export type LocatorStrategy =
  | 'accessibility_id' // exact match on accessibilityIdentifier / name attribute
  | 'label' // exact match on accessibilityLabel / name attribute
  | 'label_contains' // case-insensitive substring match
  | 'xpath' // XPath query on the XML tree
  | 'coordinate'; // fixed coordinate fallback (low confidence)

/** Confidence level for a locator result. */
export type LocatorConfidence = 'high' | 'medium' | 'low';

// ─── Locator Result ────────────────────────────────────────────

/**
 * Result of attempting to locate a UI element in the accessibility tree.
 *
 * AC4 compliance: when confidence is 'low' or found is false, `degradation`
 * MUST provide a human-readable explanation of why and what was attempted.
 */
export interface LocatorResult {
  /** Whether the element was found */
  found: boolean;
  /** The strategy that successfully matched (or was attempted last) */
  strategy: LocatorStrategy;
  /** Confidence of the match */
  confidence: LocatorConfidence;
  /** Degradation explanation (required when confidence !== 'high' or !found, per AC4) */
  degradation?: string;
  /** All strategies attempted (for audit trail) */
  attemptedStrategies: LocatorStrategy[];
  /** Element attributes (populated when found) */
  element?: {
    /** Element name (accessibilityIdentifier / accessibilityLabel) */
    name: string;
    /** Element type (XCUIElementType*) */
    type: string;
    /** Normalized x coordinate [0,1] for tap target */
    x: number;
    /** Normalized y coordinate [0,1] for tap target */
    y: number;
    /** Element width as fraction of screen width */
    width: number;
    /** Element height as fraction of screen height */
    height: number;
    /** Whether this element is enabled/interactable */
    enabled: boolean;
  };
}

// ─── Exploration Action ────────────────────────────────────────

/**
 * A single exploration action to execute on the device.
 *
 * Derived from TestPlan.execution.features — each feature maps to
 * one or more exploration actions targeting specific UI elements.
 */
export interface ExplorationAction {
  /** Action type */
  action: 'tap' | 'swipe' | 'input' | 'screenshot' | 'wait' | 'launch';
  /** Human-readable target description for RunStep recording */
  target: string;
  /** Input text (for 'input' action) */
  text?: string;
  /** Swipe direction (for 'swipe' action) */
  direction?: 'up' | 'down' | 'left' | 'right';
  /** Wait duration in ms (for 'wait' action) */
  waitMs?: number;
  /** Bundle ID to launch (for 'launch' action) */
  bundleId?: string;
}

// ─── System Alert Result ───────────────────────────────────────

/**
 * Result of system alert detection and handling.
 */
export interface SystemAlertResult {
  /** Whether a system alert was detected */
  detected: boolean;
  /** Whether the alert was successfully handled (dismissed) */
  handled: boolean;
  /** The action taken to dismiss the alert */
  action?: string;
  /** Alert title or description text */
  alertText?: string;
  /** Alert buttons identified */
  buttons?: string[];
}

// ─── Exploration Options ───────────────────────────────────────

/**
 * Options passed to DeviceExplorer.
 */
export interface ExplorationOptions {
  /** Device UDID for the target device */
  deviceId: string;
  /** App bundle ID to test */
  bundleId: string;
  /** Target kind (physical or simulator) per ADR-011 */
  targetKind: 'physical' | 'simulator';
  /** Backend name to record in RunStep metadata (e.g. 'appium', 'mock') */
  backendName?: string;
  /** Milliseconds to wait after each action for UI to settle */
  settleMs?: number;
  /** Maximum retries for element location before falling back to degradation */
  maxLocatorRetries?: number;
}

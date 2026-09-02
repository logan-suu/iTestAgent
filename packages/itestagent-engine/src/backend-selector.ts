import type { BackendCapabilities, DeviceBackend, TargetKind } from 'itestagent-contracts';

// ─── BackendPreferences ───────────────────────────────────────

/**
 * Per-targetKind backend preference ordering (ADR-011 §16.4).
 *
 * The first available backend in the preference list is auto-picked.
 * Backends not listed are appended after the preference list in registry order.
 */
export interface BackendPreferences {
  device: {
    /** Preference order for physical (real iPhone) target kind. */
    physical: string[];
    /** Preference order for simulator (iOS Simulator) target kind. */
    simulator: string[];
  };
  /**
   * Whether to allow falling back from a physical backend to a simulator backend
   * (or vice versa) when the target kind has no matching backends.
   * Defaults to false — cross-target fallback requires explicit user consent.
   */
  allowCrossTargetFallback: boolean;
}

export const DEFAULT_PREFERENCES: BackendPreferences = {
  device: {
    physical: ['appium', 'mobile-mcp', 'mock'],
    simulator: ['appium', 'mock'],
  },
  allowCrossTargetFallback: false,
};

// ─── SelectResult ─────────────────────────────────────────────

/**
 * Result of the full backend selection pipeline.
 *
 * On success: success=true, backend=selected DeviceBackend, fallbackChain=chain tried.
 * On failure: success=false, error/errorCode explain why.
 */
export interface SelectResult {
  success: boolean;
  backend?: DeviceBackend;
  /** Human-readable error message (failure only). */
  error?: string;
  /** AgentErrorCode value (failure only). */
  errorCode?: string;
  /**
   * Ordered list of backend names that were considered during selection.
   * Includes the preferred backend even if it didn't match capabilities,
   * followed by auto-pick candidates in preference order.
   */
  fallbackChain?: string[];
  /**
   * True when the healthcheck step is not yet implemented.
   * Indicates the backend was selected without a live healthcheck.
   */
  healthcheckNotImplemented?: boolean;
  /** Actionable remediation for blocked/infra failures. */
  remediation?: string[];
  /** Canonical capabilities that no candidate could satisfy. */
  missingCapabilities?: string[];
}

export const CANONICAL_DEVICE_CAPABILITIES = new Set([
  'appLifecycle',
  'uiTree',
  'screenshot',
  'coordinateTap',
  'swipe',
  'textInput',
  'pressButton',
  'openUrl',
  'video',
  'logs',
  'crashLogs',
  'visualScreenshot',
  'visualTap',
  'location',
  'push',
]);

const FEATURE_ALIASES: Record<string, string> = {
  launch: 'appLifecycle',
  applifecycle: 'appLifecycle',
  uitree: 'uiTree',
  screenshot: 'screenshot',
  tap: 'coordinateTap',
  coordinatetap: 'coordinateTap',
  swipe: 'swipe',
  text: 'textInput',
  textinput: 'textInput',
  button: 'pressButton',
  pressbutton: 'pressButton',
  url: 'openUrl',
  openurl: 'openUrl',
  recording: 'video',
  video: 'video',
  log: 'logs',
  logs: 'logs',
  crash: 'crashLogs',
  crashlogs: 'crashLogs',
  visualscreenshot: 'visualScreenshot',
  visualtap: 'visualTap',
  location: 'location',
  push: 'push',
};

/** Normalize legacy backend feature names and boolean capability flags. */
export function normalizeBackendCapabilities(capabilities: BackendCapabilities): Set<string> {
  const normalized = new Set<string>();
  for (const feature of capabilities.features) {
    const canonical = FEATURE_ALIASES[feature.replace(/[-_\s]/g, '').toLowerCase()];
    if (canonical) normalized.add(canonical);
  }
  if (capabilities.supportsUiTree) normalized.add('uiTree');
  if (capabilities.supportsScreenshot) normalized.add('screenshot');
  if (capabilities.supportsVideo) normalized.add('video');
  if (capabilities.supportsCrashLogs) normalized.add('crashLogs');
  if (capabilities.supportsLocation) normalized.add('location');
  if (capabilities.supportsPush) normalized.add('push');
  return normalized;
}

// ─── BackendRegistry ──────────────────────────────────────────

/**
 * Registry that holds all registered DeviceBackend implementations.
 *
 * Engine populates this at startup from backend discovery / configuration.
 * BackendSelector reads from it during the selection pipeline.
 */
export class BackendRegistry {
  private backends: Map<string, DeviceBackend> = new Map();

  /** Register a backend by name. Overwrites if already registered. */
  register(name: string, backend: DeviceBackend): void {
    this.backends.set(name, backend);
  }

  /** Look up a backend by name. Returns undefined if not registered. */
  get(name: string): DeviceBackend | undefined {
    return this.backends.get(name);
  }

  /** Return all registered backends in insertion order. */
  list(): DeviceBackend[] {
    return [...this.backends.values()];
  }

  /** Check whether a backend with the given name is registered. */
  has(name: string): boolean {
    return this.backends.has(name);
  }
}

// ─── BackendSelector ──────────────────────────────────────────

/**
 * Backend selection engine implementing the 8 selection rules from the
 * iTestAgent Architecture Document (backend selection strategy, ADR-010 Harness boundary).
 *
 * Rules:
 *   1. Filter by BackendCapabilities.supportedTargetKinds.
 *   2. User explicit backend → use it (if registered + capability match).
 *   3. Auto-pick by per-targetKind preference order (DEFAULT_PREFERENCES).
 *   4. Healthcheck gating uses the selected device and tries same-target candidates in order.
 *   5. Same-targetKind fallback tracked via fallbackChain.
 *   6. Cross-targetKind fallback → blocked.cross_target_fallback (default denied).
 *   7. Unknown backend name → blocked.setup error.
 *   8. No silent fallback to Appium — only via normal preference chain.
 */
export class BackendSelector {
  constructor(
    private registry: BackendRegistry,
    private preferences: Partial<BackendPreferences> = {},
  ) {}

  // ── full selection pipeline ──────────────────────────────

  /**
   * Run the full selection pipeline and return a SelectResult.
   *
   * @param targetKind  The execution target kind (physical | simulator).
   * @param preferredBackend  Optional user-specified backend name.
   * @param _deviceId  Reserved for future healthcheck integration (Phase 3.3/3.5).
   */
  select(targetKind: TargetKind, preferredBackend?: string, _deviceId?: string): SelectResult {
    // Step 0 — resolve effective preferences
    const prefs = this.resolvePreferences();

    // Step 1 — explicit preferred backend: must be registered
    if (preferredBackend !== undefined) {
      if (!this.registry.has(preferredBackend)) {
        return {
          success: false,
          error: `Backend not registered: ${preferredBackend}`,
          errorCode: 'blocked.setup',
        };
      }

      // Step 2 — filter by targetKind
      const filtered = this.filterByTargetKind(targetKind);

      // Step 3 — apply preference: is the preferred backend in the filtered list?
      const match = this.applyPreference(filtered, preferredBackend);

      if (match !== null) {
        // Preferred backend found AND supports the target → use it
        return {
          success: true,
          backend: match,
          healthcheckNotImplemented: true,
        };
      }

      // Preferred backend exists but does NOT support this targetKind.
      // Fallback: auto-pick from remaining candidates.
      const candidates = this.autoPick(filtered, targetKind, prefs);

      if (candidates.length === 0) {
        // Cross-target fallback: try other targetKind if allowed
        if (prefs.allowCrossTargetFallback) {
          const otherKind = targetKind === 'physical' ? 'simulator' : ('physical' as TargetKind);
          const fallbackCandidates = this.autoPick(
            this.filterByTargetKind(otherKind),
            otherKind,
            prefs,
          );
          if (fallbackCandidates.length > 0) {
            const fb = fallbackCandidates[0];
            if (fb) {
              return {
                success: true,
                backend: fb,
                fallbackChain: [preferredBackend, ...fallbackCandidates.map((b) => b.name)],
                healthcheckNotImplemented: true,
              };
            }
          }
        }

        return {
          success: false,
          error: `No backend supports targetKind: ${targetKind}`,
          errorCode: 'blocked.target_unsupported',
          fallbackChain: [preferredBackend],
        };
      }

      const picked = candidates[0];
      if (picked) {
        return {
          success: true,
          backend: picked,
          fallbackChain: [preferredBackend, ...candidates.map((b) => b.name)],
          healthcheckNotImplemented: true,
        };
      }
    }

    // No explicit preferred backend — filter + auto-pick
    const filtered = this.filterByTargetKind(targetKind);

    if (filtered.length === 0) {
      // Cross-target fallback: try other targetKind if allowed
      if (prefs.allowCrossTargetFallback) {
        const otherKind = targetKind === 'physical' ? 'simulator' : ('physical' as TargetKind);
        const fallbackFiltered = this.filterByTargetKind(otherKind);
        if (fallbackFiltered.length > 0) {
          const fbCandidates = this.autoPick(fallbackFiltered, otherKind, prefs);
          const fb = fbCandidates[0];
          if (fb) {
            return {
              success: true,
              backend: fb,
              fallbackChain: fbCandidates.map((b) => b.name),
              healthcheckNotImplemented: true,
            };
          }
        }
      }

      return {
        success: false,
        error: `No backend supports targetKind: ${targetKind}`,
        errorCode: 'blocked.target_unsupported',
      };
    }

    const candidates = this.autoPick(filtered, targetKind, prefs);
    const picked = candidates[0];
    if (!picked) {
      return {
        success: false,
        error: 'Auto-pick returned no backends',
        errorCode: 'blocked.target_unsupported',
      };
    }

    const result: SelectResult = {
      success: true,
      backend: picked,
      healthcheckNotImplemented: true,
    };

    // Record fallbackChain only when auto-pick chose something other than
    // the first filter-passing backend (i.e. there was reordering/skipping).
    const firstFiltered = filtered[0];
    if (firstFiltered && picked.name !== firstFiltered.name) {
      result.fallbackChain = candidates.map((b) => b.name);
    }

    return result;
  }

  /** Production selection with canonical capability filtering and live healthchecks. */
  async selectProduction(input: {
    targetKind: TargetKind;
    deviceId: string;
    requiredCapabilities: readonly string[];
    preferredBackend?: string;
    signal?: AbortSignal;
  }): Promise<SelectResult> {
    const unknown = input.requiredCapabilities.filter(
      (capability) => !CANONICAL_DEVICE_CAPABILITIES.has(capability),
    );
    if (unknown.length > 0) {
      return {
        success: false,
        error: `Unknown required capabilities: ${unknown.join(', ')}`,
        errorCode: 'blocked.capability_unsupported',
        missingCapabilities: unknown,
        remediation: [
          'Remove unsupported capability names or register a backend adapter that declares them.',
        ],
      };
    }

    if (input.preferredBackend && !this.registry.has(input.preferredBackend)) {
      return {
        success: false,
        error: `Backend not registered: ${input.preferredBackend}`,
        errorCode: 'blocked.setup',
        remediation: [
          'Install or configure the requested backend, or choose a registered backend.',
        ],
      };
    }

    const targetCandidates = (
      input.preferredBackend
        ? this.filterByTargetKind(input.targetKind).filter(
            (backend) => backend.name === input.preferredBackend,
          )
        : this.autoPick(this.filterByTargetKind(input.targetKind), input.targetKind)
    ).filter((backend) => !/mock|dry[-_ ]?run/i.test(backend.name));

    if (targetCandidates.length === 0) {
      return {
        success: false,
        error: `No production backend supports targetKind: ${input.targetKind}`,
        errorCode: 'blocked.target_unsupported',
        remediation: ['Configure a production backend for the explicitly selected target kind.'],
      };
    }

    const capable = targetCandidates.filter((backend) => {
      const available = normalizeBackendCapabilities(backend.capabilities);
      return input.requiredCapabilities.every((capability) => available.has(capability));
    });
    if (capable.length === 0) {
      const available = new Set(
        targetCandidates.flatMap((backend) => [
          ...normalizeBackendCapabilities(backend.capabilities),
        ]),
      );
      const missing = input.requiredCapabilities.filter((capability) => !available.has(capability));
      return {
        success: false,
        error: `No backend satisfies required capabilities: ${missing.join(', ')}`,
        errorCode: 'blocked.capability_unsupported',
        missingCapabilities: missing,
        remediation: [
          'Choose a backend that supports every Flow capability or revise the Flow steps.',
        ],
      };
    }

    const fallbackChain: string[] = [];
    const healthErrors: string[] = [];
    for (const backend of capable) {
      fallbackChain.push(backend.name);
      try {
        const health = await backend.healthcheck(input.deviceId, input.signal);
        if (health.healthy) {
          return {
            success: true,
            backend,
            fallbackChain: fallbackChain.length > 1 ? fallbackChain : undefined,
          };
        }
        healthErrors.push(`${backend.name}: ${health.details ?? 'unhealthy'}`);
      } catch (error) {
        healthErrors.push(
          `${backend.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return {
      success: false,
      error: `Backend healthcheck failed: ${healthErrors.join('; ')}`,
      errorCode: 'infra.backend_unhealthy',
      fallbackChain,
      remediation: ['Verify Appium/WDA readiness and the selected device ID, then retry.'],
    };
  }

  // ── pipeline steps (exposed for testing) ─────────────────

  /**
   * Rule 1: Filter backends whose capabilities.supportedTargetKinds
   * includes the given targetKind.
   */
  filterByTargetKind(targetKind: TargetKind): DeviceBackend[] {
    return this.registry
      .list()
      .filter((b) => b.capabilities.supportedTargetKinds.includes(targetKind));
  }

  /**
   * Rule 2: If the preferred backend exists in the candidates list,
   * return it. Otherwise return null (caller handles fallback).
   */
  applyPreference(candidates: DeviceBackend[], preferred: string): DeviceBackend | null {
    return candidates.find((b) => b.name === preferred) ?? null;
  }

  /**
   * Rule 3/8: Sort candidates by per-targetKind preference order.
   *
   * Backends matching preference entries are ordered by preference index;
   * backends not in the preference list are appended at the end in
   * their original order (no special-case for any specific backend).
   */
  autoPick(
    candidates: DeviceBackend[],
    targetKind: TargetKind,
    prefs?: BackendPreferences,
  ): DeviceBackend[] {
    const effectivePrefs = prefs ?? this.resolvePreferences();
    const order =
      targetKind === 'physical' ? effectivePrefs.device.physical : effectivePrefs.device.simulator;

    const rankMap = new Map<string, number>();
    for (let i = 0; i < order.length; i++) {
      const item = order[i];
      if (item !== undefined) rankMap.set(item, i);
    }

    return [...candidates].sort((a, b) => {
      const rankA = rankMap.get(a.name) ?? order.length;
      const rankB = rankMap.get(b.name) ?? order.length;
      return rankA - rankB;
    });
  }

  /** Rule 4: Return the first backend whose live device healthcheck succeeds. */
  async healthcheckGate(
    backends: DeviceBackend[],
    deviceId: string,
    signal?: AbortSignal,
  ): Promise<DeviceBackend | null> {
    for (const backend of backends) {
      try {
        if ((await backend.healthcheck(deviceId, signal)).healthy) return backend;
      } catch {
        // Try the next same-target candidate. Production selection reports diagnostics.
      }
    }
    return null;
  }

  // ── private helpers ──────────────────────────────────────

  private resolvePreferences(): BackendPreferences {
    return {
      ...DEFAULT_PREFERENCES,
      ...this.preferences,
      device: {
        ...DEFAULT_PREFERENCES.device,
        ...this.preferences.device,
        physical: this.preferences.device?.physical ?? DEFAULT_PREFERENCES.device.physical,
        simulator: this.preferences.device?.simulator ?? DEFAULT_PREFERENCES.device.simulator,
      },
    };
  }
}

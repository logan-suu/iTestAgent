import {
  DEFAULT_HIGH_RISK_ACTIONS,
  type PermissionEffect,
  type PermissionRule,
  type SafetyGate,
} from 'itestagent-contracts';

// ─── Types ─────────────────────────────────────────────────

/** Result of requestPermission: the effect and whether it was persisted this call. */
export interface ResolveResult {
  effect: 'allow' | 'deny';
  /** True when the user chose "always remember" and a rule was persisted. */
  remembered: boolean;
}

/** Options for PermissionEngine construction. */
export interface PermissionEngineOptions {
  /** Custom high-risk action list. Defaults to DEFAULT_HIGH_RISK_ACTIONS. */
  highRiskActions?: string[];
  /** Pre-loaded rules from a previous session (persisted). */
  preloadedRules?: PermissionRule[];
  /** Timeout in ms for ask prompts. Default: 120_000 (2 min). */
  askTimeoutMs?: number;
}

// ─── Internal ──────────────────────────────────────────────

interface PendingAsk {
  resolve: (value: ResolveResult) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  action: string;
  resource: string;
}

const DEFAULT_ASK_TIMEOUT_MS = 120_000;

// ─── PermissionEngine ──────────────────────────────────────

/**
 * PermissionEngine — allow/ask/deny authorization with rule memory.
 *
 * Implements US-17.2 (AC1-AC4) and ADR-010 §4 PermissionEngine:
 *   - {action, resource, effect: allow|deny|ask} rule model
 *   - High-risk actions default to ask (R7 compliance)
 *   - Blocking ask with timeout + cancel (no deadlock)
 *   - User "always remember" persists rules
 *
 * ToolDispatcher chain (ADR-010 §4):
 *   ToolCall → Zod parse → PermissionEngine → BackendSelector → backend
 */
export class PermissionEngine {
  private readonly highRiskActions: Set<string>;
  private readonly rules: PermissionRule[] = [];
  private readonly pending: Map<string, PendingAsk> = new Map();
  private readonly askTimeoutMs: number;

  constructor(options?: PermissionEngineOptions) {
    this.highRiskActions = new Set(options?.highRiskActions ?? DEFAULT_HIGH_RISK_ACTIONS);
    this.askTimeoutMs = options?.askTimeoutMs ?? DEFAULT_ASK_TIMEOUT_MS;

    if (options?.preloadedRules) {
      for (const rule of options.preloadedRules) {
        this.rules.push({ ...rule });
      }
    }
  }

  // ─── Synchronous Gate Check ──────────────────────────────

  /**
   * Check the safety gate for an action+resource pair.
   *
   * Returns 'allow' (proceed), 'ask' (block for user confirmation),
   * or 'deny' (reject immediately).
   *
   * Matching order (first match wins, rules checked most-recent-first):
   *   1. User-defined rules: exact action + exact resource
   *   2. User-defined rules: exact action + wildcard resource ("*")
   *   3. High-risk action default → 'ask'
   *   4. Default → 'allow'
   */
  check(action: string, resource: string): SafetyGate {
    // Walk rules in reverse — most recent rule wins for the same match type.
    // Priority: exact (action+resource) > wildcard (action+"*") > high-risk default > allow.

    // Pass 1: exact match (highest priority)
    for (let i = this.rules.length - 1; i >= 0; i--) {
      const rule = this.rules[i] as PermissionRule;
      if (rule.action !== action) continue;
      if (rule.resource !== resource) continue;
      if (rule.effect === 'ask') continue; // skip ask rules (no semantic value)
      return rule.effect;
    }

    // Pass 2: wildcard resource match
    for (let i = this.rules.length - 1; i >= 0; i--) {
      const rule = this.rules[i] as PermissionRule;
      if (rule.action !== action) continue;
      if (rule.resource !== '*') continue;
      if (rule.effect === 'ask') continue;
      return rule.effect;
    }

    // No user rule matches — check high-risk default
    if (this.highRiskActions.has(action)) {
      return 'ask';
    }

    return 'allow';
  }

  // ─── Async Permission Request (blocking on ask) ──────────

  /**
   * Request permission for a tool call.
   *
   * If the gate is 'allow' or 'deny', resolves immediately.
   * If the gate is 'ask', creates a Promise that blocks until
   * resolve() or cancel() is called, or the timeout fires.
   *
   * @param callId - Unique identifier for this tool call (maps to ToolCall.id).
   * @param action - The action being requested (e.g., 'clear_app_data').
   * @param resource - The resource being acted on (e.g., bundleId).
   * @returns ResolveResult with the final effect and whether it was persisted.
   */
  requestPermission(callId: string, action: string, resource: string): Promise<ResolveResult> {
    const gate = this.check(action, resource);

    // Allow/deny — resolve immediately without blocking
    if (gate === 'allow') {
      return Promise.resolve({ effect: 'allow', remembered: false });
    }
    if (gate === 'deny') {
      return Promise.resolve({ effect: 'deny', remembered: false });
    }

    // gate === 'ask' — block until user confirms
    return new Promise<ResolveResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(callId);
        reject(
          new Error(
            `Permission ask timed out after ${this.askTimeoutMs}ms: ${action} on ${resource}`,
          ),
        );
      }, this.askTimeoutMs);

      this.pending.set(callId, { resolve, reject, timer, action, resource });
    });
  }

  // ─── Resolution ──────────────────────────────────────────

  /**
   * Resolve a pending ask with the user's decision.
   *
   * @param callId - The callId from the corresponding requestPermission call.
   * @param effect - 'allow' or 'deny' (ask is not valid here — that's the pending state).
   * @param remember - If true, persist the decision as a rule for future checks.
   */
  resolve(callId: string, effect: PermissionEffect, remember: boolean): void {
    const pending = this.pending.get(callId);
    if (!pending) return; // Already resolved, cancelled, or timed out — no-op

    clearTimeout(pending.timer);
    this.pending.delete(callId);

    if (remember) {
      this.addRule({
        action: pending.action,
        resource: pending.resource,
        effect,
      });
    }

    if (effect === 'ask') {
      // 'ask' is not a valid resolution — the caller should pass 'allow' or 'deny'
      pending.reject(new Error('Cannot resolve ask with effect "ask" — use allow or deny'));
      return;
    }

    pending.resolve({ effect, remembered: remember });
  }

  /**
   * Cancel a pending ask (timeout, user abort, or session shutdown).
   *
   * @param callId - The callId from the corresponding requestPermission call.
   * @param reason - Human-readable reason for cancellation.
   */
  cancel(callId: string, reason: string): void {
    const pending = this.pending.get(callId);
    if (!pending) return; // Already resolved or cleaned up — no-op

    clearTimeout(pending.timer);
    this.pending.delete(callId);
    pending.reject(new Error(`Permission ask cancelled: ${reason}`));
  }

  // ─── Rule Management ─────────────────────────────────────

  /** Add a user-defined permission rule. Duplicates are appended (latest wins on check). */
  addRule(rule: PermissionRule): void {
    this.rules.push({ ...rule });
  }

  /**
   * Remove an exact-matching user-defined rule.
   * Removes ALL rules with the given action+resource pair (supports wildcard).
   */
  removeRule(action: string, resource: string): void {
    for (let i = this.rules.length - 1; i >= 0; i--) {
      const rule = this.rules[i] as PermissionRule;
      if (rule.action === action && rule.resource === resource) {
        this.rules.splice(i, 1);
      }
    }
  }

  /** Return a shallow copy of all user-defined rules. */
  getRules(): PermissionRule[] {
    return this.rules.map((r) => ({ ...r }));
  }

  /** Remove all user-defined rules. */
  clearRules(): void {
    this.rules.length = 0;
  }

  // ─── High-Risk Actions ───────────────────────────────────

  /** Return the active high-risk action list (read-only copy). */
  getHighRiskActions(): readonly string[] {
    return [...this.highRiskActions];
  }

  // ─── Persistence ─────────────────────────────────────────

  /**
   * Export all user-defined rules for persistence.
   * Caller is responsible for writing to disk (JSON file, DB, etc.).
   */
  exportRules(): PermissionRule[] {
    return this.getRules();
  }

  /**
   * Create a PermissionEngine from previously-persisted rules.
   *
   * @param rules - Rules from a previous session (e.g., from exportRules()).
   * @param options - Optional engine configuration (high-risk list, timeout).
   */
  static fromRules(rules: PermissionRule[], options?: PermissionEngineOptions): PermissionEngine {
    return new PermissionEngine({
      ...options,
      preloadedRules: rules,
    });
  }
}

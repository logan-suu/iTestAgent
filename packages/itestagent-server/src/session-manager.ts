import { eq } from 'drizzle-orm';
import type { RunState } from 'itestagent-contracts';
import type { RunStateMachine } from 'itestagent-engine';
import { schema } from 'itestagent-store';
import type { DbClient } from 'itestagent-store';

import type { SSEHub } from './sse-hub.js';
import type { SessionInfo } from './types.js';

const { projects, runs } = schema;

/**
 * Default idle timeout: 30 minutes in milliseconds.
 */
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * SessionManager — manages session lifecycle, run state tracking,
 * SSE channel coordination, and DB persistence.
 *
 * Architecture §3: itestagent-server manages session creation/closing,
 * workspace, runId, SSE subscriber, and session isolation.
 * ADR-010 §4: Each session owns an independent run (runId)
 * tracked by RunStateMachine.
 */
export class SessionManager {
  /** SessionId → SessionInfo for all non-closed sessions. */
  private sessions = new Map<string, SessionInfo>();

  /** runId → current RunState (forward chain + exception states). */
  private runStates = new Map<string, RunState>();

  /** sessionId → setTimeout handle for idle auto-close. */
  private idleTimers = new Map<string, Timer>();

  private sseHub: SSEHub;
  private db: DbClient;
  private runStateMachine: RunStateMachine;
  private idleTimeoutMs: number;

  constructor(opts: {
    sseHub: SSEHub;
    db: DbClient;
    runStateMachine: RunStateMachine;
    idleTimeoutMs?: number;
  }) {
    this.sseHub = opts.sseHub;
    this.db = opts.db;
    this.runStateMachine = opts.runStateMachine;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  }

  /**
   * Create a new session with an associated run.
   *
   * Persists project and run records to the database, starts the
   * RunStateMachine, and tracks the session in memory.
   */
  createSession(params: {
    workspace: string;
    targetKind: 'physical' | 'simulator';
    backend?: string;
  }): SessionInfo {
    const sessionId = `ses_${Bun.randomUUIDv7()}`;
    const runId = `run_${Bun.randomUUIDv7()}`;

    const projectHash = this.computeProjectHash(params.workspace);
    const createdAt = new Date().toISOString();

    const session: SessionInfo = {
      sessionId,
      runId,
      workspace: params.workspace,
      targetKind: params.targetKind,
      backend: params.backend,
      createdAt,
      status: 'active',
    };

    // Persist project record (INSERT OR IGNORE — idempotent across sessions
    // sharing the same workspace). .catch() triggers Promise resolution for
    // fire-and-forget pattern (async/await deferred to DEF-001, Phase 3).
    this.db
      .insert(projects)
      .values({
        projectHash,
        workspacePath: params.workspace,
      })
      .onConflictDoNothing()
      .catch((err: unknown) => {
        if (process.env.ITESTAGENT_DEBUG) {
          console.warn('[SessionManager] DB insert (projects) failed:', err);
        }
      });

    // Persist run record.
    this.db
      .insert(runs)
      .values({
        runId,
        projectHash,
        targetKind: params.targetKind,
        backend: params.backend ?? null,
        status: 'created',
      })
      .catch((err: unknown) => {
        if (process.env.ITESTAGENT_DEBUG) {
          console.warn('[SessionManager] DB insert (runs) failed:', err);
        }
      });

    // Start the RunStateMachine: enters initial 'created' state.
    const state = this.runStateMachine.start(runId);
    this.runStates.set(runId, state);

    // Track session in memory.
    this.sessions.set(sessionId, session);

    // Start idle timer for auto-close.
    this.startIdleTimer(sessionId);

    return session;
  }

  /**
   * Look up a session by its id. Resets the idle timer on access.
   *
   * @returns SessionInfo if found and active; undefined otherwise.
   */
  getSession(sessionId: string): SessionInfo | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.resetIdleTimer(sessionId);
    }
    return session;
  }

  /**
   * Close a session: cancel the associated run, persist cancelled status,
   * clean up SSE subscribers, clear idle timer, and remove from memory.
   *
   * Idempotent — calling twice on the same sessionId is a no-op.
   * Calling with an unknown sessionId is a no-op.
   */
  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return; // Already closed or never existed (idempotent).
    }

    const currentState = this.runStates.get(session.runId);
    if (currentState !== undefined) {
      // Transition to cancelled via RunStateMachine.
      const newState = this.runStateMachine.cancel(session.runId, currentState, 'session_closed');
      this.runStates.set(session.runId, newState);
    }

    // Persist cancelled status to DB. .catch() triggers Promise resolution
    // for fire-and-forget pattern (async/await deferred to DEF-001, Phase 3).
    this.db
      .update(runs)
      .set({ status: 'cancelled' })
      .where(eq(runs.runId, session.runId))
      .catch((err: unknown) => {
        if (process.env.ITESTAGENT_DEBUG) {
          console.warn('[SessionManager] DB update (runs) failed:', err);
        }
      });

    // Clean up SSE subscribers for this session.
    this.sseHub.closeSession(sessionId);

    // Clear idle timer.
    this.clearIdleTimer(sessionId);

    // Remove from internal map.
    this.sessions.delete(sessionId);
  }

  /**
   * Close all active sessions. Used during server shutdown.
   *
   * Iterates over a snapshot of session IDs to avoid mutation
   * issues while closing.
   */
  closeAll(): void {
    const ids = [...this.sessions.keys()];
    for (const sessionId of ids) {
      this.closeSession(sessionId);
    }
  }

  /**
   * Return all currently active (non-closed) sessions.
   */
  listSessions(): SessionInfo[] {
    return [...this.sessions.values()];
  }

  /**
   * Return the count of active sessions.
   */
  get sessionCount(): number {
    return this.sessions.size;
  }

  // ─── Private: project hash ─────────────────────────────────

  /**
   * Derive a stable hash from the workspace path.
   *
   * Uses a simple multiplicative hash — sufficient for
   * local deduplication; not cryptographic.
   */
  private computeProjectHash(workspace: string): string {
    return String(
      workspace
        .split('')
        .reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0)
        .toString(16),
    );
  }

  // ─── Private: idle timer management ────────────────────────

  /**
   * Start an idle timer for a session. When the timer fires,
   * the session is automatically closed.
   */
  private startIdleTimer(sessionId: string): void {
    const timer = setTimeout(() => {
      this.closeSession(sessionId);
    }, this.idleTimeoutMs);
    this.idleTimers.set(sessionId, timer);
  }

  /**
   * Reset the idle timer for a session (called on getSession access).
   */
  private resetIdleTimer(sessionId: string): void {
    this.clearIdleTimer(sessionId);
    if (this.sessions.has(sessionId)) {
      this.startIdleTimer(sessionId);
    }
  }

  /**
   * Clear the idle timer for a session without starting a new one.
   */
  private clearIdleTimer(sessionId: string): void {
    const timer = this.idleTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(sessionId);
    }
  }
}

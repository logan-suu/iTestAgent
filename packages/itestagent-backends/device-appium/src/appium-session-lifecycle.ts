/**
 * Appium WebDriver session lifecycle — B13 module split (promotion guide
 * §11.3 "device-appium").
 *
 * Owns the WebDriver session boundary: create via an injected factory and
 * close via an injected closer so tests never open a real session.
 */

export interface AppiumSessionLifecycleDeps {
  /** Creates a WebDriver session; returns its id. */
  createSession: () => Promise<{ sessionId: string }>;
  /** Closes a WebDriver session (default: no-op when omitted). */
  closeSession?: (sessionId: string) => Promise<void>;
}

export function createAppiumSessionLifecycle(deps: AppiumSessionLifecycleDeps): {
  start(): Promise<{ sessionId: string }>;
  stop(sessionId: string): Promise<void>;
} {
  return {
    async start(): Promise<{ sessionId: string }> {
      return deps.createSession();
    },
    async stop(sessionId: string): Promise<void> {
      await deps.closeSession?.(sessionId);
    },
  };
}

import { describe, expect, it } from 'bun:test';
import { createAppiumSessionLifecycle } from '../src/appium-session-lifecycle.js';

describe('createAppiumSessionLifecycle', () => {
  it('creates a session through the injected factory', async () => {
    const lifecycle = createAppiumSessionLifecycle({
      createSession: async () => ({ sessionId: 'ses-fixed' }),
    });
    expect((await lifecycle.start()).sessionId).toBe('ses-fixed');
  });
});

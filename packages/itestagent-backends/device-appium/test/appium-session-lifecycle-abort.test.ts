import { describe, expect, it } from 'bun:test';
import { createAppiumSessionLifecycle } from '../src/appium-session-lifecycle.js';

describe('createAppiumSessionLifecycle abort', () => {
  it('stop() closes the session and clears state', async () => {
    const closed: string[] = [];
    const lifecycle = createAppiumSessionLifecycle({
      createSession: async () => ({ sessionId: 's1' }),
      closeSession: async (id: string) => {
        closed.push(id);
      },
    });
    const { sessionId } = await lifecycle.start();
    await lifecycle.stop(sessionId);
    expect(closed).toEqual(['s1']);
  });
});

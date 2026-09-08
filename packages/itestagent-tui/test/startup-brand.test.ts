import { describe, expect, it } from 'bun:test';
import {
  STARTUP_LOGO,
  STARTUP_LOGO_WIDTH,
  SUCCESS_LOGO,
  SUCCESS_LOGO_WIDTH,
  completionMessageParts,
  isSuccessfulRunMessage,
  resolveStartupBrand,
  startupBrandLines,
  successBrandLines,
  successBrandLinesInViewport,
} from '../src/startup-brand.js';
import { type Message, createInitialState } from '../src/tui-shell.js';

describe('resolveStartupBrand', () => {
  it('places the trusted completion heading before artwork and preserves report details', () => {
    const message: Message = {
      id: 'saved',
      type: 'system',
      timestamp: 0,
      runStatus: 'passed',
      text: 'Execution completed.\nReport directory: /tmp/run\nSummary: /tmp/run/summary.md',
    };
    expect(completionMessageParts(message)).toEqual({
      heading: 'Execution completed.',
      details: 'Report directory: /tmp/run\nSummary: /tmp/run/summary.md',
    });
    for (const untrusted of [
      { ...message, runStatus: undefined },
      { ...message, runStatus: 'failed' as const },
      { ...message, type: 'assistant' as const },
    ]) {
      expect(completionMessageParts(untrusted)).toEqual({ heading: message.text, details: '' });
      expect(successBrandLinesInViewport(untrusted, { width: 100, height: 30 })).toEqual([]);
    }
    expect(completionMessageParts({ ...message, text: 'Saved.' })).toEqual({
      heading: 'Saved.',
      details: '',
    });
  });

  it('sizes scrollable success from the viewport even for a long report', () => {
    const message: Message = {
      id: 'saved',
      type: 'system',
      timestamp: 0,
      runStatus: 'passed',
      text: '中文报告\n'.repeat(200),
    };
    const viewport = { width: SUCCESS_LOGO_WIDTH + 6, height: 12 };
    expect(successBrandLinesInViewport(message, viewport)).toEqual(SUCCESS_LOGO);
    expect(
      successBrandLinesInViewport(message, { ...viewport, width: viewport.width - 1 }),
    ).toEqual(['SUCCESS']);
    expect(successBrandLinesInViewport(message, { ...viewport, height: 11 })).toEqual(['SUCCESS']);
  });
  it('returns the product name by default', () => {
    expect(resolveStartupBrand({}).name).toBe('iTestAgent');
  });

  it('uses a four-row block wordmark without a repeated product caption', () => {
    const lines = startupBrandLines(createInitialState('/tmp/project'), { width: 100, height: 36 });
    expect(lines).toEqual(STARTUP_LOGO);
    expect(lines).toHaveLength(4);
    expect(lines.join('\n')).not.toContain('iTestAgent');
    expect(lines.every((line) => /^[ ▀▄█]+$/.test(line))).toBe(true);
    expect(new Set(lines.map((line) => Bun.stringWidth(line)))).toEqual(
      new Set([STARTUP_LOGO_WIDTH]),
    );
  });

  it('raises T and A above the lowercase body while preserving the baseline', () => {
    // Fixed columns also lock the mixed-case spelling and inter-letter spacing.
    expect(STARTUP_LOGO.map((line) => line.slice(2, 7))).toEqual([
      '▀▀█▀▀',
      '  █  ',
      '  █  ',
      '  ▀  ',
    ]);
    expect(STARTUP_LOGO.map((line) => line.slice(23, 27))).toEqual([
      '█▀▀█',
      '█  █',
      '█▀▀█',
      '▀  ▀',
    ]);
    expect(STARTUP_LOGO[0]?.slice(8, 17)).toBe('         ');
    expect(STARTUP_LOGO[3]?.slice(8, 17)).toBe('▀▀▀▀ ▀▀▀▀');
  });

  it('uses the matching success wordmark before falling back at viewport boundaries', () => {
    const message: Message = {
      id: 'saved',
      type: 'system',
      text: 'Report directory: /tmp/run',
      timestamp: 0,
      runStatus: 'passed',
    };
    expect(successBrandLines(message, { width: SUCCESS_LOGO_WIDTH + 8, height: 28 })).toEqual(
      SUCCESS_LOGO,
    );
    expect(SUCCESS_LOGO).toHaveLength(4);
    expect(SUCCESS_LOGO.every((line) => /^[ ▀▄█]+$/.test(line))).toBe(true);
    expect(new Set(SUCCESS_LOGO.map((line) => Bun.stringWidth(line)))).toEqual(
      new Set([SUCCESS_LOGO_WIDTH]),
    );
    expect(successBrandLines(message, { width: SUCCESS_LOGO_WIDTH + 7, height: 40 })).toEqual([
      'SUCCESS',
    ]);
    expect(successBrandLines(message, { width: 100, height: 27 })).toEqual(['SUCCESS']);
  });

  it('cannot turn unknown, unsuccessful, or untrusted messages into success artwork', () => {
    const dimensions = { width: 100, height: 40 };
    for (const runStatus of [
      undefined,
      'failed',
      'infra_failed',
      'cancelled',
      'blocked',
      'inconclusive',
      'explored',
      'needs_assertion',
      'flaky',
    ] as const) {
      expect(
        successBrandLines(
          { id: 'run', type: 'system', text: 'SUCCESS', timestamp: 0, runStatus },
          dimensions,
        ),
      ).toEqual([]);
    }
    for (const type of ['user', 'assistant', 'error'] as const) {
      expect(
        successBrandLines(
          { id: 'run', type, text: 'SUCCESS', timestamp: 0, runStatus: 'passed' },
          dimensions,
        ),
      ).toEqual([]);
    }
  });

  it('budgets wrapped report paths and prior messages before showing the large banner', () => {
    const runDir = `/tmp/${'long-project-name-'.repeat(12)}/runs/run-example`;
    const message: Message = {
      id: 'saved',
      type: 'system',
      timestamp: 0,
      runStatus: 'passed',
      text: `Report directory: ${runDir}\nSummary: ${runDir}/summary.md\nEvidence directory: ${runDir}/artifacts`,
    };
    const prior: Message = { id: 'prior', type: 'system', text: 'Earlier activity', timestamp: 0 };
    expect(successBrandLines(message, { width: 100, height: 28 }, [prior, message])).toEqual([
      'SUCCESS',
    ]);
    expect(successBrandLines(message, { width: 100, height: 50 }, [prior, message])).toEqual(
      SUCCESS_LOGO,
    );
    const short = { ...message, text: 'Saved report' };
    expect(successBrandLines(short, { width: 100, height: 28 })).toEqual(SUCCESS_LOGO);
    expect(
      successBrandLines(short, { width: 100, height: 28 }, [
        { ...prior, text: 'Earlier activity\n'.repeat(12) },
        short,
      ]),
    ).toEqual(['SUCCESS']);
    const wide = { ...message, text: '中文'.repeat(140) };
    expect(successBrandLines(wide, { width: 100, height: 28 })).toEqual(['SUCCESS']);
  });

  it('budgets every saved-run banner together instead of reusing the same free space', () => {
    const first: Message = {
      id: 'first',
      type: 'system',
      text: 'Report line\n'.repeat(5),
      timestamp: 0,
      runStatus: 'passed',
    };
    const second = { ...first, id: 'second' };
    const dimensions = { width: 100, height: 36 };
    expect(successBrandLines(first, dimensions)).toEqual(SUCCESS_LOGO);
    for (const message of [first, second]) {
      expect(successBrandLines(message, dimensions, [first, second])).toEqual(['SUCCESS']);
    }
  });

  it('uses a one-line name in narrow or short terminals and disclosure-heavy setup', () => {
    const initial = createInitialState('/tmp/project');
    expect(startupBrandLines(initial, { width: 40, height: 50 })).toEqual(['iTestAgent']);
    expect(startupBrandLines(initial, { width: 120, height: 20 })).toEqual(['iTestAgent']);
    expect(startupBrandLines({ ...initial, mode: 'setup' }, { width: 100, height: 30 })).toEqual([
      'iTestAgent',
    ]);
    expect(
      startupBrandLines(
        {
          ...initial,
          mode: 'setup',
          messages: [
            {
              id: 'notice',
              type: 'system',
              text: 'Keychain confirmation\n'.repeat(12),
              timestamp: 0,
            },
          ],
        },
        { width: 100, height: 40 },
      ),
    ).toEqual(['iTestAgent']);
  });

  it('hides startup branding during a task, review, or run completion', () => {
    const initial = createInitialState('/tmp/project');
    const dimensions = { width: 100, height: 40 };
    expect(startupBrandLines({ ...initial, mode: 'plan_review' }, dimensions)).toEqual([]);
    expect(
      startupBrandLines(
        { ...initial, agentActivity: { callId: 'run', text: 'Working' } },
        dimensions,
      ),
    ).toEqual([]);
    for (const message of [
      { id: 'user', type: 'user', text: 'Test the app', timestamp: 0 },
      { id: 'assistant', type: 'assistant', text: 'Working', timestamp: 0 },
      { id: 'run', type: 'system', text: 'Run saved', timestamp: 0, runStatus: 'passed' },
    ] satisfies Message[]) {
      expect(startupBrandLines({ ...initial, messages: [message] }, dimensions)).toEqual([]);
    }
  });

  it('marks only a canonical passed system message as successful', () => {
    const base = { id: 'message', text: 'SUCCESS', timestamp: 0 };
    expect(isSuccessfulRunMessage({ ...base, type: 'system', runStatus: 'passed' })).toBe(true);
    for (const message of [
      { ...base, type: 'system' },
      { ...base, type: 'user', runStatus: 'passed' },
      { ...base, type: 'assistant', runStatus: 'passed' },
      { ...base, type: 'error', runStatus: 'passed' },
      { ...base, type: 'system', runStatus: 'failed' },
      { ...base, type: 'system', runStatus: 'inconclusive' },
    ] satisfies Message[])
      expect(isSuccessfulRunMessage(message)).toBe(false);
  });
});

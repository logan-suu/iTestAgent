import {
  type RendererSelection,
  detectProcessCapabilities,
  selectRendererWithReason,
} from './renderer-selection.js';
import type { TuiRenderer } from './renderer.js';

export interface RendererFactoryResult extends RendererSelection {
  readonly renderer: TuiRenderer;
}

/** Create exactly the selected renderer. Import failures are surfaced; no silent fallback. */
export async function createConfiguredRenderer(framework: string): Promise<RendererFactoryResult> {
  const selection = selectRendererWithReason(detectProcessCapabilities(), { framework });
  try {
    switch (selection.kind) {
      case 'opentui': {
        // OpenTUI Solid's runtime transform must be registered before loading TSX.
        await import('@opentui/solid/preload');
        const { createOpenTuiRenderer } = await import('./renderers/opentui-renderer.js');
        return { ...selection, renderer: createOpenTuiRenderer() };
      }
      case 'ink': {
        const { createInkRenderer } = await import('./renderers/ink-renderer.js');
        return { ...selection, renderer: createInkRenderer() };
      }
      case 'ansi': {
        const { createAnsiRenderer } = await import('./renderers/ansi-renderer.js');
        return { ...selection, renderer: createAnsiRenderer() };
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`renderer_unavailable: ${selection.kind}: ${message}`);
  }
}

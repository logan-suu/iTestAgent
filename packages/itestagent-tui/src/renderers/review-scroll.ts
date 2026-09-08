import type { ScrollBoxRenderable } from '@opentui/core';
import { useTerminalDimensions } from '@opentui/solid';
import { createEffect, onCleanup } from 'solid-js';

/** Follow selection after layout; retain native scrolling for long item contents. */
export function useReviewScroll(selectedId: () => string): (ref: ScrollBoxRenderable) => void {
  let scroll: ScrollBoxRenderable | undefined;
  const dimensions = useTerminalDimensions();
  createEffect(() => {
    const id = selectedId();
    dimensions();
    const timer = setTimeout(() => scroll?.scrollChildIntoView(id), 0);
    onCleanup(() => clearTimeout(timer));
  });
  return (ref) => {
    scroll = ref;
  };
}

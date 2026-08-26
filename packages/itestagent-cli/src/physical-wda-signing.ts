/** B19: WDA signing identity (memory-only, R6). */
export interface WdaSigning {
  identity?: string;
}
export function resolveWdaSigning(input: { identity?: string } = {}): WdaSigning {
  return { identity: input.identity };
}

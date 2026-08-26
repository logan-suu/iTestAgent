/** B31: TUI startup brand (promotion guide §11.3 'run routing/completion'). */
export function resolveStartupBrand(input: { name?: string } = {}): { name: string } {
  return { name: input.name ?? 'iTestAgent' };
}

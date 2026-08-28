/** B30: TUI plan-review port. */
export function createTuiPlanReviewPort(_deps: object = {}): {
  render(plan: { planId: string }): { ok: true };
} {
  return { render: () => ({ ok: true }) };
}

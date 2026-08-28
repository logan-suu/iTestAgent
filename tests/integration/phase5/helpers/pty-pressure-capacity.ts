/** PTY pressure capacity helpers — B35 phase5 PTY race support. */
export function resolvePtyPressureCapacity(input: { capacity?: number } = {}): {
  capacity: number;
} {
  return { capacity: input.capacity ?? 16 };
}

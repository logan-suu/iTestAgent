/** B32: feed-memory device selection. */
export function resolveFeedMemoryDeviceSelection(input: { udid?: string } = {}): { udid?: string } {
  return { udid: input.udid };
}

export function createSelectedDeviceSession(input: { udid?: string } = {}): { udid?: string } {
  return { udid: input.udid };
}

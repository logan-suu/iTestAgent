/**
 * Message retention — B29 module split (promotion guide §11.3 "agent
 * session/stream/retention").
 *
 * Caps transcripts/messages to a retention window, keeping the newest
 * entries so long-running sessions stay bounded in memory and screen.
 */
export function retainMessages<T>(messages: readonly T[], maxCount: number): T[] {
  if (maxCount <= 0) return [];
  return messages.slice(-maxCount);
}

export function applyRetentionToTranscript<T>(transcript: readonly T[], maxCount: number): T[] {
  return retainMessages(transcript, maxCount);
}

/**
 * WDA active application detection — B13 module split (promotion guide §11.3
 * "device-appium"; ADR-012 Route C).
 *
 * Extracts the foreground bundle id from a WDA/Appium status payload so the
 * runner knows which app is active without guessing.
 */

/** Parses the active app bundle id from a WDA status JSON payload. */
export function parseActiveBundleId(statusJson: string): string | null {
  try {
    const parsed = JSON.parse(statusJson) as { value?: { activeApp?: string } };
    const bundleId = parsed?.value?.activeApp;
    return typeof bundleId === 'string' && bundleId.length > 0 ? bundleId : null;
  } catch {
    return null;
  }
}

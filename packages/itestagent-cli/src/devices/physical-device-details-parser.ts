/**
 * Physical device details parser — B18 module split (promotion guide §11.3
 * "physical discovery/doctor").
 *
 * Parses the section-scoped "Key: value" details text emitted by devicectl
 * into a flat "Section.Key" map (same shape as the B12
 * devicectl-details-sanitized.txt fixture). Comment lines are ignored.
 */
export function parseDeviceDetailsText(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  let section = '';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    if (line.endsWith(':')) {
      section = line.slice(0, -1).trim();
      continue;
    }
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    if (key.length === 0) continue;
    result[section ? `${section}.${key}` : key] = value;
  }
  return result;
}

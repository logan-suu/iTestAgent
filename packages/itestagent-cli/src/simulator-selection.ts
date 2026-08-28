/** B20: simulator selection (ADR-011 first-class support). */
export interface SimulatorSelection {
  selector: 'booted' | 'by_udid' | 'by_name';
  udid?: string;
  name?: string;
}
export function resolveSimulatorSelection(
  input: { udid?: string; name?: string } = {},
): SimulatorSelection {
  if (input.udid) return { selector: 'by_udid', udid: input.udid };
  if (input.name) return { selector: 'by_name', name: input.name };
  return { selector: 'booted' };
}

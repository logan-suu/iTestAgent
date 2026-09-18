import { isAbsolute } from 'node:path';

/** Ephemeral local connection settings, never a persisted permission decision. */
export interface SimulatorAppiumOptions {
  appiumServerUrl: string;
  wdaLocalPort: number;
  mjpegServerPort: number;
  derivedDataPath: string;
}

export function validateSimulatorAppiumOptions(
  input: SimulatorAppiumOptions,
): SimulatorAppiumOptions {
  let url: URL;
  try {
    url = new URL(input.appiumServerUrl);
  } catch {
    throw new Error('simulator_connection.invalid_url');
  }
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['/', '/wd/hub', '/wd/hub/'].includes(url.pathname)
  )
    throw new Error('simulator_connection.local_url_required');
  const ports = [Number(url.port || 80), input.wdaLocalPort, input.mjpegServerPort];
  if (
    ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65535) ||
    new Set(ports).size !== 3
  )
    throw new Error('simulator_connection.distinct_ports_required');
  if (
    !isAbsolute(input.derivedDataPath) ||
    input.derivedDataPath === '/' ||
    [...input.derivedDataPath].some((character) => character.charCodeAt(0) < 32)
  )
    throw new Error('simulator_connection.absolute_derived_data_required');
  return Object.freeze({ ...input, appiumServerUrl: url.toString() });
}

export function simulatorConnectionSummary(input: SimulatorAppiumOptions): string {
  return `Local Appium ${input.appiumServerUrl}; WDA ${input.wdaLocalPort}; MJPEG ${input.mjpegServerPort}; dedicated WDA build directory selected. WDA preparation requires permission; this does not authorize installing the app.`;
}

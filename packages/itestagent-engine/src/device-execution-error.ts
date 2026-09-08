/** Retains already recorded execution facts across a controlled terminal failure. */
export class DeviceBackendExecutionError extends Error {
  constructor(
    message: string,
    readonly partialResult: unknown,
  ) {
    super(message);
    this.name = 'DeviceBackendExecutionError';
  }
}

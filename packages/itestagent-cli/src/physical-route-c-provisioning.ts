/** B19: Route C provisioning (free-account, -allowProvisioningUpdates). */
export interface ProvisioningOptions {
  allowProvisioningUpdates: boolean;
}
export function resolveProvisioningOptions(
  input: { allowProvisioningUpdates?: boolean } = {},
): ProvisioningOptions {
  return { allowProvisioningUpdates: input.allowProvisioningUpdates ?? false };
}

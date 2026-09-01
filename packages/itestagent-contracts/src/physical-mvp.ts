import { z } from 'zod';

/**
 * Physical MVP execution contract — B04 (promotion guide §11.3
 * "TestPlan/target execution", §6.2 "physical MVP routes").
 *
 * Locks the vocabulary of the G5-verified physical path (ADR-012 + its G5
 * update) at the contracts layer:
 *
 *   - Route C: Appium manages the per-
 *     session WDA startup via managed xcodebuild +
 *     allowProvisioningDeviceRegistration; WdaManager is reduced to one-time
 *     build+install.
 *   - Route B: WdaManager owns the full WDA lifecycle
 *     and Appium connects as a WebDriver session only.
 *
 * Guide §6.2 generalization rule: team/device/app identity is INJECTED —
 * no machine identifiers are baked into this module, and authorization,
 * fingerprint, and signing facts stay memory-only (R6/R7). The identity
 * schema therefore has no defaults and every field is optional.
 */

export const PHYSICAL_ROUTE_VALUES = [
  'route_b_wda_manager_managed',
  'route_c_appium_managed',
] as const;

export const PhysicalRouteSchema = z.enum(PHYSICAL_ROUTE_VALUES);

export type PhysicalRoute = z.infer<typeof PhysicalRouteSchema>;

export const WDA_LIFECYCLE_ROLE_VALUES = ['build_install_only', 'full_lifecycle'] as const;

export const WdaLifecycleRoleSchema = z.enum(WDA_LIFECYCLE_ROLE_VALUES);

export type WdaLifecycleRole = z.infer<typeof WdaLifecycleRoleSchema>;

/**
 * Injected physical identity facts. Every field is optional with NO default:
 * an unset field means "not provided in this session", never a baked-in
 * machine value. These are memory-only signing/session facts (R6/R7) and
 * must never be persisted to reports or artifacts.
 */
export const PhysicalIdentitySchema = z
  .object({
    teamId: z.string().optional(),
    deviceUdid: z.string().optional(),
    appBundleId: z.string().optional(),
    wdaBundleId: z.string().optional(),
  })
  .strict();

export type PhysicalIdentity = z.infer<typeof PhysicalIdentitySchema>;

/** Route ↔ role pairing accepted by {@link validatePhysicalMvpContract}. */
export interface PhysicalMvpContractInput {
  route: PhysicalRoute;
  wdaLifecycleRole: WdaLifecycleRole;
  identity?: PhysicalIdentity;
}

export const PHYSICAL_CONTRACT_ISSUE_CODES = ['route_role_mismatch'] as const;

export type PhysicalMvpContractIssueCode = (typeof PHYSICAL_CONTRACT_ISSUE_CODES)[number];

export interface PhysicalMvpContractIssue {
  code: PhysicalMvpContractIssueCode;
  message: string;
}

const ROUTE_ROLE_PAIRING: Record<PhysicalRoute, WdaLifecycleRole> = {
  route_c_appium_managed: 'build_install_only',
  route_b_wda_manager_managed: 'full_lifecycle',
};

/**
 * Validates the ADR-012/ADR-028 route ↔ WDA-lifecycle-role pairing.
 * Pure function; returns typed issues, never throws.
 */
export function validatePhysicalMvpContract(
  input: PhysicalMvpContractInput,
): PhysicalMvpContractIssue[] {
  const expectedRole = ROUTE_ROLE_PAIRING[input.route];
  if (input.wdaLifecycleRole === expectedRole) {
    return [];
  }
  return [
    {
      code: 'route_role_mismatch',
      message: `route "${input.route}" requires wdaLifecycleRole "${expectedRole}" (ADR-012 G5 update), got "${input.wdaLifecycleRole}"`,
    },
  ];
}

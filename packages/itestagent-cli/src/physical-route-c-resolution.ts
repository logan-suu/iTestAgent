/** B19: Route C resolution (ADR-012). */
export interface RouteCResolution {
  route: 'route_c_appium_managed' | 'route_b_wda_manager_managed';
}
export function resolveRouteC(input: { preferWdaManager?: boolean } = {}): RouteCResolution {
  return {
    route: input.preferWdaManager ? 'route_b_wda_manager_managed' : 'route_c_appium_managed',
  };
}

/**
 * Project analyzer — B16 module split (promotion guide §11.3 "engine
 * analysis/intents").
 *
 * Summarizes project assets from analyzer facts into the shape the engine
 * uses for lane routing.
 */

export interface ProjectAssetsInput {
  hasXCUITests: boolean;
}

export interface ProjectAssetsSummary {
  hasXcuitest: boolean;
}

export function summarizeProjectAssets(input: ProjectAssetsInput): ProjectAssetsSummary {
  return { hasXcuitest: input.hasXCUITests };
}

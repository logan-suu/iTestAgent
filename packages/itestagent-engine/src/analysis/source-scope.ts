/**
 * Source scope — B16 module split (promotion guide §11.3 "engine
 * analysis/intents").
 *
 * Resolves a coarse source-code scope (total file counts) from analyzer
 * facts.
 */

export interface SourceScopeInput {
  swiftFiles: number;
  objcFiles: number;
}

export interface SourceScope {
  totalFiles: number;
  swiftFiles: number;
  objcFiles: number;
}

export function resolveSourceScope(input: SourceScopeInput): SourceScope {
  return {
    totalFiles: input.swiftFiles + input.objcFiles,
    swiftFiles: input.swiftFiles,
    objcFiles: input.objcFiles,
  };
}

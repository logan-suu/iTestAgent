/**
 * schema-pair-registry.ts — the runtime<->published schema pair registry
 * (promotion guide §12.1 G1 / §16 G1). The mapping of a published JSON schema
 * in `schemas/` to its runtime Zod schema symbol is NOT derivable by naming
 * convention alone (e.g. `result.schema.json` -> `RunResultSchema`), so the
 * mapping lives here as the single source of truth consumed by
 * `tests/architecture/schema-parity-gate.test.ts`.
 *
 * Every pair must register a runtime symbol that the named package actually
 * exports from its `src/index.ts`, and a parity test path that proves
 * runtime<->published equivalence. Pairs whose runtime schemas live outside
 * `itestagent-contracts` keep their parity tests inside their own package
 * (`<runtimePackage>/test/parity/`); those parity tests are authored in the
 * batch that builds out the corresponding runtime schema (guide §16 G1).
 */

/** A registered runtime/published schema pair. */
export interface SchemaPair {
  /** Published JSON schema filename under `schemas/`, e.g. "config.schema.json". */
  published: string;
  /** Workspace package that exports the runtime Zod schema. */
  runtimePackage: string;
  /** Symbol exported by `<runtimePackage>/src/index.ts`. */
  runtimeSymbol: string;
  /** Repo-relative path to the parity test proving runtime<->published equivalence. */
  parityTest: string;
}

/** Known runtime/published schema pairs for this repository. */
export const registeredPairs: SchemaPair[] = [
  {
    published: 'config.schema.json',
    runtimePackage: 'itestagent-contracts',
    runtimeSymbol: 'ItestAgentConfigSchema',
    parityTest: 'packages/itestagent-contracts/test/parity/config.test.ts',
  },
  {
    published: 'result.schema.json',
    runtimePackage: 'itestagent-contracts',
    runtimeSymbol: 'RunResultSchema',
    parityTest: 'packages/itestagent-contracts/test/parity/result.test.ts',
  },
  {
    published: 'artifact-index.schema.json',
    runtimePackage: 'itestagent-contracts',
    runtimeSymbol: 'ArtifactIndexSchema',
    parityTest: 'packages/itestagent-contracts/test/parity/artifact-index.test.ts',
  },
  {
    published: 'run-steps.schema.json',
    runtimePackage: 'itestagent-contracts',
    runtimeSymbol: 'RunStepsDocumentSchema',
    parityTest: 'packages/itestagent-contracts/test/parity/run-steps.test.ts',
  },
  {
    published: 'flow-replay-plan.schema.json',
    runtimePackage: 'itestagent-contracts',
    runtimeSymbol: 'FlowReplayPlanSchema',
    parityTest: 'packages/itestagent-contracts/test/parity/flow-replay-plan.test.ts',
  },
  {
    published: 'test-plan.schema.json',
    runtimePackage: 'itestagent-contracts',
    runtimeSymbol: 'TestPlanSchema',
    parityTest: 'packages/itestagent-contracts/test/parity/test-plan.test.ts',
  },
  {
    published: 'flow.schema.json',
    runtimePackage: 'itestagent-flow',
    runtimeSymbol: 'FlowV2Schema',
    parityTest: 'packages/itestagent-flow/test/parity/flow.test.ts',
  },
  {
    published: 'project-profile.schema.json',
    runtimePackage: 'itestagent-project-analyzer',
    runtimeSymbol: 'ProjectProfileSchema',
    parityTest: 'packages/itestagent-project-analyzer/test/parity/project-profile.test.ts',
  },
];

import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ProjectDiscovery, ProjectGraph } from 'itestagent-contracts';
import { ProjectGraphSchema } from 'itestagent-contracts';
import { classifyProductType, isUnitTest, isXCUITest, parsePbxproj } from './pbxproj-parser.js';

/**
 * graph(discovery) — Analyses the target dependency graph.
 *
 * Per the tech selection document: XcodeProj / Tuist XcodeProj is the
 * primary candidate for project graph. Here we use a self-contained
 * lightweight pbxproj parser (pbxproj-parser.ts) instead of the external
 * XcodeProj dependency, extracting only target names, types, and
 * dependency relationships.
 *
 * Flow:
 *   1. Locate .xcodeproj path from ProjectDiscovery
 *   2. Read project.pbxproj
 *   3. Parse PBXNativeTarget for name / type / dependencies
 *   4. Assemble and validate via ProjectGraphSchema
 */

/**
 * Find the .xcodeproj path from a ProjectDiscovery, handling workspaces.
 */
function resolveXcodeprojPath(discovery: ProjectDiscovery): string | null {
  // Direct project
  if (discovery.xcodeprojPath) {
    const pbxprojPath = resolve(discovery.xcodeprojPath, 'project.pbxproj');
    if (existsSync(pbxprojPath)) return pbxprojPath;
  }

  // Workspace: look for nested .xcodeproj
  if (discovery.xcworkspacePath) {
    const workspaceRoot = discovery.root;

    // Try common patterns: <workspaceRoot>/<name>.xcodeproj
    if (discovery.name) {
      const candidate = resolve(workspaceRoot, `${discovery.name}.xcodeproj`, 'project.pbxproj');
      if (existsSync(candidate)) return candidate;
    }

    // Try looking one level deep for any .xcodeproj
    try {
      const entries = readdirSync(workspaceRoot);
      for (const entry of entries) {
        if (entry.endsWith('.xcodeproj')) {
          const pbxprojPath = resolve(workspaceRoot, entry, 'project.pbxproj');
          if (existsSync(pbxprojPath)) return pbxprojPath;
        }
      }
    } catch {
      // readdir failed — no fallback available
    }
  }

  return null;
}

/**
 * Analyse the target dependency graph for the project.
 *
 * @param discovery - ProjectDiscovery from discover()
 * @returns Validated ProjectGraph
 * @throws Error if no .xcodeproj can be found
 */
export async function graph(discovery: ProjectDiscovery): Promise<ProjectGraph> {
  const pbxprojPath = resolveXcodeprojPath(discovery);

  if (!pbxprojPath) {
    throw new Error(
      `Cannot find project.pbxproj for project "${discovery.name || discovery.root}". Make sure the project has at least one .xcodeproj with a project.pbxproj file.`,
    );
  }

  const result = parsePbxproj(pbxprojPath);

  if (!result) {
    throw new Error(`Failed to parse pbxproj: ${pbxprojPath}`);
  }

  const targets = result.targets.map((t) => ({
    name: t.name,
    type: classifyProductType(t.productType),
    dependencies: t.dependencyTargetNames,
  }));

  const hasXCUITests = result.targets.some((t) => isXCUITest(t.productType));
  const hasUnitTests = result.targets.some((t) => isUnitTest(t.productType));

  const graphResult: ProjectGraph = {
    targets,
    hasXCUITests,
    hasUnitTests,
  };

  // Validate against Zod schema
  return ProjectGraphSchema.parse(graphResult);
}

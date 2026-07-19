import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ProjectDiscovery } from 'itestagent-contracts';
import { ProjectDiscoverySchema } from 'itestagent-contracts';
import { findProjectFile, runList } from './xcodebuild-exec.js';

/**
 * discover(root) — Discovers project type, schemes, and configurations.
 *
 * Per the tech selection document: xcodebuild -list/-showBuildSettings is
 * Apple's official source of truth. Do not infer from pbxproj alone.
 *
 * Flow:
 *   1. Locate .xcworkspace or .xcodeproj
 *   2. Run xcodebuild -list -json (with plain-text fallback for older Xcode)
 *   3. Assemble and validate via ProjectDiscoverySchema
 */

/**
 * Thin wrapper over ProjectDiscoverySchema.parse() — exposed for test
 * injection so tests can validate parsing logic without xcodebuild.
 */
export function parseAndValidate(raw: unknown): ProjectDiscovery {
  return ProjectDiscoverySchema.parse(raw);
}

/**
 * Discover project structure at the given root directory.
 *
 * @param root - Project root directory path
 * @returns Validated ProjectDiscovery
 * @throws ZodError if output doesn't match schema
 * @throws XcodebuildError if xcodebuild fails
 */
export async function discover(root: string): Promise<ProjectDiscovery> {
  const absRoot = resolve(root);

  if (!existsSync(absRoot)) {
    throw new Error(`Project root does not exist: ${absRoot}`);
  }

  // Find project file (workspace or xcodeproj)
  const projectFile = findProjectFile(absRoot);

  if (!projectFile) {
    throw new Error(
      `No .xcworkspace or .xcodeproj found in ${absRoot}. Make sure you are in an Xcode project directory.`,
    );
  }

  // Run xcodebuild -list
  const { json, text } = runList(absRoot);

  // Determine project name from JSON (preferred) or text output
  let projectName: string | undefined;
  let schemes: string[];
  let configurations: string[];
  let type: ProjectDiscovery['type'];

  if (json) {
    projectName = json.project.name;
    schemes = json.project.schemes;
    configurations = json.project.configurations;
    type = projectFile.type;
  } else {
    // From text output, we don't get a project name — derive from directory
    const parts = absRoot.split('/');
    projectName = parts[parts.length - 1];
    schemes = text.schemes;
    configurations = text.configurations;
    type = projectFile.type;
  }

  const discovery: ProjectDiscovery = {
    root: absRoot,
    name: projectName,
    type: type === 'xcode_workspace' ? 'xcode_workspace' : 'xcode_project',
    xcworkspacePath: type === 'xcode_workspace' ? projectFile.path : undefined,
    xcodeprojPath: type === 'xcode_project' ? projectFile.path : undefined,
    schemes,
    configurations,
  };

  // Validate against Zod schema
  return ProjectDiscoverySchema.parse(discovery);
}

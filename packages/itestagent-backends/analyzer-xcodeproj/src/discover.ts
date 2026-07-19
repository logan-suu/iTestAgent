import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ProjectDiscovery } from 'itestagent-contracts';
import { ProjectDiscoverySchema } from 'itestagent-contracts';
import { findProjectFile, runList } from './xcodebuild-exec.js';

/**
 * discover(root) — 发现项目类型、schemes、configurations。
 *
 * 技术选型文档 §10：xcodebuild -list/-showBuildSettings 是 Apple 官方事实源，
 * 不要只读 pbxproj 推断。
 *
 * 流程：
 *   1. 查找 .xcworkspace 或 .xcodeproj
 *   2. 运行 xcodebuild -list -json（或纯文本 fallback）
 *   3. 组装 ProjectDiscovery 并过 Zod schema 校验
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

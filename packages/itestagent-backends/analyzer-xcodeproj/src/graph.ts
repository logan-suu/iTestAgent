import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ProjectDiscovery, ProjectGraph } from 'itestagent-contracts';
import { ProjectGraphSchema } from 'itestagent-contracts';
import { classifyProductType, isUnitTest, isXCUITest, parsePbxproj } from './pbxproj-parser.js';

/**
 * graph(discovery) — 分析 target 依赖图。
 *
 * 技术选型文档 §10：XcodeProj / Tuist XcodeProj 是 Project graph 第一候选。
 * 这里用自研轻量 pbxproj 解析器（pbxproj-parser.ts）替代外部 XcodeProj 依赖，
 * 只提取 target 名称/类型/依赖关系。
 *
 * 流程：
 *   1. 从 ProjectDiscovery 找到 .xcodeproj 路径
 *   2. 读取 project.pbxproj
 *   3. 解析 PBXNativeTarget → 名称/类型/依赖
 *   4. 组装 ProjectGraph 并过 Zod schema 校验
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
    const workspaceDir = dirname(discovery.xcworkspacePath);
    const workspaceRoot = discovery.root;

    // Try common patterns: <workspaceDir>/<name>.xcodeproj
    if (discovery.name) {
      const candidate = resolve(workspaceRoot, `${discovery.name}.xcodeproj`, 'project.pbxproj');
      if (existsSync(candidate)) return candidate;
    }

    // Try looking one level deep for any .xcodeproj
    try {
      const { readdirSync } = require('node:fs') as typeof import('node:fs');
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
    dependencies: t.dependencyTargetUuids,
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

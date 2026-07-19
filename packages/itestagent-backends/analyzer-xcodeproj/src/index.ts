import type { ProjectAnalyzerBackend, ResourceFacts, SourceFacts } from 'itestagent-contracts';
import { buildSettings } from './build-settings.js';
import { discover } from './discover.js';
import { graph } from './graph.js';

/**
 * XcodeProjAnalyzerBackend — ProjectAnalyzerBackend 接口的实现。
 *
 * 使用 xcodebuild（Apple 官方 CLI）+ 自研轻量 pbxproj 解析器。
 *
 * 本次实现覆盖确定性层的 3 个方法（discover / graph / buildSettings）。
 * 推断层方法（scanSources / scanResources）留到任务 2.2（Swift 结构/符号）。
 *
 * 技术选型文档 §10：
 *   - xcodebuild -list/-showBuildSettings 必用（Apple 官方事实源）
 *   - XcodeProj / Tuist XcodeProj 第一候选（Project graph）
 *
 * 红线 R2：不自研已复用底座（xcodebuild 复用，不碰 pbxproj 二进制）
 * 红线 R4：推断字段只输出候选 + evidence + confidence
 */

/**
 * Create an XcodeProjAnalyzerBackend instance.
 *
 * scanSources and scanResources throw "not implemented" errors
 * (these are deferred to task 2.2).
 */
export function createXcodeProjAnalyzerBackend(): ProjectAnalyzerBackend {
  return {
    discover,

    graph,

    buildSettings,

    // ── 推断层（2.2 实现）─────────────────────────────────
    async scanSources(): Promise<SourceFacts> {
      throw new Error(
        'scanSources not yet implemented — deferred to task 2.2 (Swift structure/symbols)',
      );
    },

    async scanResources(): Promise<ResourceFacts> {
      throw new Error(
        'scanResources not yet implemented — deferred to task 2.2 (Swift structure/symbols)',
      );
    },
  };
}

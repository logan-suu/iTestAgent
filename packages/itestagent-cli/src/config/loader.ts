import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type ItestAgentConfig, ItestAgentConfigSchema } from 'itestagent-contracts';
import { parse as parseJsonc } from 'jsonc-parser';

/**
 * 配置加载器（三层 JSONC 合并）
 *
 * AC 原文（US-18.2 AC1）：
 *   配置路径：~/.itestagent/config/itestagent.jsonc、<project>/.itestagent/itestagent.jsonc、<project>/itestagent.jsonc
 *
 * AC 原文（US-18.2 AC2）：
 *   使用 JSONC，支持 $schema
 *
 * AC 原文（US-18.1 AC3）：
 *   启动以当前目录为 workspace
 *
 * 合并优先级：project-root > project-local > global（后者覆盖前者）
 * 嵌套对象递归合并（deep merge），非对象值直接覆盖。
 */

/** 配置文件来源信息（用于诊断） */
export interface ConfigSource {
  /** 文件绝对路径 */
  path: string;
  /** 文件是否存在 */
  exists: boolean;
  /** 解析后的内容（文件存在且解析成功时） */
  content?: unknown;
}

/** 配置加载结果 */
export interface LoadConfigResult {
  /** 最终合并后的配置（已通过 Zod schema 校验） */
  config: ItestAgentConfig;
  /** 配置文件来源列表（含未加载的文件，exists=false） */
  sources: ConfigSource[];
}

/** 三层配置路径（US-18.2 AC1） */
function getConfigPaths(projectDir: string, homeDir: string): string[] {
  return [
    // 层 1：全局（~/.itestagent/config/itestagent.jsonc）
    join(homeDir, '.itestagent', 'config', 'itestagent.jsonc'),
    // 层 2：项目本地（<project>/.itestagent/itestagent.jsonc）
    join(projectDir, '.itestagent', 'itestagent.jsonc'),
    // 层 3：项目根（<project>/itestagent.jsonc）
    join(projectDir, 'itestagent.jsonc'),
  ];
}

/** 判断是否为纯对象（非数组、非 null） */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 判断是否为 ENOENT 错误（文件不存在） */
function isENOENTError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as Record<string, unknown>).code === 'ENOENT'
  );
}

/** 深合并多个对象（后者覆盖前者，嵌套对象递归合并） */
function deepMergeObjects(objects: Record<string, unknown>[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const obj of objects) {
    for (const key of Object.keys(obj)) {
      const overrideValue = obj[key];
      const baseValue = result[key];
      if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
        result[key] = deepMergeObjects([baseValue, overrideValue]);
      } else {
        result[key] = overrideValue;
      }
    }
  }
  return result;
}

/**
 * 加载配置的可选参数。
 */
export interface LoadConfigOptions {
  /** 项目目录（US-18.1 AC3：启动以当前目录为 workspace，默认 process.cwd()） */
  projectDir?: string;
  /** Home 目录（用于测试注入，默认 os.homedir()） */
  homeDir?: string;
}

/**
 * 加载配置（三层合并）。
 *
 * US-18.1 AC3：启动以当前目录为 workspace（projectDir 默认为 process.cwd()）。
 * US-18.2 AC1：三层路径合并。
 * US-18.2 AC2：使用 jsonc-parser 解析 JSONC（支持注释 + $schema）。
 *
 * @param options.projectDir 项目目录（默认 process.cwd()）
 * @param options.homeDir Home 目录（默认 os.homedir()，测试可注入）
 * @returns 合并后的配置 + 来源信息
 * @throws 配置文件解析失败或 Zod schema 校验失败时抛出
 */
export async function loadConfig(options?: LoadConfigOptions): Promise<LoadConfigResult> {
  const cwd = options?.projectDir ?? process.cwd();
  const home = options?.homeDir ?? homedir();
  const configPaths = getConfigPaths(cwd, home);

  const sources: ConfigSource[] = [];
  const contents: Record<string, unknown>[] = [];

  for (const configPath of configPaths) {
    const source: ConfigSource = { path: configPath, exists: false };
    try {
      const fileContent = await readFile(configPath, 'utf-8');
      source.exists = true;
      source.content = parseJsonc(fileContent);
      if (isPlainObject(source.content)) {
        contents.push(source.content);
      }
    } catch (error: unknown) {
      // 文件不存在是正常的（ENOENT），跳过
      if (isENOENTError(error)) {
        sources.push(source);
        continue;
      }
      // 解析失败或读取失败，抛出带文件路径的错误
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load config file: ${configPath}\n${message}`);
    }
    sources.push(source);
  }

  // 深合并所有配置层
  const merged = deepMergeObjects(contents);

  // Zod schema 校验（填充默认值 + 拒绝非法字段）
  const config = ItestAgentConfigSchema.parse(merged);

  return { config, sources };
}

/**
 * 获取默认配置（不读取任何文件，仅返回 schema 默认值）。
 */
export function getDefaultConfig(): ItestAgentConfig {
  return ItestAgentConfigSchema.parse({});
}

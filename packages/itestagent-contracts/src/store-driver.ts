import { z } from 'zod';
import type { ArtifactRef } from './device-types.js';

/**
 * Store Driver — 存储驱动接口与证据输入（§5.5）
 *
 * 架构设计文档 §5 Backend 接口设计：
 *   StoreDriver 为 SQLite + Drizzle 统一存储入口，
 *   配合 SecretStore（密钥存储）和 ArtifactStore（文件存储）。
 *
 * 红线 R6：敏感数据（账号/OTP/token）不落盘明文、不入日志/报告/提交。
 * 红线 R7：高风险操作（存凭证）必须二次确认。
 */

// ─── ArtifactInput ──────────────────────────────────────────

/**
 * 证据存储输入 Schema。
 * 对应 ArtifactStore.put() 的输入契约（数据流全链路 S8）。
 */
export const ArtifactInputSchema = z.object({
  /** 产物类型，与 ArtifactType 枚举对齐 */
  type: z.enum([
    'screenshot',
    'video',
    'uitree',
    'log',
    'crashlog',
    'trace',
    'xcresult',
    'json',
    'text',
  ]),
  /** Buffer 形式的数据（可选，与 path 二选一） */
  data: z.instanceof(Buffer).optional(),
  /** 文件路径形式的数据（可选，与 data 二选一） */
  path: z.string().optional(),
  /** MIME 类型（可选，如 image/png） */
  mimeType: z.string().optional(),
  /** 关联的 run step id（可选） */
  relatedStep: z.string().optional(),
  /** 产生此产物的 backend 名称（可选） */
  backend: z.string().optional(),
});

export type ArtifactInput = z.infer<typeof ArtifactInputSchema>;

// ─── StoreDriver ────────────────────────────────────────────

/**
 * StoreDriver — 存储驱动接口。
 *
 * 统一 SQLite + Drizzle 存储入口。
 * migrate() 确保 schema 与代码同步（幂等）；
 * transaction() 提供原子性批量操作。
 */
export interface StoreDriver {
  /** 执行数据库迁移（幂等） */
  migrate(): Promise<void>;
  /** 在事务中执行操作 */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

// ─── SecretStore ────────────────────────────────────────────

/**
 * SecretStore — 密钥存储接口。
 *
 * 敏感数据（账号/token）只在内存注入，落盘必脱敏（R6）。
 * 实现可以是 Keychain（macOS）或内存 Map（非持久化）。
 */
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

// ─── ArtifactStore ──────────────────────────────────────────

/**
 * ArtifactStore — 证据文件存储接口。
 *
 * 对应 run artifacts 目录下的文件读写。
 * 产物文件以 id 为唯一标识，支持按关键字搜索。
 */
export interface ArtifactStore {
  /** 存储一个证据文件并返回引用 */
  put(input: ArtifactInput): Promise<ArtifactRef>;
  /** 按 ID 查找证据引用 */
  get(id: string): Promise<ArtifactRef | null>;
  /** 按搜索词查找证据引用（模糊匹配） */
  search(query: string): Promise<ArtifactRef[]>;
}

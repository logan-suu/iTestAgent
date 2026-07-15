import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 版本号单一来源。
 *
 * US-1.1 AC2：安装后 itestagent --version 能输出版本号。
 * 从 itestagent-cli package.json 读取 version 字段。
 */
const pkgPath = join(import.meta.dir, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };

export const VERSION: string = pkg.version;

import pkg from '../package.json' with { type: 'json' };

/**
 * 版本号单一来源。
 *
 * US-1.1 AC2：安装后 itestagent --version 能输出版本号。
 * 从 itestagent-cli package.json 读取 version 字段。
 */
export const VERSION: string = pkg.version;

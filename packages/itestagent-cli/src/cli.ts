import { Command } from 'commander';
import { loadConfig } from './config/loader.js';
import { VERSION } from './version.js';

/**
 * iTestAgent CLI 入口（Commander）
 *
 * AGENTS.md §11 常用命令：
 *   itestagent                 # 进入 TUI(核心入口)
 *   itestagent doctor          # 环境诊断与引导
 *   itestagent devices         # 查看本机 iPhone
 *   itestagent config          # 配置管理
 *   itestagent --version
 *   itestagent explain <run>   # 失败解释
 *   itestagent rerun <run> --failed-only
 *   itestagent run flow <id>   # 重放 Flow(调试/自动化辅助)
 *
 * 技术选型 §5：CLI 用 Commander（轻量入口）。
 * 本任务 1.1 只实现 --version + config + 子命令 stub。
 */

/**
 * 创建 Commander program 实例。
 * 导出函数便于测试（不直接执行 parseAsync）。
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name('itestagent')
    .description('iPhone 真机全自动化测试 TUI Agent — Local-first, TUI-first, Agent-native.')
    .version(VERSION, '-v, --version', '输出版本号');

  // US-1.1 AC3 / US-18.1 AC1：无子命令时提示 TUI（不要求登录）
  program.action(() => {
    console.log('TUI coming in task 1.2');
    console.log("Run 'itestagent --help' for available commands.");
  });

  // ─── doctor（stub → task 1.4）───
  program
    .command('doctor')
    .description('环境诊断与引导')
    .action(() => {
      console.log('Coming in task 1.4 — doctor 环境诊断与引导');
    });

  // ─── devices（stub → task 1.5）───
  program
    .command('devices')
    .description('查看本机 iPhone')
    .action(() => {
      console.log('Coming in task 1.5 — devices 设备发现与 healthcheck');
    });

  // ─── config（实际实现：展示三层合并后的配置）───
  // US-18.2 AC1/AC2：三层 JSONC 合并 + $schema 支持
  program
    .command('config')
    .description('展示当前生效配置（三层 JSONC 合并）')
    .action(async () => {
      const { config, sources } = await loadConfig();
      console.log(JSON.stringify(config, null, 2));
      console.error('\nConfig sources:');
      for (const source of sources) {
        const mark = source.exists ? '\u2713' : '\u2717';
        console.error(`  ${mark} ${source.path}`);
      }
    });

  // ─── explain（stub → task 5.1）───
  program
    .command('explain <run>')
    .description('失败解释')
    .action((runId: string) => {
      console.log(`Coming in task 5.1 — explain run: ${runId}`);
    });

  // ─── rerun（stub → task 5.1）───
  program
    .command('rerun <run>')
    .description('重跑失败用例')
    .option('--failed-only', '只重跑失败的用例')
    .action((runId: string, options: { failedOnly?: boolean }) => {
      const flag = options.failedOnly ? ' --failed-only' : '';
      console.log(`Coming in task 5.1 — rerun: ${runId}${flag}`);
    });

  // ─── run flow（嵌套子命令，stub → task 5.2）───
  const runCmd = program.command('run').description('运行相关命令');

  runCmd
    .command('flow <id>')
    .description('重放 Flow（调试/自动化辅助）')
    .action((flowId: string) => {
      console.log(`Coming in task 5.2 — run flow: ${flowId}`);
    });

  return program;
}

// 入口点：当作为 bin 运行时（import.meta.main 是 Bun 特有）
if (import.meta.main) {
  createProgram().parseAsync(process.argv);
}

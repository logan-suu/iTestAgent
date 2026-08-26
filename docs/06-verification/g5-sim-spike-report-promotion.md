# G5-SIM Spike 验证报告（promotion）

- **批次**：B41（promotion guide §11.3 / §12.3 verification-missing；ADR-011）
- **日期**：2026-08-26
- **目标**：Simulator 能力必须经 CoreSimulator runtime 端到端验证（G5-SIM）

## 环境

- macOS + Xcode 26+，CoreSimulator runtime
- Bun 1.3.14（`~/.local/bin/bun-1.3.14`）
- 依赖：B03/B04/B07/B09/B17（migrations/contracts）+ B38（evidence corpus）

## 证据

- `docs/06-verification/evidence/g5-sim/promotion/manifest.json`：验证 manifest（verdict: pass）

## 风险与集成笔记

- Simulator 端到端验证依赖本机 CoreSimulator runtime；CI 环境需 macOS runner
- `verify-evidence --scope g5-sim` 在 g5-sim evidence 缺失时返回 exit 42
  （MISSING_CURRENT_EVIDENCE），evidence 就位后 exit 0（批次专属检查，B41）
- 与 ADR-011 对齐：Simulator 与真机同级支持，G5-SIM 证据独立留档

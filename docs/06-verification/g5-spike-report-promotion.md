# G5 Spike 验证报告（promotion）

- **批次**：B42（promotion guide §11.3 / §12.3 verification-missing；ADR-011）
- **日期**：2026-08-26
- **目标**：真机能力必须 real iPhone spike 实测（G5）

## 环境

- macOS + Xcode 26+，iPhone 真机
- Bun 1.3.14（`~/.local/bin/bun-1.3.14`）
- 依赖：B41（g5-sim evidence）+ B38（evidence corpus）+ 迁移各批次

## 证据

- `docs/06-verification/evidence/g5/promotion/attestation.json`：G5 attestation（verdict: attested）

## 风险与集成笔记

- **阻塞（附录 B.3）**：物理 G5 仍受 AUT 与独立 WDA signing chains 阻塞；历史
  G5 证据在架构变化后不得复用，完成性必须由本批新证据确认。
- 本批产出 attestation（记录真实状态与阻塞事实），不虚构"passed"。
- `verify-evidence --scope g5` 在 g5 evidence 缺失时返回 exit 42
  （MISSING_CURRENT_EVIDENCE），就位后 exit 0（批次专属检查，B41）。
- 与 ADR-011 对齐：真机与 Simulator 同级支持；G5 独立证据留档。

# ADR-052：T6.12 单次 CI 豁免与完成确认

状态：Accepted。用户在 pr-merge-itest 完成流程中获知 PR #82 已合并但 CI 失败后，明确指示“先跳过CI”。本决策仅适用于此次 T6.12 完成确认。

## 背景与决策

PR #82 已于 2026-09-18T03:22:55Z 合并到 dev-1.0，merge commit 为 2050288962fa70ab22e674f155dbebdbe8a5981a。CI run 35302564214 的 typecheck/lint 通过，test:ci 失败；security-scan通过。本机完整回归为4244通过、16跳过、0失败。

默认完成要求包含测试门禁通过。用户明确接受本次远端CI未通过的已知风险，因此按ADR-050/051已确认范围关闭T6.12。不得将此次例外描述为CI通过、全部质量门禁通过或全量MVP产品完成；不得把例外扩展为其他任务或后续提交的持续豁免。

## 已知失败与后续责任

GitHub公开check annotations指出：xcode-memory-helper-install.test.ts的安装、复用、取消和失败分型相关检查失败；production-agent-session.test.ts创建physical backend时缺少WebDriverAgent.xcodeproj。helper错误被安装器归一化为helper.installation_failed，根因尚未确定，不能据此宣称全部是CI环境误报。日志下载端点连接失败，已通过API取得失败步骤和annotations。

DEF-042保持open，target_phase=6，由T6.13阶段出口复核先定位、修复并取得CI通过。延期来自用户此次明确指示，不代表技术修复完成。现有DEF-037–041及产品发布门禁保持不变。

T6.12标done，依赖满足的T6.13标ready；Phase6仍in_progress、current_phase仍6，不启动Phase7。追踪更新不包含新的commit/push授权，不自动合并任何PR。

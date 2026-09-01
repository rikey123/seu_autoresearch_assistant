# 基座改动登记表（Base Changes Registry）

> 目的：科研工作台凡触及基座（upstream EKKOLearnAI/hermes-studio 同源）代码的改动，须在此登记，
> 保持 upstream 可同步能力。审查员按本表核验；未登记的基座侧改动视为违规。
> 口径：`packages/server/src/modules/research/**` 与 `tests/server/research-*` 属隔离域，不在本表范围。

| 编号 | 分支（工单） | 基座侧文件 | 改动性质 | upstream 同步策略 | 状态 |
| --- | --- | --- | --- | --- | --- |
| BC-1 | feature/p2-T1a-client-guard（W4） | `packages/client/src/views/hermes/WorkflowView.vue`（normalizeStoredNode/serializeWorkflowNodes/节点模板注册/运行时数据守卫）；`packages/client/src/components/hermes/workflow/`（新增只读确定性节点卡片组件 + types 扩展）；`packages/client/src/utils/workflow-node-type.ts`（新增纯函数层）；11 个 i18n locale | 画布节点 type 透传 + 只读防护：载入透传 `record.type`（缺省 `agent`，非 agent 类型不注入 agent 默认值）；序列化按 type 回写、不写 agent 字段；新增 script/validate/render 只读卡片；未知类型 vue-flow 默认兜底且往返无损；agent 分支行为零变化 | 纯增益、向后兼容，可原样提 PR upstream | ✅ 已合入 main（b902ae0 → merge 4f80927，pm 验收通过） |
| BC-2 | feature/p2-T1b-output-column（W5） | `packages/server/src/modules/studio/infrastructure/database/schemas.ts`（workflow_run_node_sessions 加 `output_json` 列 + 迁移）；`packages/server/src/modules/studio/infrastructure/database/workflow-run-store.ts`（record 字段 + create 缺省 + update 可选 outputJson 入参） | run-store 纯加法存储列：确定性节点输出落库（`TEXT NOT NULL DEFAULT ''`），迁移照既有 ADD COLUMN 先例；update 函数签名向后兼容，现有调用方零修改；不触碰 manager.ts | 纯加法、向后兼容，可原样提 PR upstream | 施工中（W5，2026-09-02 派发） |
| BC-3 | feature/p2-T1c-engine-dispatch（W6） | `packages/server/src/modules/studio/services/workflow/manager.ts`（normalizeWorkflowNode 类型分支；executeNode/DAG 执行器按 type 分发；assertWorkflowAgentDependencies 跳过非 agent；输出捕获与 rerun 恢复对空 session 节点切读 output_json）；`packages/server/src/modules/studio/services/workflow/deterministic-executor.ts`（新增，确定性执行器）；`packages/server/src/modules/studio/public/workflow-runtime.ts`（WorkflowRuntimeDependencies 新增可选 runDeterministicNode 依赖）；bootstrap 中 configureWorkflowRuntime 装配行 | 引擎集中扩展：normalize 放行 script/validate/render 三类型（各自 data 归一化，agent 分支逐字保留，未知类型仍拒绝）；非 agent 节点跳过 agent 会话创建，经 DI 执行器运行，输出写 `output_json`（session_id=''）；执行器按类型注册表分发（集中登记点），script 先落地（python/node 子进程、结构化参数数组、禁 shell 字符串拼接、复用 deadline 超时），validate/render 未配置时明确报错；一处扩展 run/rerun 两路同时放行 | 附加式扩展（新增类型分支 + 新增可选 DI 依赖），agent 路径零变化，可原样提 PR upstream | 待开工（登记在先，2026-09-02） |

> 待登记预告：W7（画布科研节点拖拽与配置编辑，承接 W4 只读卡片）开工前由 pm 补条目。

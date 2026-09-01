# 基座改动登记表（Base Changes Registry）

> 目的：科研工作台凡触及基座（upstream EKKOLearnAI/hermes-studio 同源）代码的改动，须在此登记，
> 保持 upstream 可同步能力。审查员按本表核验；未登记的基座侧改动视为违规。
> 口径：`packages/server/src/modules/research/**` 与 `tests/server/research-*` 属隔离域，不在本表范围。

| 编号 | 分支（工单） | 基座侧文件 | 改动性质 | upstream 同步策略 | 状态 |
| --- | --- | --- | --- | --- | --- |
| BC-1 | feature/p2-T1a-client-guard（W4） | `packages/client/src/views/hermes/WorkflowView.vue`（normalizeStoredNode/serializeWorkflowNodes/节点模板注册/运行时数据守卫）；`packages/client/src/components/hermes/workflow/`（新增只读确定性节点卡片组件 + types 扩展）；`packages/client/src/utils/workflow-node-type.ts`（新增纯函数层）；11 个 i18n locale | 画布节点 type 透传 + 只读防护：载入透传 `record.type`（缺省 `agent`，非 agent 类型不注入 agent 默认值）；序列化按 type 回写、不写 agent 字段；新增 script/validate/render 只读卡片；未知类型 vue-flow 默认兜底且往返无损；agent 分支行为零变化 | 纯增益、向后兼容，可原样提 PR upstream | ✅ 已合入 main（b902ae0 → merge 4f80927，pm 验收通过） |
| BC-2 | feature/p2-T1b-output-column（W5） | `packages/server/src/modules/studio/infrastructure/database/schemas.ts`（workflow_run_node_sessions 加 `output_json` 列 + 迁移）；`packages/server/src/modules/studio/infrastructure/database/workflow-run-store.ts`（record 字段 + create 缺省 + update 可选 outputJson 入参） | run-store 纯加法存储列：确定性节点输出落库（`TEXT NOT NULL DEFAULT ''`），迁移照既有 ADD COLUMN 先例；update 函数签名向后兼容，现有调用方零修改；不触碰 manager.ts | 纯加法、向后兼容，可原样提 PR upstream | 施工中（W5，2026-09-02 派发） |

> 待登记预告：W6（引擎 normalize 分支 + 确定性执行器 DI 依赖）、W7（三张确定性节点卡片）开工前由 pm 补条目。

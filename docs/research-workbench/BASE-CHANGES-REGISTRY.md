# 基座改动登记表（Base Changes Registry）

> 目的：科研工作台凡触及基座（upstream EKKOLearnAI/hermes-studio 同源）代码的改动，须在此登记，
> 保持 upstream 可同步能力。审查员按本表核验；未登记的基座侧改动视为违规。
> 口径：`packages/server/src/modules/research/**` 与 `tests/server/research-*` 属隔离域，不在本表范围。

| 编号 | 分支（工单） | 基座侧文件 | 改动性质 | upstream 同步策略 | 状态 |
| --- | --- | --- | --- | --- | --- |
| BC-1 | feature/p2-T1a-client-guard（W4） | `packages/client/src/views/hermes/WorkflowView.vue`（makeNode/normalizeStoredNode/serializeWorkflowNodes 及节点模板注册）；`packages/client/src/components/hermes/workflow/`（新增只读确定性节点卡片组件）；项目既有 i18n locale 文件 | 画布节点 type 透传 + 只读防护：载入透传 `record.type`（缺省 `agent`，非 agent 类型不注入 agent 默认值）；序列化按 type 回写、不写 agent 字段；新增 script/validate/render 只读卡片（nodeTypes 映射，无编辑入口）；未知类型保持 vue-flow 默认兜底且往返无损 | 纯增益、向后兼容（agent 路径行为零变化），可原样提 PR upstream | 施工中（W4，2026-09-02 派发） |

> 待登记预告：W5（run-store `output_json` 列）、W6（引擎 normalize 分支 + 确定性执行器 DI 依赖）、W7（三张确定性节点卡片）开工前由 pm 补条目。

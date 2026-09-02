# P2 评审报告

- 评审范围：`7c88f26..91cd2b9`（当前 `main` 最终工作树）
- 评审重点：确定性工作流引擎、`output_json` 持久化与 rerun 恢复、客户端节点类型透传/守卫、画布卡片与模板契约、指定测试覆盖
- 验证结果：指定的 4 个 Vitest 文件共 39 个测试通过；`npm.cmd run build` 通过；`git diff --check 7c88f26..91cd2b9` 无报告
- Verdict：**request-changes**

## 总结

这组提交的总体方向是正确的：服务端把 `script/validate/render` 集中到确定性类型注册表，经 `workflow-runtime` 的可选 DI 接缝进入两个调度器；确定性节点不创建聊天 session，并把结果写入 `output_json`；客户端也保留了 `agent` 的原有分支、增加了确定性卡片和 11 个 locale 的文案。`validate/render` 当前明确报告“executor 尚未配置”，属于可接受的阶段性行为，而不是静默成功。

不过，当前实现仍有会影响生产运行和后续 P3 的高风险 seam：停止工作流不能及时终止确定性脚本；超时只杀直接子进程且没有输出上限；客户端声称的未知节点无损往返实际上会删除与 agent 字段同名的数据；rerun 没有数据库层的 admission/CAS；服务端新增的 `output_json` 也没有同步到客户端 API 类型。另有 script 的 `runtime` 和五字段模板契约在客户端、服务端之间没有统一的可执行 schema。

## Findings

### [P1 / 高] 停止工作流不会中止正在运行的确定性脚本

- 证据：`packages/server/src/modules/studio/services/workflow/manager.ts:1196-1225` 的 `stopRun()` 只把有非空 `session_id` 的活动行加入 `activeSessionIds`，然后调用 `abortWorkflowSession()`；确定性节点在 `:1422-1431` 创建的行固定使用 `session_id: ''`，因此不会进入 abort 集合。
- 证据：`packages/server/src/modules/studio/services/workflow/manager.ts:1435-1449` 只在 `runWorkflowDeterministicNode()` 返回后才检查 `args.isCanceled()`；`packages/server/src/modules/studio/public/workflow-runtime.ts:1-15` 的 `WorkflowDeterministicNodeRequest` 没有 `AbortSignal`、取消句柄或 run/node 级 abort API。
- 证据：`packages/server/src/modules/studio/services/workflow/manager.ts:1028-1049` 的 `withinWorkflowRunDeadline()` 是 `Promise.race()`，超时/取消时只让外层 promise 结束，不会自动停止底层 operation。
- 影响：用户点击停止后，run 和 node row 会立即显示 `canceled`，但无 deadline 的脚本（例如 `setInterval`、阻塞循环、等待外部子进程）仍可持续占用 CPU、文件句柄和 workspace 资源；脚本最终返回时还会在已取消 run 上继续执行收尾逻辑。该问题也会让并行 deterministic 节点的资源占用失去上界。
- 建议：给 deterministic executor 增加可传播的 `AbortSignal`/run-scoped cancellation registry，并在 `stopRun()` 中按 `runId/nodeId` 触发；executor 必须在 abort、正常 close、timeout 之间只结算一次。补充“无 timeout 的长脚本在 stop 后进程已退出、node row 最终状态稳定为 canceled”的回归测试。

### [P1 / 高] timeout 只杀 direct child，Windows 下可能留下进程树孤儿

- 证据：`packages/server/src/modules/studio/services/workflow/deterministic-executor.ts:77-81` 的 timeout 回调直接执行 `child.kill('SIGKILL')`。
- 对照证据：仓库已有 `packages/server/src/modules/studio/infrastructure/process-tree.ts:13-41`，明确记录 Windows 上 `child.kill()` 只终止 immediate process，并提供 `killOwnedProcessTree()`（Windows 使用 `taskkill /T /F`）。确定性执行器没有调用该 helper，也没有维护进程组/进程树句柄。
- 影响：脚本可通过 `node:child_process` 派生 Python、CLI、MCP 或其他 worker。timeout 只杀 Node 直接子进程时，grandchild 可能继续运行，形成跨 run 的资源泄漏和 workspace 并发污染；Windows 是确定会遇到该行为的平台。
- 建议：复用 `killOwnedProcessTree()` 或等价的跨平台进程组终止策略，并在 close 后确认树已消失；增加脚本派生子进程、触发 deadline、检查子进程树清理的测试，至少覆盖 Windows 分支的 helper 行为和 executor 的实际调用接线。

### [P1 / 高] stdout/stderr 无上限，`unlimited` run 可被输出耗尽内存

- 证据：`packages/server/src/modules/studio/services/workflow/deterministic-executor.ts:73-86` 在每个 `data` 事件中无限拼接 `stdout`/`stderr`；`:106-118` 直到进程结束后才 trim/解析；`:141-143` 的错误截断也发生在全部输出已经累积之后。
- 影响：`process.stdout.write('x'.repeat(...))` 或高频日志可以在 timeout 前持续扩大 Node heap。默认允许无 deadline 时风险没有时间上限；多个 ready deterministic 节点并行执行会放大内存压力。错误详情的最后 2,000 字符截断不能阻止前面的内存增长。
- 建议：为 stdout、stderr 设置明确的字节上限，超过上限立即终止进程树并以可识别的“output limit exceeded”失败；必要时只保留尾部 ring buffer。将输出上限写入 executor contract，并补充单节点、并行节点和 stderr 超限测试。

### [P1 / 高] 未知节点类型的“无损往返”会删除与 agent 字段同名的数据

- 证据：`packages/client/src/utils/workflow-node-type.ts:57-64` 的 `stripWorkflowDeterministicNodeDataFields()` 会删除 `WORKFLOW_AGENT_NODE_DATA_KEYS` 中除 `input/orchestration` 外的所有 key；`:104-110` 的 `normalizeDeterministicWorkflowNodeData()` 和 `:122-134` 的 serializer 都调用它。
- 证据：`packages/client/src/views/hermes/WorkflowView.vue:1201-1221` 将所有 `type !== 'agent'`（包括未来未知类型）送入 deterministic normalizer；`:1136-1147` 又把所有非 agent 节点送入 deterministic serializer。
- 复现：保存如下未来节点后加载并再次保存：`{ type: 'research', data: { title: 'Deep dig', agent: 'future-runtime', model: 'future-model', depth: 3 } }`。`agent`、`model` 会在加载时被 strip，无法恢复。
- 影响：这违反 `docs/research-workbench/BASE-CHANGES-REGISTRY.md:9` 对 BC-1 所作的“未知类型往返无损”承诺，属于用户数据破坏和 upstream forward-compatibility 回归。现有 `tests/client/workflow-node-type.test.ts:169-193` 只使用 `depth/tags/payload` 等不冲突字段，因此没有捕获该缺陷。
- 建议：将序列化分成 `agent`、已知 deterministic、未知类型三条路径。未知类型应原样保留 data，只剥离明确的 runtime-only UI 字段；不要复用针对 deterministic contract 的 agent-key strip。增加包含 `agent/model/provider/skills/images/approvalRequired` 等冲突 key 的 unknown round-trip 测试。

### [P2 / 中高] rerun 没有 workflow-scoped admission，也没有原子 compare-and-set

- 证据：`packages/server/src/modules/studio/services/workflow/manager.ts:1090-1100` 的 `acquireRunAdmission()`，以及 `:2414-2448` 的调用，只存在于 `runNow()`；`rerunFromNode()` 从 `:2490` 开始没有取得同一 admission。
- 证据：`packages/server/src/modules/studio/services/workflow/manager.ts:2521-2531` 先做普通读取和时间戳比较，`:2582-2590` 再以 `allow_terminal_reset: true` 更新为 running；`packages/server/src/modules/studio/infrastructure/database/schemas.ts:323-330` 对 `(run_id, execution_id)` 建了唯一索引。
- 影响：同一进程的当前同步尾段通常会让第二个请求看到第一个请求已改成 running，但这不是数据库层保证；多 worker/多进程、未来在 reset 前加入 await，或不同 manager 实例下，两个 rerun 仍可同时通过 terminal 检查。它们可能重置同一个 run、产生相同毫秒级 `rerun:${startedAt}` execution scope，触发唯一索引冲突，或交错写入输出/edge evidence。
- 建议：复用 `acquireRunAdmission(workflowId)` 覆盖 rerun，或增加带 expected status/started_at/finished_at 条件的原子 `UPDATE ... WHERE`，并对更新行数做 CAS 检查；execution scope 使用独立随机/单调 token。增加两个并发 rerun 请求的测试，断言只有一个被接受且历史输出/evidence 不交错。

### [P2 / 中] `output_json` 服务端字段没有进入客户端 API 类型

- 证据：`packages/server/src/modules/studio/repositories/workflow-run-store.ts:45-66` 已将 `output_json: string` 设为 `WorkflowRunNodeSessionRecord` 必填字段，`:105-127` 也会从数据库读出它。
- 对照证据：`packages/client/src/api/studio/workflows.ts:71-91` 的同名 `WorkflowRunNodeSessionRecord` 没有 `output_json`。
- 影响：API 实际返回 deterministic output，但客户端类型系统无法安全消费；后续运行历史/确定性输出展示只能依赖未声明字段，形成跨层契约漂移，也使 output restore 的行为难以由前端类型检查保护。目前 UI 未直接读取该字段，所以 build 不会暴露问题。
- 建议：同步客户端接口字段，明确其是否始终为字符串、是否允许空串；增加 controller/API response shape 测试以及 client 类型使用测试，避免只验证 repository 层。

### [P2 / 中] script `runtime` 与五字段模板契约在客户端没有被统一守卫

- 证据：服务端 canonicalizer `packages/server/src/modules/studio/services/workflow/manager.ts:365-395` 为 deterministic 节点补齐 `title/input/orchestration`，并要求 script 的 `runtime === 'node'`，同时保留 `code`。
- 对照证据：客户端工厂 `packages/client/src/utils/workflow-node-type.ts:67-78` 只为 script 新建完整的 `{title,input,orchestration,runtime:'node',code}`，而 validate/render 只生成 `{title}`；`packages/client/src/components/hermes/workflow/types.ts:38-48` 的 `WorkflowDeterministicNodeData` 没有 `runtime` 字段。
- 对照证据：`packages/client/src/utils/workflow-node-type.ts:104-110` 的 generic normalizer 会保留任意 runtime；`packages/client/src/views/hermes/WorkflowView.vue:2623-2638` 的保存校验只检查标题和 agent 字段，不检查 deterministic 的 runtime/code。`WorkflowDeterministicNode.vue:63-90` 也只提供 script 的 code/input 编辑，没有 runtime 修复控件。
- 影响：导入或旧数据中的 `runtime: 'python'` 可以在画布上加载、编辑并保存，直到服务端 preflight/执行时才失败；用户没有可见的修复路径。空 code 也可保存后才在 executor 报错。validate/render 的 title-only authoring 是 BC-4 的既定阶段性选择，但其与服务端自动注入的 input/orchestration 之间缺少显式 schema，容易让模板实现各自猜测字段。
- 建议：定义按 node type 区分的共享/可生成 schema：所有 deterministic 节点明确 `title/input/orchestration` 的 canonical shape，script 明确固定 `runtime:'node'` 和 code；客户端加载时 canonicalize 或显式标记 invalid，保存前给出 deterministic-specific 错误。为 validate/render 的 title-only 阶段契约补充 schema/test，避免后续模板直接依赖隐式字段。

### [P3 / 低] deterministic 卡片没有展示 `statusError` 详情

- 对照证据：agent 卡片在 `packages/client/src/components/hermes/workflow/WorkflowAgentNode.vue:25-31` 计算失败 tooltip；`packages/client/src/components/hermes/workflow/WorkflowDeterministicNode.vue:11-20` 只有 status label，`:36-42` 没有错误 tooltip 或详情展示。
- 影响：script 失败、超时或 validate/render 未配置时，画布只有红点/失败文案，用户必须打开运行详情才能看到 executor error。错误已经持久化到 node session，因此这是可用性缺口而非数据正确性问题。
- 建议：沿用 agent 卡片的 status tip，至少在失败状态显示截断后的 `statusError`，并保留详情面板作为完整错误来源。

## 已确认的正确点与非阻塞项

- `packages/server/src/modules/studio/services/workflow/deterministic-executor.ts:12-49` 的集中注册表和未知 executor 的显式报错避免了静默成功；`validate/render` 为 `null` 是当前阶段的明示限制。
- `packages/server/src/modules/studio/services/workflow/deterministic-executor.ts:67-72` 使用结构化 argv、`shell:false` 和 stdin 注入，没有把节点数据拼成 shell 命令；但这不替代上面所述的进程生命周期和输出边界。
- `packages/server/src/modules/studio/repositories/workflow-run-store.ts:486-519,523-553` 与 `packages/server/src/modules/studio/infrastructure/database/schemas.ts:300-320` 的 `output_json` 创建、读取、更新、迁移接线基本完整；缺的是 fallback/API/并发层面的测试和客户端类型同步。
- 11 个 locale（`ar/de/en/es/fr/ja/ko/pt/ru/zh/zh-TW`）均包含 node type、readonly badge 和 deterministic card 文案，现有客户端测试已覆盖键完整性；本轮没有发现缺失 locale key。建议后续再补运行时 locale smoke，而不是重复静态 key 断言。

## 测试覆盖缺口

当前点名的测试能证明基本 happy path，但不足以证明上述 seam。建议按文件补齐：

### `tests/server/workflow-manager-deterministic.test.ts`

- stop/cancel 发生在脚本执行中、无 timeout 的无限脚本、timeout 后进程树清理；
- stdout/stderr 上限、空 stdout、超限错误；
- 直接调用 executor 时的非法 runtime、空 code、非 `Error` rejection；
- `success/failure/always` edge evidence、deterministic 节点位于 feedback loop、多个 ready deterministic 节点并行；
- executor DI 缺失、executor 抛出非 Error、node-session 持久化更新失败/行消失；
- 两个并发 `rerunFromNode()` 请求，验证 admission/CAS 和唯一 execution id；
- workspace/cwd 传播和 rerun 后 deterministic output restore 的空/损坏输出行为。

### `tests/server/workflow-run-node-output-column.test.ts`

- SQLite 不可用时 JSON fallback 的 create/read/update；
- `output_json` 为 `NULL`、非字符串或损坏 row 时的归一化；
- 更新不存在 session、并发 update 的 lost-update 语义；
- controller/API 返回的 `node_sessions[].output_json` 形状；
- 大输出与输出上限策略的行为。

### `tests/client/workflow-node-type.test.ts`

- unknown type data 中含 `agent/model/provider/skills/images/approvalRequired` 等同名字段时仍能无损 round-trip；
- `runtime:'python'`、缺失 runtime、非字符串 code 的加载/保存/提示行为；
- unknown 类型在 authoring、run replay、默认 Vue Flow fallback 下的实际只读行为；
- 挂载卡片后 disabled input 是否阻止 update/drag 事件，而不只是源码字符串断言；
- validate/render 的精确 canonical shape，以及客户端 `output_json` 类型/消费路径。

### `tests/client/workflow-canvas.test.ts`

- 真实挂载 Vue Flow 后的 source/target handle 方向和多连接行为；
- toolbar 创建 script/validate/render 的 payload、runtime/code 默认值和保存结果；
- readonly replay 阻止编辑、拖拽、连接和删除；
- unknown type 渲染 fallback、invalid runtime 的提示；
- 重复 edge id、多条连接、反馈环和取消/回放快照的只读状态。

## P3 建议

**当前不建议直接进入 P3。** 在开始 PDF、translation、LaTeX 等 P3 工作前，应先修复或由架构负责人明确接受以下阻断项，并把回归测试加入门槛：

1. deterministic cancellation、deadline 的进程树终止和 stdout/stderr 资源上限；
2. unknown node type 的真正 lossless round-trip；
3. rerun 的 workflow-scoped admission 与数据库 CAS（或明确、可验证的单进程部署约束）；
4. script/validate/render canonical template schema、`runtime:'node'` guard，以及客户端 `output_json` 类型同步。

这些问题分别涉及执行生命周期、前向兼容、并发一致性和跨层数据契约。若未解决，P3 的模板、PDF 和 LaTeX 能力会建立在无法可靠停止/恢复、可能丢失未来节点字段、以及无法类型安全读取 deterministic output 的基础上；完成上述修复并补齐测试后，再进入 P3 更稳妥。

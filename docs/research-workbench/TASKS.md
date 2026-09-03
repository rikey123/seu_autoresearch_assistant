# 科研工作台 · 任务拆解与执行看板

> 配套文档：[DESIGN.md](./DESIGN.md)
> 规则：每个任务 = 一个 `feature/pX-TY-*` 分支 = 一个 Claude Code 工单。完成后审查员审，P 阶段收口 Codex 审。
> 模型策略（v0.2，admin 决策）：**全局 API-first**——LLM/embedding/翻译尽量走 API 服务商（Studio provider 配置），不下载、不本地跑模型；GFW 环境确需下载权重时 HF_ENDPOINT=hf-mirror.com + HF_HUB_DISABLE_XET=1。

## 工单模板（派发给 Claude Code 时使用）

```
仓库：D:\project\seu_autoresearch_assistant（branch: feature/pX-TY-slug，基于最新 main）
设计文档：docs/research-workbench/DESIGN.md（先读第 4 节与相关小节）
基座架构契约：AGENTS.md、ARCHITECTURE.md、docs/harness/server-module-boundaries.md
任务：<具体目标>
约束：
- 遵守模块边界（routes→controllers→services；Studio 域 /api/studio/*）
- 前端 Vue3 <script setup> + Naive UI；用户可见文案进 i18n（zh + en）
- 每步自测：npm run lint、相关 vitest；UI 改动附截图
- 完成后 git commit（feat(research): ...），不 push，等待审查
验收标准：<可验证的命令/页面操作>
```

---

## P0 地基（负责人：pm 直接执行）

| # | 任务 | 状态 | 说明 |
| --- | --- | --- | --- |
| T0.1-T0.5 | 环境修正、依赖安装、基线构建、冒烟、仓库治理、首次 push | ✅ 已完成 | 本机 Node22 下构建/冒烟双绿（8899），初始提交已推 origin main；Node 23 升级遗留为待办 |

## P1 骨架（Claude Code 工单 W1-W3）

| # | 任务 | 分支 | 验收 | 状态 |
| --- | --- | --- | --- | --- |
| T1.1 | research 服务模块骨架（五子域+路由注册+boundary 文档+checker 绿） | feature/p1-T1-server-skeleton | `node scripts/server-module-boundaries.mjs` 通过；新路由 200 | ✅ 已合入 main（3b7ae81 → merge e5dd205，审查点 A 通过） |
| T1.2 | 前端科研工作台导航+五视图空页+i18n | feature/p1-T2-client-shell | 页面可达，中英文案齐全 | ✅ 已合入 main（4156bfc → merge 7c88f26，审查点 A 通过） |
| T1.3 | artifacts 产物注册表（表+API+预览路由） | feature/p1-T3-artifacts | 建表迁移+API 测试过 | ✅ 已合入 main（91567e1 → merge a1f92e6，审查点 B 通过） |
| **审查A** | 审查员：边界+风格 | — | 出审查报告 | ✅ 通过（T1/T2 均 approve，2026-09-01） |

## P2 确定性工作流（W4-W7，方案 C：复用基座引擎 + 节点扩展）

| # | 任务 | 分支 | 验收 |
| --- | --- | --- | --- |
| T2.0 | 接缝 spike：验证基座引擎扩展点（run-store 容纳非 agent 确定性节点 / rerun 快照行为 / 画布未知节点兜底），产出接缝评估结论，决定主方案（扩展节点）或降级方案（自建执行器+复用基座存储契约） | feature/p2-T0-spike | spike 报告入库 T2.0-spike-report.md；结论=方案 C 可行、不降级 | ✅ 已合入 main（0044b73 → merge 0c5fd09，审查点 B 通过 + 真实链路 JWT 冒烟四步全过） |
| T2.1a | 画布节点 type 透传 + 只读防护（先行封堵静默改写；基座改动 BC-1） | feature/p2-T1a-client-guard | agent 分支零变化；未知类型往返无损；11 locale 齐全 | ✅ 已合入 main（b902ae0 → merge 4f80927，pm 验收通过） |
| T2.1b | run-store `output_json` 存储列（确定性输出落库；基座改动 BC-2） | feature/p2-T1b-output-column | 迁移+读写单测绿；既有测试零回归 | ✅ 已合入 main（4cadcdd → merge a196c85，pm 验收通过） |
| T2.1c | 引擎分发：normalize 类型分支 + 确定性执行器（DI 注入）+ 输出捕获/rerun 恢复切换（基座改动 BC-3） | feature/p2-T1c-engine-dispatch | 单测覆盖 5 种节点类型；改动集中登记、upstream 可同步 | ✅ 已合入 main（0a59987 → merge 55fdba1，pm 验收通过：新增 9 用例 + 全量回归 211 绿 + build） |
| T2.2 | 模板 literature-review + paper-translate（翻译走 API） | feature/p2-T2-templates | 端到端跑通一次（可 mock LLM） | ✅ 已合入 main（65bcab1 + 654e42d 引擎协议适配修复 → merge 7dcfbe9；审查两轮：首轮 request-changes 指出 PT 链路不适配引擎包装输入，修复后模板级 e2e 2/2 + research 22/22 + 引擎 155/155 绿，pm 验收通过） |
| T2.3 | 画布适配科研节点（前端，含未知节点兜底） | feature/p2-T3-canvas | 新节点可拖拽配置 | ✅ 已合入 main（d0fc4e5 → merge 8a323ce，pm 验收通过：46/46 实跑 + build） |
| T2.4 | overnight-research 批处理模板 | feature/p2-T4-overnight | 队列+晨报 HTML 产物 | ✅ 已合入 main（6968086 → merge d3b6871，审查 approve：research 33/33 + 引擎 141/141，队列校验/去重/分批与晨报四节产物均经真实引擎 e2e） |
| T2.F1 | codex 评审 F1 修复：引擎生命周期加固（基座改动 BC-5） | feature/p2-fix-engine-lifecycle | 停止可中止确定性脚本/进程树清理/输出上限/rerun admission+CAS | ✅ 已合入 main（4626773 + 8a67795 测试超时修复 → merge f9de080；审查通过：deterministic 13/13 + manager 128/128 + tests/server 全量零回归） |
| T2.F2 | codex 评审 F2 修复：客户端契约（基座改动 BC-6） | feature/p2-fix-client-contracts | 未知类型真正无损往返/output_json 类型同步/script runtime 守卫/失败详情 | ✅ 已合入 main（afa98f0 → merge 73c210a；审查 approve：客户端 1498 用例 + vue-tsc + build 绿） |
| **审查B** | 审查员单节点正确性 + **Codex 大阶段评审 1**（引擎集成设计） | — | — | ✅ 通过（2026-09-02 对合并后 main 复审：4 个阻断项全部带代码+测试双重证据关闭，**放行后续阶段**；agent 路径零回归） |

## P3 论文工作台（W8-W10）

| # | 任务 | 分支 | 验收 |
| --- | --- | --- | --- |
| T3.1 | PDF 预览+论文库 UI | feature/p3-T1-pdf | 大 PDF 流式打开 | ✅ 已合入 main（f875b5a → merge 8edddf7，审查 approve：Range 全分支实测 206/416/回退，客户端 1512 绿，零新依赖） |
| T3.2 | pdf2zh sidecar+翻译队列+双语对照（翻译引擎=OpenAI 兼容 API，不跑本地模型） | feature/p3-T2-translate | 一篇真实 PDF 出双语 | ✅ 已合入 main（a0d26b7 → merge 3370009，审查 approve；**真实链路已打通**：conda py3.12 + pdf2zh-next 2.9.0，google 后端真出双语，门控 e2e 实跑 61.6s； argv 契约与 T2.2 模板一致） |
| T3.3 | LaTeX 编辑器+tectonic 编译+实时预览（tectonic 纯编译无模型依赖） | feature/p3-T3-latex | 模板论文编译出 PDF，错误面板定位 | ✅ 已合入 main（311341c → merge fc7f262，审查 approve；**真机 tectonic v0.17.0 实际编译出 PDF**（2.1s），错误解析定位经真实 stderr 验证） |
| **审查C** | 审查员 + **Codex 大阶段评审 2** | — | — | ✅ 通过（2026-09-02 对合并后 main 评审：P1=9 locale 重复 research: 键（T3.3 在分支尾部追加了独立顶层块、git 自动合并所致）→ 已随 T4.1/T4.3 合入修复并经 vue-tsc+locale 测试复验清零；P2=3 个 base 目录新增文件 → 补登记 BC-7；library/index.ts 路由合并与跨工单交互复核通过） |

## P4 RAG + VCP 渲染 + skill 装载（W11-W14）

| # | 任务 | 分支 | 验收 |
| --- | --- | --- | --- |
| T4.1 | paper-qa sidecar+库管理（LLM/embedding 走 API，不本地跑模型） | feature/p4-T1-rag | 建库→索引→问答带引用 | ✅ 已合入 main（7acacb9 → merge 3c81515，审查 approve；**真实 paper-qa 2026.8.12 门控链路实跑 30.3s 通过**；3 个 P2 备忘入打磨清单） |
| T4.2 | 聊天 @知识库 集成 | feature/p4-T2-chat-rag | 聊天中引用溯源展示 | ✅ 已合入 main（d936c31 → merge 49b343b，审查 approve：聊天管线逐 hunk 零回归；纯客户端编排，BC-8 随分支登记；4 个 P2 观察入打磨清单） |
| T4.3 | VCP 渲染层+产物发送到聊天 | feature/p4-T3-vcp | html/svg/mermaid/katex 卡片渲染 | ✅ 已合入 main（c2576cd → merge 9f1f438，审查 approve：sandbox 断言逐行核实；mermaid/katex 本在基座依赖内，零依赖变更；**顺带修复 main 的 9 locale 重复 research: 键问题**） |
| T4.4 | skill 资产装载+绘图工作流 | feature/p4-T4-skills | nature-skills 可被 Agent 调用；绘图工作流出 svg/pptx | ✅ 已合入 main（d825b30 + 4371316 守卫修复 → merge b0dd2b4；审查 request-changes → 修复后复验通过：modified 组合态守卫/SVG 黑名单/pptx 双写均修；**真实 python-pptx 门控链路出 figure.pptx**；零基座改动） |
| **审查D** | 审查员 + **Codex 大阶段评审 3**（整体验收） | — | — | 🔄 进行中（对 P4 合并后 main 评审） |

## P5 打磨

| # | 任务 | 分支 | 验收 |
| --- | --- | --- | --- |
| T5.1 | Playwright 端到端 + 通知集成 | feature/p5-T1-e2e | 关键路径 e2e 绿 | ✅ 已合入 main（3653207 → fb3f0df；新增 4 场景全绿：论文库/LaTeX 错误定位/知识库问答引用/工作流完成通知（基线 Notification stub）；**全量 e2e 136 通过**；顺带修复 2 个 CRLF 敏感既有测试；BC-9 登记） |
| T5.2 | 用户手册（中文）+ 模板编写指南 | feature/p5-T2-docs | 文档评审过 | ✅ 已合入 main（dc896b2 → merge fb3f0df；用户手册 12 章 + 模板编写指南 9 节，事实核对 15+ 点与 main 一致；截图待补为已知限制） |
| **审查D** | 审查员 + **Codex 大阶段评审 3**（整体验收） | — | — | ✅ 通过（2026-09-02 对 P4 合并后 main 评审 + P5 合入后最终回归：research+引擎 268 绿/4 门控、**客户端 1591/1591**、**全量 e2e 139 通过**、边界与 harness 检查通过、build 绿；P4 四工单验收标准逐条满足） |

## 遗留打磨清单（各审查 P2/P3 备忘汇总）

### ✅ 已清（2026-09-02，P6 三张并行工单合入 main 1567e62：709e8b3/ec578c4/8c34b70）

- T2.1c/审查B 引擎侧：rerun JSON-fallback 与 preflight 409 直接测试；controller 层 output_json 响应形状测试；executor 非 Error/持久化失败/行消失/edge evidence 矩阵（含 feedback loop）/多节点并行；POSIX 进程树清理（厘清并记录注释 + POSIX 平台矩阵单测）；canvas 真实挂载补强 3 例；运行时 locale smoke（11 语言 × createI18n 编译）。
- T3.1 论文库：HEAD 不再构造读流（fd 滞留消除）；零字节文件+后缀区间 → 416；by-name/file 补 HEAD；RTL 物理方向改 `inset-inline-end`；API 响应脱敏 file_path（统一走 PaperView 视图）。
- T3.2 翻译队列：exit 兜底改 killOwnedProcessTree 杀树；优雅关停接入基座 additionalShutdownSteps（BC-10）；out_dir 拒绝相对路径（**评估决策**：任意绝对路径保留，注释记录理由）；exit hook 单次安装（跨 resetModules 共享状态）。
- T3.3 LaTeX：启动对账 queued/running → failed（30min 窗口降为兜底）；tectonic `error:` 前缀摘要行解析；stdout/stderr 改 Buffer 分片（UTF-8 跨 chunk 修复）。
- T4.1 RAG：sidecarEnv 改白名单构造（UNRELATED_SECRET 剔除断言）；重启 queued+running 双态清理；客户端轮询 15min 护栏 + 切库/id 不匹配终止；citations paperId 按库成员过滤。
- T4.2 聊天 KB：compositionend 刷新 @ 浮层；15min deadline store 级测试；光标移动后确认的前缀复制修复；轮询瞬时错误容忍 2 次。
- T4.3 VCP：聊天消息 URL 剥 token（paperFilePath 无 token 路径）；两处 iframe 冒泡注释措辞纠正。
- T4.4 Skillpack：profile 参数校验 ∈ 已知名单（list/load/unload 400）。
- 环境（非代码）：CRLF 敏感的两个既有测试已修（message-list-run-started-at、app-connections-panel，随 P5 合入）。

### ✅ P7 用户可感知限制清零（2026-09-03，五张并行工单合入 main 22b703e）

- **聊天知识库问答落服务端历史**（46a190c，BC-11）：服务端编排路由 chat-asks 写入会话历史（基座服务端零改动，经既有 studio/public/sessions 门面），引用按消息 id 从绑定表水合；刷新/换设备可见、引用可点；知识库选择态 localStorage 持久化 + 懒校验失效清理。
- **晨报「下一步建议」自动生成**（cc9b92d）：新增 or-next-steps Agent 节点（5 节点 DAG，菱形补台账直连边），逐行 JSON 契约 + 容错解析；空/客套话回退占位并标注失败，run 不失败。
- **PPTX 映射 v2**（30c4464）：path（M/L/H/V/C/S/Q/T/Z，A 折线近似）、rotate 仿射、渐变代表色、text+tspan 多段落/run；门控真实链路 11/11；stdout 契约只增不破（svgFeaturesMapped/Skipped）。
- **双语对照页服务端代理**（bf4edcb）：新增 run-files 流式端点（允许根=appHome/research+全部工作区；规范化+realpath+大小写不敏感包含性+仅 .pdf，防穿越 10 用例）；pt-bilingual 改服务端 URL 内嵌（token 本机凭据取舍已注记），file:// 降级保留。
- **LaTeX 语法高亮**（f3a8490）：复用既有 hljs latex 语言的 overlay 方案（零新依赖），像素度量单源 + 测试钉死，滚动/错误定位回归全绿，>200KB 降级。

### ✅ P8 骨架页清零（2026-09-03，两张并行工单合入 main）

- **工作流页签 → 流程中心**（34352ec）：模板库（4 个科研模板卡片 → 命名建流 → 深链直达画布）+ 我的流程列表（打开/删除/空态引导）；模板→引擎载荷原样透传（round-trip 已证）。此前该页签是 P1 骨架壳（7 行），完整画布一直在基座 /hermes/workflow。
- **成果页签 → 产物管理页**（ca3070f）：基于 P1 artifacts API 的列表/类型筛选/关键字过滤/预览弹窗（元数据+沙箱 iframe 兼容）/删除（**服务端补 DELETE**，登记行删除、LaTeX PDF 本体仍在 LaTeX 页）/发送到聊天（复用 ArtifactToChatModal）。

### ⏳ 剩余（评估后保留，待后续迭代）

- T3.3：`builds/<uuid>` 产物目录无回收（与 research 模块现状一致，非阻断）。
- T4.3：VCP 卡片高度三档循环无拖拽调高（读影响小）。
- 引擎（审查B 遗留低优先）：validate/render executor 仍为 null（明示阶段性状态）；title-only 契约靠两端约定无共享 schema（阶段接受）。
- RAG：库级增量索引/落盘索引（大库优化，非功能缺陷）。

## 并行策略

- **已完成**：W3（T1.3 artifacts）与 T2.0 spike 双线并行（审查点 B 通过，2026-09-02）；W4 起按「client type 透传+只读防护 → server 存储列 → 引擎分发 → 节点卡片」定序推进
- 模型策略全局 API-first：LLM/embedding/翻译走 API 服务商（复用 Studio provider 配置），不下载本地模型权重；确需下载时 HF_ENDPOINT=hf-mirror.com + HF_HUB_DISABLE_XET=1（已验证可用）
- git worktree 隔离各工单工作区（本仓库放 `.worktrees/`，已 gitignore），避免 Claude Code 实例互踩；worktree 内 node_modules 用 NTFS junction 复用主副本
- sidecar 类任务（T3.2、T4.1）涉及 Python 环境，先做环境验证 spike 再进主干

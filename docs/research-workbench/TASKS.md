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
| **审查D** | 审查员 + **Codex 大阶段评审 3**（整体验收） | — | — | 🔄 进行中（P4 四工单逐条验收 + 跨工单交互核查；P5 合入后一并回归（见下：P2-P5 全部含入最终验证）） |

## 遗留打磨清单（各审查 P2/P3 备忘汇总，P5 后统一处理或随下一迭代）

- T2.1c/审查B 引擎侧：rerun JSON-fallback 与 preflight 409 无直接测试；controller 层 output_json 响应形状测试缺；executor DI 非 Error、持久化失败、edge evidence 矩阵、并行确定性节点未全覆盖；canvas 测试部分仍是源码字符串断言；POSIX 进程树清理无覆盖；运行时 locale smoke 缺。
- T3.1 论文库：HEAD 请求 fd 滞留；零字节文件+后缀区间 500（仅外部篡改可触达）；by-name 无 HEAD；RTL 物理方向 CSS 一处；API 响应含内部 file_path。
- T3.2 翻译队列：exit 兜底为单进程 kill 非杀树；优雅关停未接 stopTranslationQueueWorker；out_dir 无 appHome 约束（本地场景可接受）；测试期 MaxListeners 警告。
- T3.3 LaTeX：重启后悬挂 queued/running 无启动对账（30min 新鲜度窗口兜底）；tectonic rustc 前缀摘要行不参与定位（经典 transcript 兜底）；多字节 UTF-8 跨 chunk 可能切坏；builds 目录无回收。
- T4.1 RAG：sidecarEnv 名实不符（透传实为全环境继承，注释/测试名待改口径）；重启后僵尸 queued 行不清；客户端轮询无界且切库后 pollQuestion 可能卡死（切库+轮询 id 不匹配）；citations paperId 未校验属库（纵深防御）。
- T4.2 聊天 KB：IME 合成结束后 @ 浮层状态不刷新；15min deadline 无 store 级测试；浮层开启时移动光标再确认可致前缀复制；轮询无瞬时错误容错。
- T4.3 VCP：聊天消息内带 token 的论文 URL 建议剥 token（P2）；iframe 点击注释措辞；卡片高度档位无拖拽。
- T4.4 Skillpack：profile 参数未校验 ∈ 已知列表（基座既有行为，建议 facade 统一收紧）。
- 环境（非代码）：主工作树 CRLF 检出导致 3 个既有客户端测试（message-list-run-started-at 等）本地失败，worktree/CI 不受影响，基线 91cd2b9 已如此。

## 并行策略

- **已完成**：W3（T1.3 artifacts）与 T2.0 spike 双线并行（审查点 B 通过，2026-09-02）；W4 起按「client type 透传+只读防护 → server 存储列 → 引擎分发 → 节点卡片」定序推进
- 模型策略全局 API-first：LLM/embedding/翻译走 API 服务商（复用 Studio provider 配置），不下载本地模型权重；确需下载时 HF_ENDPOINT=hf-mirror.com + HF_HUB_DISABLE_XET=1（已验证可用）
- git worktree 隔离各工单工作区（本仓库放 `.worktrees/`，已 gitignore），避免 Claude Code 实例互踩；worktree 内 node_modules 用 NTFS junction 复用主副本
- sidecar 类任务（T3.2、T4.1）涉及 Python 环境，先做环境验证 spike 再进主干

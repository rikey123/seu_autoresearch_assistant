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
| T1.1 | research 服务模块骨架（五子域+路由注册+boundary 文档+checker 绿） | feature/p1-T1-server-skeleton | `node scripts/server-module-boundaries.mjs` 通过；新路由 200 | ✅ 施工完成（3b7ae81），审查点 A 复核中 |
| T1.2 | 前端科研工作台导航+五视图空页+i18n | feature/p1-T2-client-shell | 页面可达，中英文案齐全 | ✅ 施工完成（4156bfc），审查点 A 复核中 |
| T1.3 | artifacts 产物注册表（表+API+预览路由） | feature/p1-T3-artifacts | 建表迁移+API 测试过 | 待审查点 A 通过后启动（W3） |
| **审查A** | 审查员：边界+风格 | — | 出审查报告 | 进行中 |

## P2 确定性工作流（W4-W7，方案 C：复用基座引擎 + 节点扩展）

| # | 任务 | 分支 | 验收 |
| --- | --- | --- | --- |
| T2.0 | 接缝 spike：验证基座引擎扩展点（run-store 容纳非 agent 确定性节点 / rerun 快照行为 / 画布未知节点兜底），产出接缝评估结论，决定主方案（扩展节点）或降级方案（自建执行器+复用基座存储契约） | feature/p2-T0-spike | spike 报告 + 结论入库 docs/research-workbench/ |
| T2.1 | 节点类型扩展 script/validate/render（llm/gate 复用基座既有能力）+ 输入输出 schema 校验 + 基座改动登记表 | feature/p2-T1-engine | 单测覆盖 5 种节点类型；改动集中登记、upstream 可同步 |
| T2.2 | 模板 literature-review + paper-translate（翻译走 API） | feature/p2-T2-templates | 端到端跑通一次（可 mock LLM） |
| T2.3 | 画布适配科研节点（前端，含未知节点兜底） | feature/p2-T3-canvas | 新节点可拖拽配置 |
| T2.4 | overnight-research 批处理模板 | feature/p2-T4-overnight | 队列+晨报 HTML 产物 |
| **审查B** | 审查员单节点正确性 + **Codex 大阶段评审 1**（引擎集成设计） | — | — |

## P3 论文工作台（W8-W10）

| # | 任务 | 分支 | 验收 |
| --- | --- | --- | --- |
| T3.1 | PDF 预览+论文库 UI | feature/p3-T1-pdf | 大 PDF 流式打开 |
| T3.2 | pdf2zh sidecar+翻译队列+双语对照（翻译引擎=OpenAI 兼容 API，不跑本地模型） | feature/p3-T2-translate | 一篇真实 PDF 出双语 |
| T3.3 | LaTeX 编辑器+tectonic 编译+实时预览（tectonic 纯编译无模型依赖） | feature/p3-T3-latex | 模板论文编译出 PDF，错误面板定位 |
| **审查C** | 审查员 + **Codex 大阶段评审 2** | — | — |

## P4 RAG + VCP 渲染 + skill 装载（W11-W14）

| # | 任务 | 分支 | 验收 |
| --- | --- | --- | --- |
| T4.1 | paper-qa sidecar+库管理（LLM/embedding 走 API，不本地跑模型） | feature/p4-T1-rag | 建库→索引→问答带引用 |
| T4.2 | 聊天 @知识库 集成 | feature/p4-T2-chat-rag | 聊天中引用溯源展示 |
| T4.3 | VCP 渲染层+产物发送到聊天 | feature/p4-T3-vcp | html/svg/mermaid/katex 卡片渲染 |
| T4.4 | skill 资产装载+绘图工作流 | feature/p4-T4-skills | nature-skills 可被 Agent 调用；绘图工作流出 svg/pptx |
| **审查D** | 审查员 + **Codex 大阶段评审 3**（整体验收） | — | — |

## P5 打磨

| # | 任务 | 分支 | 验收 |
| --- | --- | --- | --- |
| T5.1 | Playwright 端到端 + 通知集成 | feature/p5-T1-e2e | 关键路径 e2e 绿 |
| T5.2 | 用户手册（中文）+ 模板编写指南 | feature/p5-T2-docs | 文档评审过 |

## 并行策略

- 审查点 A 通过后：W3（T1.3 artifacts）与 P2 T2.0 spike 双线并行；spike 结论出来后 W4-W5 再开工
- 模型策略全局 API-first：LLM/embedding/翻译走 API 服务商（复用 Studio provider 配置），不下载本地模型权重；确需下载时 HF_ENDPOINT=hf-mirror.com + HF_HUB_DISABLE_XET=1（已验证可用）
- git worktree 隔离各工单工作区，避免 Claude Code 实例互踩
- sidecar 类任务（T3.2、T4.1）涉及 Python 环境，先做环境验证 spike 再进主干

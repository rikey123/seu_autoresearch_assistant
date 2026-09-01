# 科研工作台 · 任务拆解与执行看板

> 配套文档：[DESIGN.md](./DESIGN.md)
> 规则：每个任务 = 一个 `feature/pX-TY-*` 分支 = 一个 Claude Code 工单。完成后审查员审，P 阶段收口 Codex 审。

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
| T0.1 | Node 23 环境修正 | 进行中 | 本机 Node22，engines 要求 ≥23 |
| T0.2 | 依赖安装 + 基线构建绿 | 进行中 | `npm ci` → `npm run build` |
| T0.3 | 基线验证：`npm run dev` 起服务 + 冒烟 | 待办 | 记录基线可用状态 |
| T0.4 | 仓库治理：README 项目化、CLAUDE.md 约定、.gitignore 校准 | 设计文档已完成 | docs/research-workbench/DESIGN.md 已入库 |
| T0.5 | 首次 push origin main | 待办 | 建立远端基线 |

## P1 骨架（Claude Code 工单 W1-W3）

| # | 任务 | 分支 | 验收 |
| --- | --- | --- | --- |
| T1.1 | research 服务模块骨架（五子域+路由注册+boundary 文档+checker 绿） | feature/p1-T1-server-skeleton | `node scripts/server-module-boundaries.mjs` 通过；新路由 200 |
| T1.2 | 前端科研工作台导航+五视图空页+i18n | feature/p1-T2-client-shell | 页面可达，中英文案齐全 |
| T1.3 | artifacts 产物注册表（表+API+预览路由） | feature/p1-T3-artifacts | 建表迁移+API 测试过 |
| **审查A** | 审查员：边界+风格 | — | 出审查报告 |

## P2 确定性工作流引擎（W4-W7）

| # | 任务 | 分支 | 验收 |
| --- | --- | --- | --- |
| T2.1 | 节点类型扩展+schema 校验+运行快照 | feature/p2-T1-engine | 单测覆盖 5 种节点类型 |
| T2.2 | 模板 literature-review + paper-translate | feature/p2-T2-templates | 端到端跑通一次（可 mock LLM） |
| T2.3 | 画布适配科研节点（前端） | feature/p2-T3-canvas | 新节点可拖拽配置 |
| T2.4 | overnight-research 批处理模板 | feature/p2-T4-overnight | 队列+晨报 HTML 产物 |
| **审查B** | 审查员单节点正确性 + **Codex 大阶段评审 1**（引擎设计） | — | — |

## P3 论文工作台（W8-W10）

| # | 任务 | 分支 | 验收 |
| --- | --- | --- | --- |
| T3.1 | PDF 预览+论文库 UI | feature/p3-T1-pdf | 大 PDF 流式打开 |
| T3.2 | pdf2zh sidecar+翻译队列+双语对照 | feature/p3-T2-translate | 一篇真实 PDF 出双语 |
| T3.3 | LaTeX 编辑器+tectonic 编译+实时预览 | feature/p3-T3-latex | 模板论文编译出 PDF，错误面板定位 |
| **审查C** | 审查员 + **Codex 大阶段评审 2** | — | — |

## P4 RAG + VCP 渲染 + skill 装载（W11-W14）

| # | 任务 | 分支 | 验收 |
| --- | --- | --- | --- |
| T4.1 | paper-qa sidecar+库管理 | feature/p4-T1-rag | 建库→索引→问答带引用 |
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

- P1 收口后：W4-W5（服务端引擎）与 W8-W9（PDF/翻译，依赖 T1.1/T1.3）双线并行
- git worktree 隔离各工单工作区，避免 Claude Code 实例互踩
- sidecar 类任务（T3.2、T4.1）涉及 Python 环境，先做环境验证 spike 再进主干

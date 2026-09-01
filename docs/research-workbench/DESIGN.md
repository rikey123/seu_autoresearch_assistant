# 科研工作台（seu_autoresearch_assistant）总体设计

> 版本：v0.1（设计稿）
> 日期：2026-09-01
> 基座：EKKOLearnAI/hermes-studio（BSL-1.1，非商业/科研用途可用，2029-05 转 Apache-2.0）
> 代码管理：git（origin=rikey123/seu_autoresearch_assistant，upstream 保留同步基座）

---

## 1. 项目愿景

把 Hermes Studio（多 Agent 桌面/本地运行时/Web 控制台）改造成**一站式科研工作台**：

1. **继承基座**：多 Agent 聊天（Hermes/Claude Code/Codex）、群聊协作、工作流引擎、文件管理、生成物预览、插件机制。
2. **融合科研 skill**：四个开源科研 skill 库（科研绘图 / 学术研究流程 / Nature 科研技能 / ARIS 睡眠科研）统一进驻。
3. **文本流程 → 确定性工作流**：skill 中原本靠自然语言描述的流程（文献综述、画图、审稿式自查等）固化为**可执行、可复现、可中断续跑**的 DAG 工作流，由基座工作流引擎驱动，LLM 只出现在需要智能的节点。
4. **产物可视化与直达聊天**：借鉴 dsh-raw-html 的 VCP 思路 —— 聊天消息中的 HTML/SVG/Mermaid/KaTeX 直接渲染成卡片，产物一键从工作台发回聊天。
5. **论文阅读/翻译/写作闭环**：PDF 预览、LaTeX 预览与编辑、pdf2zh 式学术翻译、paper-qa 本地知识库 RAG。

---

## 2. 基座能力盘点（已确认可复用）

| 基座能力 | 位置 | 对本项目的价值 |
| --- | --- | --- |
| 工作流引擎（可视化 DAG） | `docs/workflow.md`、server workflow 模块 | 确定性工作流的宿主：节点/边/审批门控/调度 |
| 生成文件预览（generated-file previews） | 多 Agent runtime 能力 | 产物预览的原生挂点 |
| HTML 渲染 skill 先例 | `packages/skills/hyperframes`、`markdown-viewer` | VCP 渲染卡片的技术参照 |
| 多编码 Agent 运行时 | `modules/coding-agents`（claude-code/codex/pi） | Claude Code 施工 + Codex 大阶段评审通道 |
| 群聊/多 Agent 协作 | group-chat 模块 | 工作台与聊天室互通的通道 |
| 文件浏览器/上传/终端 | studio files 模块 | 论文库、产物库的底层 |
| 模块边界契约 | `docs/harness/server-module-boundaries.md` | 新模块必须遵守：`routes→controllers→services`，Studio 域用 `/api/studio/*` |

**工程约束**：
- Node ≥ 23（package.json engines）；本机 Node 22 —— 需安装 Node 23（nvm-windows 或直接升级），否则部分依赖类型/运行时不保真。
- 前端 Vue 3 `<script setup>` + Naive UI + Pinia + i18n（中英都要落）。
- 服务器 Koa + Socket.IO + SQLite，状态目录 `~/.hermes-web-ui`（可用环境变量改）。
- 新增服务端顶层模块需同步改 boundary 文档和 checker（`scripts/server-module-boundaries.mjs`）。

---

## 3. 集成资产分析

| 资产 | 形态 | 融合方式 |
| --- | --- | --- |
| scientific-illustrator (icebird1998) | Codex 插件：参考图 → 可编辑 PPTX/draw.io 重绘 | 取其「绘制→检查→修正」循环，做成**绘图工作流**（节点：解析参考图→生成绘图脚本→渲染→AI 自检→修正×N）。桌面自动化部分（操作本机 PowerPoint）在 v1 降级为导出 pptx/drawio/svg 文件，浏览器内预览 |
| academic-research-skills (Imbad0202) | Claude Code 插件，v3.21，全流程学术 pipeline（选题→文献→方法→写作→投稿→integrity gate） | 拆成**科研主线工作流模板**：文献综述、论文结构规划、引用核查、写作质量检查、AI 痕迹自查。其 Stage 2.5/4.5 integrity gate 直接固化为确定性检查节点 |
| nature-skills (Yuan1z0825) | 19 个可复用科研 skill（Claude Code/Codex/Hermes 通用） | 直接作为 Agent 侧 skill 装载（保持 LLM 灵活调用），其中高频流程（如论文精读、图表规范）提取为工作流模板 |
| ARIS (wanshuiyin) | 82 skill 的睡眠科研方法论：设计→执行→自查→报告，含 Anti-Autoresearch 61 信号审计 | 其「过夜自主科研」循环固化为**长时任务工作流**：夜间批量跑实验/文献处理，晨报产出。61 信号审计做成确定性检查节点 |
| dsh-raw-html (plolpl789) | DeepSeek Harness 的 VCP 协议插件：聊天内 HTML/SVG/Mermaid/KaTeX 渲染 + 设计规范 | **借鉴思路重写**：工作台聊天流增加产物卡片渲染层（沙箱 iframe/shadow DOM），agent 输出 ```html 块即渲染；加渲染/美学双开关 |
| pdf2zh-desktop (AaronGIG) | PDFMathTranslate 桌面版：公式/图表/排版保留的学术 PDF 翻译 | 服务端集成 `pdf2zh`（Python）为翻译服务：上传 PDF→翻译→双语对照预览；桌面 GUI 部分不需要 |
| paper-qa (Future-House) | PaperQA2：学术 PDF RAG 问答（PyPI: paper-qa） | 作为**本地知识库引擎**：建库（PDF 目录）→索引→检索问答 API；工作台提供库管理 UI 和聊天集成 |

**skill 布放原则**：
- **Agent skill 层**（`~/.claude/skills`、hermes skills 目录）：nature-skills 原样装载，供 Agent 灵活调用。
- **确定性工作流层**（本仓库新增 `research-workflows` 模块）：从四个库提取的流程 JSON/DSL，可版本管理、可复现、不依赖模型自觉。
- 两层通过「工作流节点内调用 Agent」打通：确定性节点跑脚本/校验，智能节点委托 LLM/Agent。

---

## 4. 总体架构

```
┌────────────────────────── 科研工作台 (fork of hermes-studio) ──────────────────────────┐
│                                                                                       │
│  前端 (Vue3 + Naive UI)                                                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │
│  │ 聊天/群聊 │ │ 工作流    │ │ 论文阅读  │ │ LaTeX    │ │ 知识库RAG │ │ 产物库/预览    │  │
│  │ +VCP卡片 │ │ 画布/运行 │ │ PDF+翻译 │ │ 编辑+预览 │ │ 库管理/问答│ │ HTML/SVG/图表 │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬────────┘  │
│       └────────────┴───── API (/api/studio/*, Socket.IO) ───────┴──────────────┘        │
│                                                                                       │
│  服务端 (Koa + SQLite)  新增 research 模块域                                            │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│  │ modules/research/                                                               │  │
│  │  ├─ workflows/     确定性工作流引擎扩展：模板库、运行器、断点续跑、产物锚点          │  │
│  │  ├─ library/       论文库：PDF 入库、元数据、pdf2zh 翻译任务                       │  │
│  │  ├─ rag/           paper-qa 桥接：库管理、索引、问答、引用溯源                     │  │
│  │  ├─ latex/         LaTeX 编译服务（tectonic/latexmk）、语法校验、模板              │  │
│  │  └─ artifacts/     产物注册表：版本、预览类型、聊天直达引用                        │  │
│  ├─ skills 资产目录 packages/skills/research-*（VCP 渲染、绘图、科研流程模板）          │  │
│  └─ python 侧车（可选 venv）：paper-qa、pdf2zh 以子进程/HTTP sidecar 接入               │  │
│  └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                       │
│  Agent 运行时：Hermes / Claude Code（施工） / Codex（评审+绘图桌面自动化）               │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 确定性工作流引擎（核心增量）

基座已有可视化工作流。我们在其上新增**科研工作流模板层**：

- **模板格式**：JSON DSL（与基座 workflow 兼容），节点类型扩展：
  - `llm`：委托 Agent（带 skill、约束输出格式）
  - `script`：确定性脚本（python/node），输入输出强类型
  - `validate`：确定性校验器（引用存在性、图表编号、integrity 61 信号、LaTeX 可编译）
  - `render`：产物渲染（HTML 卡片/SVG/图表/PDF）
  - `gate`：人工/审查员审批门控（对应小阶段审查）
- **确定性保障**：
  - 节点输入输出 schema 校验，不合规自动重试或失败（不静默继续）
  - 运行快照 SQLite 持久化，断点续跑
  - 每次运行记录 git-like 产物版本，可 diff
- **首批固化流程**（来自 skill 库）：
  1. `literature-review`：检索→筛选→精读（paper-qa）→综述初稿→引用核查→HTML 报告
  2. `paper-illustration`：参考图/数据→绘图脚本→渲染→自检循环→pptx/drawio/svg 产物
  3. `paper-write`：大纲→分节写作→风格校准→质量检查→integrity gate→LaTeX 组装
  4. `overnight-research`：ARIS 式批处理（多任务队列→逐项执行→晨报 HTML）
  5. `paper-translate`：PDF→pdf2zh→双语对照→术语表沉淀

### 4.2 VCP 产物渲染（聊天直达）

- 聊天消息渲染管线（客户端）识别 ` ```html / ```svg / ```mermaid / ```katex ` 块 → 沙箱渲染卡片（iframe sandbox，禁顶层导航，onclick 白名单桥接）
- 「渲染/美学」双开关（用户可控，默认渲染关、美学开——避免渲染撕裂风险，参照 dsh 修复经验）
- 产物注册表联动：卡片带「存入产物库」「发送到工作流」「导出」操作

### 4.3 论文 PDF + 翻译

- PDF.js 流式预览（大文件分片），标注、目录、全文检索（pdf.js text layer）
- 翻译服务：`pdf2zh`（pip）以 Python sidecar 运行（uv venv），翻译任务队列 + 进度推送（Socket.IO），双语对照视图（左右分屏同步滚动）
- Zotero 联动画 v2（pdf2zh 已有 API 思路可借）

### 4.4 LaTeX 预览与编辑

- 编辑器：CodeMirror 6（LaTeX 语法、快捷片段、大纲）
- 编译：优先 tectonic（单二进制、自动装包、无 TeX Live 依赖）；回退 latexmk。编译队列 + 错误定位（synctex 双向跳转 v2）
- 预览：PDF.js 内嵌实时刷新；错误面板行号映射

### 4.5 知识库 RAG（paper-qa）

- 库管理：多库（按课题），PDF 目录扫描入库，索引进度可见
- 问答：聊天内 @知识库 引用，或工作流节点调用；答案强制带引用（paper-qa 原生支持）
- 模型配置：走 Studio 已有 provider 配置；embedding 可切本地 sentence-transformers（GFW 环境用 HF_ENDPOINT=hf-mirror.com）

---

## 5. 数据模型（SQLite 新增表）

- `research_projects`：课题（名称、描述、关联知识库、产物根目录）
- `workflow_templates` / `workflow_runs` / `workflow_node_runs`：模板、运行、节点运行（含 schema 校验结果、产物引用）
- `artifacts`：产物（类型 html/svg/pptx/drawio/pdf/latex/figure、版本、来源 run、预览元数据）
- `papers` / `paper_translations`：论文元数据、翻译任务状态
- `rag_libraries` / `rag_docs`：知识库与文档索引状态
- `chat_artifact_refs`：消息 ↔ 产物引用（聊天直达渲染）

## 6. API 面（新增，全部 `/api/studio/research/*`）

- `POST /workflows/:tpl/run`、`GET /runs/:id`、`POST /runs/:id/resume`
- `POST /library/papers`（上传/URL）、`POST /library/translate`、`GET /translations/:id/status`
- `POST /rag/libraries`、`POST /rag/query`
- `POST /latex/compile`、`GET /latex/jobs/:id`
- `POST /artifacts`、`GET /artifacts/:id/preview`、`POST /artifacts/:id/to-chat`
- Socket.IO 通道：`research:run-progress`、`research:translate-progress`、`research:latex-log`

## 7. 非功能

- **安全**：Python sidecar 子进程隔离；HTML 卡片 iframe sandbox；上传 PDF 病毒扫描不做但限制大小/类型
- **性能**：PDF 流式；RAG 索引后台队列；编译并行上限 2
- **i18n**：中英双语全量
- **可回滚**：所有新模块独立目录 + feature 分支，upstream 同步不冲突

---

## 8. 阶段划分与子任务（git 分支即任务单元）

### P0 地基（main 直接推进）
- T0.1 环境修正：Node 23 安装、依赖安装、`npm run build` 绿、`npm run dev` 起服务、基座测试通过（基线快照）
- T0.2 仓库治理：CLAUDE.md/AGENTS.md 补充项目约定、`.gitignore` 校准、README 项目化改写、第一次 push origin main

### P1 骨架（feature/p1-*）
- T1.1 research 服务模块骨架（workflows/library/rag/latex/artifacts 五目录 + 路由注册 + boundary 文档更新 + checker 通过）
- T1.2 前端「科研工作台」导航区 + 路由 + 空页面（五视图）+ i18n
- T1.3 产物注册表 artifacts：表、API、预览路由（复用基座 preview）
- **审查点 A**（审查员）：模块边界 + 代码风格

### P2 确定性工作流引擎（feature/p2-*）
- T2.1 节点类型扩展（llm/script/validate/render/gate）+ schema 校验 + 运行快照持久化
- T2.2 模板：literature-review + paper-translate（首个端到端可跑）
- T2.3 工作流画布适配科研节点类型（前端）
- T2.4 overnight-research 批处理模板
- **审查点 B**（审查员）：单节点正确性；**大阶段审查 1**（Codex）：引擎设计评审

### P3 论文工作台（feature/p3-*）
- T3.1 PDF 预览（pdf.js）+ 论文库 UI + 元数据管理
- T3.2 pdf2zh sidecar 集成 + 翻译任务队列 + 双语对照视图
- T3.3 LaTeX 编辑器（CodeMirror6）+ tectonic 编译服务 + 错误面板 + PDF 实时预览
- **审查点 C**（审查员）；**大阶段审查 2**（Codex）

### P4 RAG + VCP 渲染（feature/p4-*）
- T4.1 paper-qa sidecar + 库管理 API/UI + 索引进度
- T4.2 聊天 @知识库 问答集成（引用溯源展示）
- T4.3 VCP 聊天渲染层（html/svg/mermaid/katex 沙箱卡片 + 双开关）+ 产物「发送到聊天」
- T4.4 skill 资产装载（nature-skills 全量 + ARIS/ARS 精选 → Agent skill 目录）+ 绘图工作流（scientific-illustrator 确定性化）
- **审查点 D**（审查员）；**大阶段审查 3**（Codex）：整体验收

### P5 打磨
- T5.1 端到端测试（Playwright，复用基座基建）+ 晨报/通知集成（hermes send）
- T5.2 文档：用户手册（中文）、工作流模板编写指南
- **最终验收**（admin）

**并行策略**：P1 完成后，T2.x（服务端）与 T3.1/T3.2（前端+sidecar）可双线并行；git worktree 隔离，Claude Code 各领一个分支。

## 9. 协作与质量门禁

- 每个子任务：`feature/pX-TY` 分支 → Claude Code 施工 → 自测（lint+相关测试）→ 小阶段 PR → **审查员**审 → 合入 main
- 每个 P 阶段合入前：`codex exec` 大阶段评审（架构/安全/可维护性），意见回炉
- 提交规范：`feat(research): ...` / `fix(research): ...`；每任务一 PR，rebase main
- 基线保护：upstream 同步分支 `upstream/main` 定期 rebase 检查冲突面

## 10. 风险与对策

| 风险 | 对策 |
| --- | --- |
| Node 22 vs 要求 ≥23 | P0 先装 Node 23（nvm-windows）；CI 里同样锁 23 |
| pdf2zh/paper-qa 是 Python 生态，与 TS 服务端混布 | Python sidecar（独立 venv + HTTP/子进程），失败可降级（翻译/RAG 功能标记不可用，不阻塞主程序） |
| GFW：HF 模型下载 | HF_ENDPOINT=hf-mirror.com + HF_HUB_DISABLE_XET=1（已在环境验证过） |
| BSL-1.1 许可证 | 仅科研/教育自用，不分发商业版本；LICENSE 与 NOTICE 保留 |
| skill 文本流程确定性化不失真 | 每个模板带来源引用（哪个 skill 的哪节），审查员比对语义 |
| 上游更新冲突 | 新代码全部在新模块/新目录；改基座文件集中登记（boundary 文档、router、i18n index 等） |

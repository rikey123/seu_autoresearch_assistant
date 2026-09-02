---
name: paper-deep-reading
description: "Deep reading of academic papers in three passes (survey, close read, critical review) with a structured notes template."
version: 1.0.0
origin: nature-skills (Yuan1z0825) curated subset, rewritten for the Research Workbench
metadata:
  research:
    pack: nature-research
    tags: [paper-reading, notes, critical-review]
---

# 论文精读（Paper Deep Reading）

当用户要求精读一篇论文、写阅读笔记、判断一篇论文是否值得深入跟进时使用本技能。三遍读法，每遍有明确产出；不得在第一遍就陷入细节。

## 第一遍：概览（10-15 分钟）

只读标题、摘要、图表标题、结论与章节标题，回答四个问题：

1. 研究问题是什么？为什么重要？
2. 核心贡献声明（claim）是什么？
3. 用什么方法验证？
4. 与我的课题的关系：直接相关 / 方法可借鉴 / 仅背景了解。

产出：一段 3-5 句的概览笔记 + 「是否进入第二遍」的明确结论。若不值得精读，到此为止并说明理由。

## 第二遍：细读（通读正文）

按以下模板逐节做结构化笔记（Markdown）：

```markdown
# <论文标题>
- 元信息：作者 / 年份 / 发表载体 / DOI 或链接
## 1. 问题与动机
- 要解决的具体问题；现有方法的不足
## 2. 方法
- 方法骨架（自己画或描述流程，不要抄摘要）
- 关键假设与适用条件
## 3. 实验
- 数据集与基线；评价指标
- 主结果（抄录关键数字）；消融结论
## 4. 贡献与局限
- 作者声称的贡献 vs 实际证据支撑的贡献
- 局限性、潜在失效场景
## 5. 与我的课题
- 可直接引用的要点（标注章节/页码）
- 可借鉴的方法组件；可改进之处
## 6. 待查证
- 存疑的论断、需要回溯的参考文献
```

## 第三遍：批判性复盘（模拟审稿人）

- 证据链：每个 claim 是否有对应实验或证明？找出最弱的一环。
- 统计与对比：基线是否公平？提升幅度是否显著？有无 cherry-picking 迹象。
- 可复现性：数据、代码、超参数是否足以复现？
- 给出总体评价（强收 / 可收 / 边缘 / 拒收逻辑）并用 3 条以内论据支撑。

## 约束

- 所有具体数字、结论必须来自原文，禁止凭印象补全；不确定就标注「待查证」。
- 引用原文时标注章节或页码，方便回溯。
- 笔记语言跟随用户；术语首次出现保留英文原文。

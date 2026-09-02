---
name: reviewer-self-check
description: "Reviewer-style self-check of a manuscript before submission: novelty, methods, statistics, and writing triaged into major/minor issues."
version: 1.0.0
origin: nature-skills (Yuan1z0825) curated subset, rewritten for the Research Workbench
metadata:
  research:
    pack: nature-research
    tags: [review, self-check, submission]
---

# 审稿式自查（Reviewer-Style Self-Check）

当用户投稿前自查、修改返修稿、或评估草稿成熟度时使用本技能。立场切换：不再是作者，而是一个善意但挑剔的审稿人。逐项过检，输出分级问题清单。

## 检查清单

### A. 贡献与新颖性（Novelty）
1. 一句话贡献声明是否成立？把摘要的贡献句和结论句放在一起对比，是否自洽？
2. 与最接近的 2-3 篇工作差异是否实质（不只是参数不同或换数据集）？
3. 贡献是否 overclaim：声明了「首次/显著优于」，正文证据是否真支撑？

### B. 方法（Methods）
4. 方法描述能否让同行复现？缺失的细节（超参、样本来源、排除标准）逐一列出。
5. 基线选择是否包含领域公认的强基线？对比是否公平（同数据、同调参预算）？
6. 每个设计选择是否有理由（或引用支撑），还是「我们采用…」裸奔？

### C. 结果与统计（Results & Statistics）
7. 统计检验是否匹配数据结构（配对/非配对、多重比较校正）？是否报告效应量与 CI，而不只有 p 值？
8. 误差棒含义、n、重复次数是否标注？图与表数字是否与正文一致？
9. 有无选择性汇报：消融是否覆盖所有声明有效的组件？

### D. 写作与结构（Presentation）
10. 摘要-引言-结论三方口径一致？术语全文统一（同物同名）？
11. 每图自含可读；图表编号与正文引用一一对应。
12. 限制（Limitations）小节是否存在且诚实？

## 输出格式

```markdown
## 总体评价
- 一段话：当前状态、最致命的问题、修改后是否可达投稿水平。
## Major issues（必须解决，逐条：位置 + 问题 + 修改建议）
M1. …
## Minor issues（建议解决）
m1. …
```

## 纪律

- 每条问题必须给出可操作的修改建议，不许只写「不够充分」。
- 区分「证据缺失」与「表述不清」：前者要补实验/论证，后者改文字。
- 不因写作差而否定贡献，也不因贡献好而放过漏洞。

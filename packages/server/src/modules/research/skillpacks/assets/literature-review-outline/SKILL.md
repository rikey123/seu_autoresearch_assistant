---
name: literature-review-outline
description: "Thematic literature review outline template with a synthesis matrix, comparison dimensions, and citation discipline."
version: 1.0.0
origin: nature-skills (Yuan1z0825) curated subset, rewritten for the Research Workbench
metadata:
  research:
    pack: nature-research
    tags: [literature-review, outline, synthesis]
---

# 文献综述提纲（Literature Review Outline）

当用户要写综述、开题报告的文献部分、Related Work 章节时使用本技能。核心纪律：按主题组织，不按论文罗列。

## 提纲模板（主题式）

```markdown
# <主题> 文献综述
## 1. 引言
- 背景与研究问题；综述范围（时间窗、文献类型）与检索口径
## 2. 主题 A：<子领域一>
- A.1 主流方法与共识
- A.2 分歧点与争论
## 3. 主题 B：<子领域二>
- B.1 / B.2 同上
## 4. 方法论对比（跨主题）
- 对比矩阵：方法 × {数据需求, 可解释性, 性能上限, 成本}
## 5. 开放问题与未来方向
- 从分歧点与对比矩阵推导，不另起炉灶
## 6. 参考文献
```

## 综合矩阵（写作前的必做步骤）

把入选文献填入矩阵，行=文献，列=对比维度；空白格就是「该方向没人做」的证据，直接喂给第 5 节。

| 文献 | 方法 | 数据/对象 | 核心结论 | 局限 |
| --- | --- | --- | --- | --- |

## 写作纪律

- 每段一个论点，段首句给结论；论点后紧跟支撑文献 [n]，一段至少两篇互证或对比。
- 综述句式区分强度：「X 证明…（[1][2]）」强于「X 认为…」；转述不得夸大原文结论。
- 冲突结果不回避：明确写出谁与谁矛盾、可能原因（样本/方法/口径差异）。
- 引用编号与参考文献表一一对应；只引读过正文（或至少摘要）的文献。

## 自查（交稿前）

1. 删掉每段的「论文 A 做了…论文 B 做了…」流水账，改为按结论组织。
2. 每个主题节末尾有一句「小结」：该主题的共识与缺口。
3. 时间窗内的高被引与近两年代表作是否覆盖；检索式可复现。

---
name: figure-standards
description: "Journal figure specifications: column widths, font sizes, stroke weights, colorblind-safe palettes, and export formats."
version: 1.0.0
origin: nature-skills (Yuan1z0825) curated subset, rewritten for the Research Workbench
metadata:
  research:
    pack: nature-research
    tags: [figures, journals, formatting]
---

# 图表规范（Figure Standards）

当用户制作或检查投稿图表（单栏/双栏图、图形摘要）时使用本技能。目标：图表在任何印刷/屏幕尺寸下可读、色盲友好、风格统一。

## 尺寸（以 Nature 系列 / 通用双栏刊为例）

- 单栏图宽 89 mm（约 3.5 in），双栏图宽 183 mm（约 7.2 in），最大高度 247 mm。
- 同一图内面板（a/b/c…）尺寸尽量一致；面板标签放左上角，加粗无句点。
- 位图：≥300 dpi（彩色）/ ≥600 dpi（线条图）；矢量优先（SVG/PDF/EPS）。

## 字体与字号

- 无衬线字体（Arial/Helvetica）；正文字号 5-7 pt（缩放后实际印刷尺寸下量取）。
- 轴标题含单位，格式「Quantity (unit)」；轴刻度标签字号 ≤ 轴标题。
- 图内文字总量最小化：能用图例说明的不塞进图内。

## 线条与配色

- 轴线与刻度 0.5-0.75 pt；数据线 1-1.5 pt；避免网格线抢视觉，必要时用浅灰虚线。
- 色板必须色盲安全（避开红绿并行），推荐：
  - 定性：Okabe-Ito（#E69F00、#56B4E9、#009E73、#F0E442、#0072B2、#D55E00、#CC79A7、#000000）
  - 顺序：viridis / cividis。
- 同一含义在全文所有图中使用同一颜色；黑白打印仍可区分（线型/填充纹理兜底）。

## 图元与图表类型选型

- 比较类别量 → 柱状；趋势 → 折线；两变量关系 → 散点；分布 → 箱线/小提琴（叠加原始点）。
- 误差棒必须注明含义（SD/SEM/95%CI）与 n；坐标轴不从非零开始的柱状图必须显式标注。
- 每个图元有文字可及：色盲用户与灰度打印下仍能对应图例。

## 投稿前自查清单

1. 尺寸与目标栏宽一致；缩放到 100% 印刷尺寸后最小字号 ≥ 5 pt。
2. 图题（caption）自含：图能脱离正文被读懂；缩写已在 caption 中展开。
3. 矢量源文件 + 高分辨率位图各一份；嵌入字体转曲或内嵌。
4. 面板标签、图例、坐标轴与正文引用一一对应，无「下图/如上所示」。

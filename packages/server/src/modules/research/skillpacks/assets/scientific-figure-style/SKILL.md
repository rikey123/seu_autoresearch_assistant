---
name: scientific-figure-style
description: "Draw-to-check-to-fix loop for scientific illustrations plus the standalone SVG output conventions used by the figure-drawing workflow."
version: 1.0.0
origin: nature-skills (Yuan1z0825) subset + scientific-illustrator loop, rewritten for the Research Workbench
metadata:
  research:
    pack: nature-research
    tags: [figures, svg, drawing-loop]
---

# 科研绘图规范（Scientific Figure Style）

当用户/工作流要求生成科研示意图、数据图、机制图时使用本技能。核心是「绘制→检查→修正」循环 + 固定的 SVG 输出约定（供下游确定性渲染节点落盘）。

## 绘制→检查→修正循环

1. **绘制（Draw）**：先定信息结构——这张图要让读者在 10 秒内看懂什么？据此选图形类型与布局，再动手。
2. **检查（Check）**：逐项过检——
   - 信息保真：每个数据点/连接关系与输入数据一致，无臆造；
   - 文字完整：标题、轴标签（含单位）、图例、数据标签齐全且无截断；
   - 几何合法：无元素越出画布、无重叠遮挡、柱高与数值成比例；
   - 风格统一：同一含义同一颜色，色盲安全色板。
3. **修正（Fix）**：只改检查出问题的元素，不推翻重画；修正后重跑检查，至多两轮。

## SVG 输出约定（必须严格遵守）

- 输出**且仅输出一个** ` ```svg ` 围栏代码块，块内是完整的独立 `<svg>...</svg>` 源码；围栏外不得有任何解释文字。
- 根元素必须带 `width`、`height` 与 `viewBox`，默认画布 900×560，背景一个全幅 `<rect fill="#ffffff">`。
- 只允许使用这些图元：`rect`、`circle`、`ellipse`、`line`、`polyline`、`polygon`、`path`（简单直线/折线段）、`text`、`g`（仅 transform 平移/缩放）。**禁止** `<script>`、`<foreignObject>`、外部字体/图片/网络引用、CSS 动画。
- 文字用 `<text>` 的 `x/y/font-size/fill/text-anchor` 属性；标题 font-size ≥ 22，轴标签 ≥ 16，数据标签 ≥ 14；字号单位用 px。
- 数值映射要正确：柱高/折线点坐标按给定数据线性换算（先算出像素比例再写死坐标），柱间留白 ≥ 柱宽的 50%。
- 色板用 Okabe-Ito：主色 #0072B2，强调 #D55E00，次强调 #009E73，辅助 #56B4E9，警示 #E69F00，文字/轴线 #1f2430 / #6b7280。
- 数据图的坐标轴：两条 1.5px 直线（#1f2430），刻度用短线段；误差棒、网格线可用 0.75px 浅灰 #d7dde8。

## 常见图形类型速查

- 柱状：比较类别量；柱状 + 误差棒表示变异。
- 折线：有序趋势；多条线每条一个颜色并直接在线尾标注系列名。
- 散点：两变量关系；可加趋势线（虚线）。
- 示意图/流程：框（rect 圆角 rx=8）+ 箭头（line + polygon 箭头头部），左→右或上→下单一主流向。

## 自检输出（工作流外使用时）

修改性输出直接给完整 SVG；对话式使用时在代码块后追加「自检记录」：列出检查项与修正点（工作流内禁止追加）。

// Registered deterministic research workflow templates. The templates stay in
// the research domain (the Studio engine exposes no template-registration API)
// and every node/edge here is stored in the exact shape the engine's
// normalize functions return, so a template can be instantiated as a Studio
// workflow without any transformation.
import {
  agentTemplateNode,
  scriptTemplateNode,
  templateEdge,
  type ResearchWorkflowTemplate,
} from './template-contract'

// Script bodies are String.raw blocks: the deterministic executor runs them as
// `node -e` processes, so guest code must avoid template literals and shell
// string building entirely — subprocess arguments are always structured arrays.
//
// The engine wraps every node input as "[Workflow upstream results]",
// "[Upstream: <title>]", and "[Current task]" sections (plus the placeholder
// task line for nodes without authored input). Every template script strips
// those wrapper lines before parsing a bare path/JSON payload, so the engine
// packaging never leaks into node output.
const ENGINE_WRAPPER_HELPERS = String.raw`function stripEngineWrapperLines(text) {
  return text.split(/\r?\n/).filter(function (line) {
    var trimmed = line.trim();
    if (trimmed === '[Workflow upstream results]') return false;
    if (trimmed === '[Current task]') return false;
    if (trimmed === 'Execute the current workflow node.') return false;
    if (trimmed.indexOf('[Upstream:') === 0 && trimmed.slice(-1) === ']') return false;
    return true;
  }).join('\n').trim();
}
function parseJsonPayload(text) {
  try { return JSON.parse(text); } catch (error) {}
  var start = text.indexOf('{');
  var end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch (error) {}
  }
  return null;
}
`

const LR_HTML_REPORT_CODE = String.raw`'use strict';
${ENGINE_WRAPPER_HELPERS}var rawInput = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', function (chunk) { rawInput += chunk; });
process.stdin.on('end', function () {
  var source = stripEngineWrapperLines(rawInput);
  if (!source) {
    console.error('html report node received no draft input');
    process.exit(1);
  }
  function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function inlineMarkdown(text) {
    var html = escapeHtml(text);
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
    return html;
  }
  var htmlLines = [];
  var listStack = [];
  var inParagraph = false;
  function closeParagraph() {
    if (inParagraph) { htmlLines.push('</p>'); inParagraph = false; }
  }
  function closeLists() {
    while (listStack.length) { htmlLines.push('</' + listStack.pop() + '>'); }
  }
  var sourceLines = source.split(/\r?\n/);
  for (var i = 0; i < sourceLines.length; i++) {
    var line = sourceLines[i];
    var heading = line.match(/^(#{1,6})\s+(.*)$/);
    var bullet = line.match(/^\s*[-*]\s+(.*)$/);
    var ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    var blockquote = line.match(/^>\s?(.*)$/);
    var rule = line.match(/^\s*(?:-{3,}|\*{3,})\s*$/);
    if (rule) {
      closeParagraph(); closeLists();
      htmlLines.push('<hr />');
    } else if (heading) {
      closeParagraph(); closeLists();
      htmlLines.push('<h' + heading[1].length + '>' + inlineMarkdown(heading[2]) + '</h' + heading[1].length + '>');
    } else if (bullet) {
      closeParagraph();
      if (listStack[listStack.length - 1] !== 'ul') { closeLists(); listStack.push('ul'); htmlLines.push('<ul>'); }
      htmlLines.push('<li>' + inlineMarkdown(bullet[1]) + '</li>');
    } else if (ordered) {
      closeParagraph();
      if (listStack[listStack.length - 1] !== 'ol') { closeLists(); listStack.push('ol'); htmlLines.push('<ol>'); }
      htmlLines.push('<li>' + inlineMarkdown(ordered[1]) + '</li>');
    } else if (blockquote) {
      closeParagraph(); closeLists();
      htmlLines.push('<blockquote><p>' + inlineMarkdown(blockquote[1]) + '</p></blockquote>');
    } else if (!line.trim()) {
      closeParagraph(); closeLists();
    } else {
      if (listStack.length) { closeLists(); }
      if (!inParagraph) { htmlLines.push('<p>'); inParagraph = true; } else { htmlLines.push('<br />'); }
      htmlLines.push(inlineMarkdown(line.trim()));
    }
  }
  closeParagraph();
  closeLists();
  var bodyHtml = htmlLines.join('\n');
  var titleMatch = source.match(/^#\s+(.+)$/m);
  var reportTitle = titleMatch ? titleMatch[1].trim() : 'Literature Review Report';
  var document = '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8" />\n<title>'
    + escapeHtml(reportTitle) + '</title>\n<style>\n'
    + 'body { font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; max-width: 860px; margin: 40px auto; padding: 0 24px; line-height: 1.7; color: #1f2430; }\n'
    + 'h1, h2, h3 { line-height: 1.3; }\n'
    + 'blockquote { border-left: 3px solid #c9d2e0; margin: 0; padding-left: 16px; color: #4a5568; }\n'
    + 'hr { border: 0; border-top: 1px solid #e2e8f0; margin: 28px 0; }\n'
    + '</style>\n</head>\n<body>\n' + bodyHtml + '\n</body>\n</html>';
  process.stdout.write(JSON.stringify({ format: 'html', title: reportTitle, bytes: document.length, document: document }));
});`

const PT_PDF_INTAKE_CODE = String.raw`'use strict';
${ENGINE_WRAPPER_HELPERS}var rawInput = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', function (chunk) { rawInput += chunk; });
process.stdin.on('end', function () {
  var fs = require('node:fs');
  var path = require('node:path');
  var text = stripEngineWrapperLines(rawInput);
  if (!text) {
    console.error('pdf intake node received no input: pass JSON {"pdfPath": "..."} or an absolute PDF path');
    process.exit(1);
  }
  var pdfPath = text;
  var parsed = parseJsonPayload(text);
  if (parsed && typeof parsed.pdfPath === 'string') pdfPath = parsed.pdfPath;
  else if (parsed && typeof parsed.path === 'string') pdfPath = parsed.path;
  pdfPath = pdfPath.trim();
  if (!path.isAbsolute(pdfPath)) {
    console.error('pdfPath must be an absolute path, received: ' + pdfPath);
    process.exit(1);
  }
  var stat = null;
  try {
    stat = fs.statSync(pdfPath);
  } catch (error) {
    console.error('PDF file not found: ' + pdfPath);
    process.exit(1);
  }
  if (!stat.isFile()) {
    console.error('pdfPath is not a regular file: ' + pdfPath);
    process.exit(1);
  }
  var header = Buffer.alloc(5);
  var fd = fs.openSync(pdfPath, 'r');
  fs.readSync(fd, header, 0, 5, 0);
  fs.closeSync(fd);
  if (header.toString('ascii') !== '%PDF-') {
    console.error('file is not a PDF (missing %PDF- header): ' + pdfPath);
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({ pdfPath: pdfPath, fileName: path.basename(pdfPath), bytes: stat.size }));
});`

// Translation node: API-first. pdf2zh (-s openai) drives translation through an
// OpenAI-compatible HTTP endpoint; nothing is downloaded and no local model is
// executed. The child process is spawned with a structured argv array and
// shell:false — never a concatenated shell command string. PAPER_TRANSLATE_PDF2ZH_BIN
// may point at a native binary or at a Node wrapper script (.js/.cjs/.mjs).
const PT_TRANSLATE_CODE = String.raw`'use strict';
${ENGINE_WRAPPER_HELPERS}var rawInput = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', function (chunk) { rawInput += chunk; });
process.stdin.on('end', function () {
  var fs = require('node:fs');
  var path = require('node:path');
  var cp = require('node:child_process');
  var parsed = parseJsonPayload(stripEngineWrapperLines(rawInput));
  var pdfPath = parsed && typeof parsed.pdfPath === 'string' ? parsed.pdfPath : '';
  if (!pdfPath) {
    console.error('translate node expects JSON {"pdfPath": "..."} from the intake node');
    process.exit(1);
  }
  var apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey) {
    console.error('OPENAI_API_KEY is not configured in the server environment; set it to an OpenAI-compatible translation endpoint key (API-first only, no local models)');
    process.exit(1);
  }
  var baseUrl = process.env.OPENAI_BASE_URL || '';
  var model = process.env.OPENAI_MODEL || '';
  var targetLang = process.env.PAPER_TRANSLATE_TARGET_LANG || 'zh';
  var pdf2zhBin = process.env.PAPER_TRANSLATE_PDF2ZH_BIN || 'pdf2zh';
  var outDir = path.join(path.dirname(pdfPath), 'paper-translate-out');
  fs.mkdirSync(outDir, { recursive: true });
  var args = ['-i', pdfPath, '-o', outDir, '-s', 'openai', '-lo', targetLang];
  var spawnBin = pdf2zhBin;
  if (/\.(?:js|cjs|mjs)$/i.test(pdf2zhBin)) {
    // The configured bin is a Node wrapper script: execute it with the current
    // Node runtime. Still a structured argv array and shell:false — the exact
    // same argv contract as the native pdf2zh binary.
    spawnBin = process.execPath;
    args = [pdf2zhBin].concat(args);
  }
  var childEnv = Object.assign({}, process.env, { OPENAI_API_KEY: apiKey });
  if (baseUrl) { childEnv.OPENAI_BASE_URL = baseUrl; }
  if (model) { childEnv.OPENAI_MODEL = model; }
  var child = cp.spawn(spawnBin, args, {
    cwd: path.dirname(pdfPath),
    shell: false,
    windowsHide: true,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  var stdoutText = '';
  var stderrText = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', function (chunk) { stdoutText += chunk; });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', function (chunk) { stderrText += chunk; });
  process.on('exit', function () {
    try { child.kill('SIGKILL'); } catch (error) {}
  });
  child.on('error', function (error) {
    console.error('failed to spawn "' + pdf2zhBin + '": ' + error.message
      + ' | install the pdf2zh CLI manually (e.g. "pip install pdf2zh"); this script never downloads tools or models by itself');
    process.exit(1);
  });
  child.on('close', function (code) {
    if (code !== 0) {
      var detail = (stderrText.trim() || stdoutText.trim() || 'no output').split('\n').slice(-5).join('\n');
      console.error('pdf2zh exited with code ' + code + ': ' + detail);
      process.exit(1);
    }
    var stem = path.basename(pdfPath).replace(/\.pdf$/i, '');
    var monoPath = path.join(outDir, stem + '-mono.pdf');
    var dualPath = path.join(outDir, stem + '-dual.pdf');
    if (!fs.existsSync(monoPath) || !fs.existsSync(dualPath)) {
      console.error('pdf2zh finished but expected outputs are missing in ' + outDir
        + ' (looked for ' + stem + '-mono.pdf and ' + stem + '-dual.pdf)');
      process.exit(1);
    }
    process.stdout.write(JSON.stringify({
      pdfPath: pdfPath,
      monoPath: monoPath,
      dualPath: dualPath,
      outDir: outDir,
      targetLang: targetLang,
      service: 'openai',
    }));
  });
});`

const PT_BILINGUAL_CODE = String.raw`'use strict';
${ENGINE_WRAPPER_HELPERS}var rawInput = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', function (chunk) { rawInput += chunk; });
process.stdin.on('end', function () {
  var fs = require('node:fs');
  var path = require('node:path');
  var payload = parseJsonPayload(stripEngineWrapperLines(rawInput));
  if (!payload || typeof payload.pdfPath !== 'string' || typeof payload.monoPath !== 'string' || typeof payload.dualPath !== 'string') {
    console.error('bilingual node expects JSON {"pdfPath","monoPath","dualPath"} from the translate node');
    process.exit(1);
  }
  var keys = ['pdfPath', 'monoPath', 'dualPath'];
  for (var i = 0; i < keys.length; i++) {
    if (!fs.existsSync(payload[keys[i]])) {
      console.error('missing file for ' + keys[i] + ': ' + payload[keys[i]]);
      process.exit(1);
    }
  }
  function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function toFileUri(filePath) {
    return 'file:///' + filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  }
  function pane(label, filePath) {
    return '<section><h2>' + escapeHtml(label) + '</h2><iframe src="' + toFileUri(filePath)
      + '" style="width:100%;height:78vh;border:1px solid #d7dde8;border-radius:8px;"></iframe></section>';
  }
  var fileName = path.basename(payload.pdfPath);
  var html = '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8" />\n<title>'
    + escapeHtml(fileName) + ' 双语对照</title>\n<style>\n'
    + 'body { font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; margin: 24px; color: #1f2430; }\n'
    + 'h1 { font-size: 20px; }\n'
    + '.panes { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }\n'
    + '@media (max-width: 1100px) { .panes { grid-template-columns: 1fr; } }\n'
    + '</style>\n</head>\n<body>\n'
    + '<h1>' + escapeHtml(fileName) + ' 双语对照</h1>\n'
    + '<div class="panes">\n' + pane('原文', payload.pdfPath) + '\n' + pane('译文', payload.monoPath) + '\n</div>\n'
    + '<p>交错双语版（逐页对照）：<code>' + escapeHtml(payload.dualPath) + '</code></p>\n'
    + '</body>\n</html>';
  var htmlPath = path.join(path.dirname(payload.pdfPath), 'paper-bilingual.html');
  fs.writeFileSync(htmlPath, html, 'utf8');
  process.stdout.write(JSON.stringify({
    bilingualHtmlPath: htmlPath,
    original: payload.pdfPath,
    translated: payload.monoPath,
    dual: payload.dualPath,
  }));
});`

function nodePosition(index: number): { x: number; y: number } {
  return { x: 80 + index * 320, y: 120 }
}

const literatureReview: ResearchWorkflowTemplate = {
  id: 'literature-review',
  name: '文献综述',
  description: '检索→筛选→精读→综述初稿→引用核查→HTML 报告的科研工作流模板；agent 节点负责理解与写作，script 节点确定性地产出 HTML 报告。',
  profile: 'default',
  steps: ['文献检索', '文献筛选', '精读', '综述初稿', '引用核查', 'HTML 报告'],
  nodes: [
    agentTemplateNode({
      id: 'lr-search',
      title: '文献检索',
      position: nodePosition(0),
      input: [
        '你是文献检索助手。给定研究主题（见上游输入；若上游为空则把工作流输入视为主题），检索并汇总最相关的学术文献。',
        '要求：',
        '1. 覆盖近 5 年代表作与经典奠基文献，合计 15-30 篇。',
        '2. 每篇给出：编号 [n]、标题、作者、年份、发表载体、链接（DOI 或 URL）、一句话摘要。',
        '3. 优先使用可用的检索工具（联网搜索、学术数据库技能）；无法联网时明确标注"待补充来源"，不得编造文献。',
        '4. 输出为 Markdown 列表，并在末尾用一小节说明检索策略（关键词、数据源、筛选口径）。',
      ].join('\n'),
    }),
    agentTemplateNode({
      id: 'lr-screen',
      title: '文献筛选',
      position: nodePosition(1),
      input: [
        '你是文献筛选助手。上游输入是候选文献列表。按以下标准逐篇筛选：',
        '纳入标准：与主题直接相关；有明确方法与结论；来源可信（期刊/会议/预印本）。',
        '排除标准：与已入选文献高度重复；无法获取正文或摘要；质量存疑。',
        '输出：',
        '1. "入选文献"清单（保留原编号 [n] 与元数据）。',
        '2. "落选文献"清单，每篇一句话落选原因。',
        '3. 若入选不足 8 篇，在末尾给出补充检索建议。',
        '不得虚构或改写文献元数据。',
      ].join('\n'),
    }),
    agentTemplateNode({
      id: 'lr-read',
      title: '精读',
      position: nodePosition(2),
      input: [
        '你是精读助手。对上游入选文献逐篇精读，输出结构化阅读笔记。每篇包含：',
        '1. 研究问题与动机',
        '2. 方法与实验设计',
        '3. 核心结果与贡献',
        '4. 局限性与开放问题',
        '5. 与本综述主题的关联（可直接引用的要点）',
        '若上游带有链接或全文，可用可用工具获取并阅读原文；无法获取全文时基于摘要并标注"基于摘要"。保留文献编号 [n] 以便后续引用。',
      ].join('\n'),
    }),
    agentTemplateNode({
      id: 'lr-draft',
      title: '综述初稿',
      position: nodePosition(3),
      input: [
        '你是学术综述撰写助手。基于上游的精读笔记撰写一篇结构完整的综述初稿（Markdown）：',
        '1. 标题（H1）与摘要',
        '2. 引言：背景、问题、综述范围',
        '3. 主体：按主题/方法脉络分节归纳对比，而不是逐篇罗列',
        '4. 讨论：开放问题与未来方向',
        '5. 参考文献：编号 [n] 对应上游文献元数据',
        '要求：所有论断必须标注来源编号；不得引入上游之外的文献；篇幅 2000-4000 字。',
      ].join('\n'),
    }),
    agentTemplateNode({
      id: 'lr-cite-check',
      title: '引用核查',
      position: nodePosition(4),
      input: [
        '你是引用核查助手。逐条核对上游综述初稿：',
        '1. 每个引用编号 [n] 是否都能对应到上游文献清单中的真实条目；',
        '2. 每处引用的论断是否与该文献的笔记内容一致，标记夸大或无支撑的表述；',
        '3. 参考文献表是否与正文引用一一对应。',
        '发现问题就地修正：修正后输出完整的修订版综述（Markdown，保持 H1 标题），并在文末附"引用核查说明"小节，列出全部修改点；无问题的项不必罗列。',
      ].join('\n'),
    }),
    scriptTemplateNode({
      id: 'lr-html-report',
      title: 'HTML 报告',
      position: nodePosition(5),
      code: LR_HTML_REPORT_CODE,
    }),
  ],
  edges: [
    templateEdge('lr-e1', 'lr-search', 'lr-screen'),
    templateEdge('lr-e2', 'lr-screen', 'lr-read'),
    templateEdge('lr-e3', 'lr-read', 'lr-draft'),
    templateEdge('lr-e4', 'lr-draft', 'lr-cite-check'),
    templateEdge('lr-e5', 'lr-cite-check', 'lr-html-report'),
  ],
}

const paperTranslate: ResearchWorkflowTemplate = {
  id: 'paper-translate',
  name: '论文翻译',
  description: 'PDF 接入校验 → pdf2zh 翻译（调 OpenAI 兼容 API，API-first，不下载不运行本地模型）→ 双语对照 → 术语表沉淀。',
  profile: 'default',
  steps: ['PDF 接入校验', 'pdf2zh 翻译', '双语对照', '术语表沉淀'],
  requiredEnv: {
    OPENAI_API_KEY: 'OpenAI 兼容翻译服务的 API Key（pdf2zh -s openai 经其调用，密钥只经环境变量传递）',
  },
  optionalEnv: {
    OPENAI_BASE_URL: 'OpenAI 兼容服务地址，默认官方端点',
    OPENAI_MODEL: '翻译用模型名，默认 pdf2zh 内置值',
    PAPER_TRANSLATE_TARGET_LANG: '目标语言代码，默认 zh',
    PAPER_TRANSLATE_PDF2ZH_BIN: 'pdf2zh 可执行文件路径，默认取 PATH 中的 pdf2zh；也可指向 Node 包装脚本（.js/.cjs/.mjs，以当前 Node 运行时执行）',
  },
  nodes: [
    scriptTemplateNode({
      id: 'pt-pdf-intake',
      title: 'PDF 接入校验',
      position: nodePosition(0),
      code: PT_PDF_INTAKE_CODE,
    }),
    scriptTemplateNode({
      id: 'pt-translate',
      title: 'pdf2zh 翻译',
      position: nodePosition(1),
      code: PT_TRANSLATE_CODE,
    }),
    scriptTemplateNode({
      id: 'pt-bilingual',
      title: '双语对照',
      position: nodePosition(2),
      code: PT_BILINGUAL_CODE,
    }),
    agentTemplateNode({
      id: 'pt-glossary',
      title: '术语表沉淀',
      position: nodePosition(3),
      input: [
        '你是术语表管理员。上游输入包含翻译节点产出的路径信息（JSON：pdfPath/monoPath/dualPath/bilingualHtmlPath）。',
        '1. 若可用文件工具，读取译文中代表性段落；否则基于上游可读内容继续。',
        '2. 提取 20-50 个领域术语，输出 Markdown 表：| 英文术语 | 中文译名 | 语境/备注 |。',
        '3. 译名遵循所在领域通行译法；不确定的译名在备注标注"待确认"。',
        '4. 在表格之后追加"沉淀说明"：术语挑选口径、需要人工复核的项。',
        '最终输出只包含术语表 Markdown。',
      ].join('\n'),
    }),
  ],
  edges: [
    templateEdge('pt-e1', 'pt-pdf-intake', 'pt-translate'),
    templateEdge('pt-e2', 'pt-translate', 'pt-bilingual'),
    templateEdge('pt-e3', 'pt-bilingual', 'pt-glossary'),
  ],
}

/** Registered research workflow templates, keyed lookup by `id`. */
export const RESEARCH_WORKFLOW_TEMPLATES: readonly ResearchWorkflowTemplate[] = [literatureReview, paperTranslate]

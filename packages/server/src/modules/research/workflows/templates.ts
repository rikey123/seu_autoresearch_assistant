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
  var os = require('node:os');
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
  // Legacy embed: only used as an explicit fallback (see embedMode below);
  // browsers block file:// iframes on http origins, so the server-proxied URL
  // is the primary embed whenever a token can be resolved.
  function toFileUri(filePath) {
    return 'file:///' + filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  }
  // The bilingual page is a local research artifact rendered by the user's own
  // machine. Embedding through the server's run-files endpoint needs the same
  // credential the user already holds: the Studio auth token. It is resolved
  // from the server environment (AUTH_TOKEN or the token file under the Web UI
  // home) exactly like the repo-standard "token" query parameter download
  // pattern, and it only ever authorizes the local browser to read local run
  // artifacts — it is never transmitted to a third party.
  // PAPER_TRANSLATE_BILINGUAL_EMBED=file forces the legacy file:// embed back
  // on (offline machine-local viewing).
  function resolveEmbedToken() {
    var fromEnv = String(process.env.AUTH_TOKEN || '').trim();
    if (fromEnv) return fromEnv;
    var home = String(process.env.HERMES_WEB_UI_HOME || '').trim()
      || String(process.env.HERMES_WEBUI_STATE_DIR || '').trim()
      || path.join(os.homedir(), '.hermes-web-ui');
    try {
      var token = fs.readFileSync(path.join(home, '.token'), 'utf8');
      return token.trim();
    } catch (error) {
      return '';
    }
  }
  function serverBaseUrl() {
    var port = Number(process.env.PORT);
    if (!Number.isFinite(port) || port <= 0) port = 8648;
    return 'http://127.0.0.1:' + port;
  }
  function toProxyUrl(filePath, token) {
    return serverBaseUrl() + '/api/studio/research/run-files?path=' + encodeURIComponent(filePath)
      + '&token=' + encodeURIComponent(token);
  }
  var embedMode = String(process.env.PAPER_TRANSLATE_BILINGUAL_EMBED || '').trim().toLowerCase();
  var embedToken = embedMode === 'file' ? '' : resolveEmbedToken();
  function pane(label, filePath) {
    var embed = embedToken
      ? toProxyUrl(filePath, embedToken)
      : toFileUri(filePath);
    return '<section><h2>' + escapeHtml(label) + '</h2><iframe src="' + escapeHtml(embed)
      + '" style="width:100%;height:78vh;border:1px solid #d7dde8;border-radius:8px;"></iframe>'
      + '<p class="fallback">本地路径回退：<code>' + escapeHtml(filePath) + '</code></p></section>';
  }
  var fileName = path.basename(payload.pdfPath);
  var dualEmbed = embedToken ? toProxyUrl(payload.dualPath, embedToken) : '';
  var dualNote = dualEmbed
    ? '<p>交错双语版（逐页对照）：<a href="' + escapeHtml(dualEmbed) + '">经服务端打开</a> 或 <code>' + escapeHtml(payload.dualPath) + '</code></p>'
    : '<p>交错双语版（逐页对照）：<code>' + escapeHtml(payload.dualPath) + '</code></p>';
  var html = '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8" />\n<title>'
    + escapeHtml(fileName) + ' 双语对照</title>\n'
    + '<!-- 本页为本地科研产物（工作流运行生成）。PDF 经本机服务端 run-files 端点流式内嵌：'
    + 'URL 中的 token 是本机用户自身的访问凭据，仅授权本机浏览器读取本机运行产物，不向第三方传输。 -->\n'
    + '<style>\n'
    + 'body { font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; margin: 24px; color: #1f2430; }\n'
    + 'h1 { font-size: 20px; }\n'
    + '.panes { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }\n'
    + '.fallback { color: #6b7280; font-size: 12px; }\n'
    + '@media (max-width: 1100px) { .panes { grid-template-columns: 1fr; } }\n'
    + '</style>\n</head>\n<body>\n'
    + '<h1>' + escapeHtml(fileName) + ' 双语对照</h1>\n'
    + '<div class="panes">\n' + pane('原文', payload.pdfPath) + '\n' + pane('译文', payload.monoPath) + '\n</div>\n'
    + dualNote + '\n'
    + '</body>\n</html>';
  var htmlPath = path.join(path.dirname(payload.pdfPath), 'paper-bilingual.html');
  fs.writeFileSync(htmlPath, html, 'utf8');
  process.stdout.write(JSON.stringify({
    bilingualHtmlPath: htmlPath,
    original: payload.pdfPath,
    translated: payload.monoPath,
    dual: payload.dualPath,
    embed: embedToken ? 'server-proxy' : 'file-uri-fallback',
  }));
});`

// Queue intake: reads a JSONL batch queue (one item per line, fields
// id/type/payload), validates and dedupes it deterministically, and chunks the
// surviving items into fixed-size batches. The entry node's authored input is
// either a bare absolute JSONL path or JSON {"queuePath": "...", "batchSize": n}.
const OR_QUEUE_INTAKE_CODE = String.raw`'use strict';
${ENGINE_WRAPPER_HELPERS}var rawInput = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', function (chunk) { rawInput += chunk; });
process.stdin.on('end', function () {
  var fs = require('node:fs');
  var path = require('node:path');
  var text = stripEngineWrapperLines(rawInput);
  if (!text) {
    console.error('queue intake node received no input: pass JSON {"queuePath": "<absolute JSONL path>", "batchSize": 2} or a bare absolute path');
    process.exit(1);
  }
  var queuePath = '';
  var batchSize = 3;
  var parsed = parseJsonPayload(text);
  if (parsed && typeof parsed.queuePath === 'string') {
    queuePath = parsed.queuePath.trim();
    if (parsed.batchSize !== undefined && parsed.batchSize !== null) {
      var wanted = Number(parsed.batchSize);
      if (!Number.isInteger(wanted) || wanted < 1) {
        console.error('batchSize must be a positive integer, received: ' + String(parsed.batchSize));
        process.exit(1);
      }
      batchSize = wanted;
    }
  } else {
    queuePath = text.split(/\r?\n/)[0].trim();
  }
  if (!queuePath) {
    console.error('queuePath is required');
    process.exit(1);
  }
  if (!path.isAbsolute(queuePath)) {
    console.error('queuePath must be an absolute path, received: ' + queuePath);
    process.exit(1);
  }
  var stat = null;
  try {
    stat = fs.statSync(queuePath);
  } catch (error) {
    console.error('queue file not found: ' + queuePath);
    process.exit(1);
  }
  if (!stat.isFile()) {
    console.error('queuePath is not a regular file: ' + queuePath);
    process.exit(1);
  }
  var raw = fs.readFileSync(queuePath, 'utf8');
  // A trailing newline at end-of-file is normal JSONL formatting, not an
  // extra blank queue line.
  if (raw.slice(-1) === '\n') raw = raw.slice(0, -1);
  var lines = raw.split(/\r?\n/);
  var totals = { lines: 0, blank: 0, valid: 0, duplicates: 0, invalid: 0 };
  var duplicateIds = [];
  var invalidLines = [];
  var items = [];
  var seenIds = Object.create(null);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    var lineNumber = i + 1;
    if (!line) { totals.blank += 1; continue; }
    totals.lines += 1;
    var item = null;
    try {
      var candidate = JSON.parse(line);
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) item = candidate;
    } catch (error) {}
    if (!item) {
      totals.invalid += 1;
      invalidLines.push({ line: lineNumber, reason: 'line is not a JSON object' });
      continue;
    }
    if (typeof item.id !== 'string' || !item.id.trim()) {
      totals.invalid += 1;
      invalidLines.push({ line: lineNumber, reason: 'item.id must be a non-empty string' });
      continue;
    }
    if (typeof item.type !== 'string' || !item.type.trim()) {
      totals.invalid += 1;
      invalidLines.push({ line: lineNumber, reason: 'item.type must be a non-empty string' });
      continue;
    }
    if (seenIds[item.id]) {
      totals.duplicates += 1;
      duplicateIds.push(item.id);
      continue;
    }
    seenIds[item.id] = true;
    items.push({ id: item.id, type: item.type, payload: item.payload === undefined ? null : item.payload });
    totals.valid += 1;
  }
  var batches = [];
  for (var start = 0; start < items.length; start += batchSize) {
    var slice = items.slice(start, start + batchSize);
    batches.push({
      batchIndex: batches.length + 1,
      itemIds: slice.map(function (item) { return item.id; }),
      items: slice,
    });
  }
  var planItems = items.map(function (item, index) {
    return { id: item.id, type: item.type, batchIndex: Math.floor(index / batchSize) + 1 };
  });
  process.stdout.write(JSON.stringify({
    queuePath: queuePath,
    batchSize: batchSize,
    totals: totals,
    duplicateIds: duplicateIds,
    invalidLines: invalidLines,
    batchCount: batches.length,
    batches: batches,
    items: planItems,
  }));
});`

// Aggregation: joins the queue plan (from the intake script node) with the raw
// agent execution output (both arrive as "[Upstream: ...]" sections of one
// wrapped message, so the section headers are the delimiters — wrapper lines
// must NOT be stripped before splitting). Result lines are parsed tolerantly
// (JSON objects with an id field, bullets/code fences ignored); every planned
// item without a matching result is accounted as missing, never silently
// dropped, so the morning report can prove the queue was fully consumed.
const OR_BATCH_AGGREGATE_CODE = String.raw`'use strict';
${ENGINE_WRAPPER_HELPERS}function splitUpstreamSections(text) {
  var sections = [];
  var current = null;
  var lines = text.split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var header = line.match(/^\[Upstream: (.*?)\]\s*$/);
    if (header) {
      current = { title: header[1], lines: [] };
      sections.push(current);
      continue;
    }
    var trimmed = line.trim();
    if (trimmed === '[Workflow upstream results]') continue;
    if (trimmed === '[Current task]') break;
    if (current) current.lines.push(line);
  }
  return sections;
}
function parseResultLine(line) {
  var trimmed = line.trim();
  if (!trimmed || trimmed.indexOf('\x60\x60\x60') === 0) return null;
  if (trimmed.charAt(0) === '-' || trimmed.charAt(0) === '*') trimmed = trimmed.slice(1).trim();
  if (!trimmed || trimmed.charAt(0) !== '{') return null;
  try {
    var candidate = JSON.parse(trimmed);
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)
      && typeof candidate.id === 'string' && candidate.id.trim()) return candidate;
  } catch (error) {}
  return null;
}
var rawInput = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', function (chunk) { rawInput += chunk; });
process.stdin.on('end', function () {
  var sections = splitUpstreamSections(rawInput);
  var plan = null;
  var planSectionIndex = -1;
  for (var s = 0; s < sections.length; s++) {
    var sectionText = sections[s].lines.join('\n').trim();
    var parsed = sectionText ? parseJsonPayload(sectionText) : null;
    if (!plan && parsed && typeof parsed.queuePath === 'string' && Array.isArray(parsed.batches)) {
      plan = parsed;
      planSectionIndex = s;
    }
  }
  if (!plan || !Array.isArray(plan.items)) {
    console.error('aggregate node could not find the queue plan JSON in its upstream inputs');
    process.exit(1);
  }
  var resultLines = [];
  for (var r = 0; r < sections.length; r++) {
    if (r === planSectionIndex) continue;
    resultLines = resultLines.concat(sections[r].lines);
  }
  var resultsById = Object.create(null);
  var unexpected = [];
  for (var i = 0; i < resultLines.length; i++) {
    var result = parseResultLine(resultLines[i]);
    if (!result) continue;
    var known = false;
    for (var p = 0; p < plan.items.length; p++) {
      if (plan.items[p].id === result.id) { known = true; break; }
    }
    if (!known) {
      unexpected.push({ id: result.id, reason: '上游返回了计划之外的结果' });
      continue;
    }
    if (!resultsById[result.id]) resultsById[result.id] = result;
  }
  var stats = { total: plan.items.length, success: 0, failed: 0, missing: 0 };
  var items = [];
  var failures = [];
  for (var j = 0; j < plan.items.length; j++) {
    var planned = plan.items[j];
    var result = resultsById[planned.id] || null;
    var status = 'missing';
    var summary = '';
    var reason = '';
    if (result) {
      summary = typeof result.summary === 'string' ? result.summary : '';
      if (result.status === 'success') {
        status = 'success';
        stats.success += 1;
      } else {
        status = 'failed';
        stats.failed += 1;
        if (typeof result.reason === 'string' && result.reason) reason = result.reason;
        else if (result.status === 'failed') reason = summary || '未提供失败原因';
        else reason = '未知状态: ' + String(result.status);
      }
    } else {
      stats.missing += 1;
      reason = '上游批处理节点未返回该条目的结果';
    }
    var row = { id: planned.id, type: planned.type, batchIndex: planned.batchIndex, status: status, summary: summary };
    if (status !== 'success') {
      row.reason = reason;
      failures.push({ id: planned.id, type: planned.type, batchIndex: planned.batchIndex, status: status, reason: reason });
    }
    items.push(row);
  }
  var completionRate = stats.total ? Math.round((stats.success / stats.total) * 1000) / 10 : 0;
  process.stdout.write(JSON.stringify({
    queue: {
      queuePath: plan.queuePath,
      batchSize: plan.batchSize,
      batchCount: Array.isArray(plan.batches) ? plan.batches.length : 0,
      totals: plan.totals,
      duplicateIds: plan.duplicateIds,
      invalidLines: plan.invalidLines,
    },
    stats: { total: stats.total, success: stats.success, failed: stats.failed, missing: stats.missing, completionRate: completionRate },
    items: items,
    failures: failures,
    unexpected: unexpected,
  }));
});`

// Morning report: consumes the aggregation ledger JSON and renders the ARIS
// morning report HTML (batch statistics, per-item results, failures with
// reasons, next-step placeholder) next to the queue file.
const OR_MORNING_REPORT_CODE = String.raw`'use strict';
${ENGINE_WRAPPER_HELPERS}var rawInput = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', function (chunk) { rawInput += chunk; });
process.stdin.on('end', function () {
  var fs = require('node:fs');
  var path = require('node:path');
  var source = stripEngineWrapperLines(rawInput);
  var ledger = source ? parseJsonPayload(source) : null;
  if (!ledger || !ledger.queue || typeof ledger.queue.queuePath !== 'string'
    || !ledger.stats || !Array.isArray(ledger.items)) {
    console.error('morning report node expects the aggregation ledger JSON from its upstream');
    process.exit(1);
  }
  function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function statusLabel(status) {
    return status === 'success' ? '成功' : (status === 'failed' ? '失败' : '缺失');
  }
  function statRow(label, value) {
    return '<tr><th>' + escapeHtml(label) + '</th><td>' + escapeHtml(value === undefined || value === null ? '-' : String(value)) + '</td></tr>';
  }
  var stats = ledger.stats;
  var totals = ledger.queue.totals || {};
  var html = [];
  html.push('<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8" />\n<title>过夜自主科研晨报</title>\n<style>\n'
    + 'body { font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; max-width: 860px; margin: 40px auto; padding: 0 24px; line-height: 1.7; color: #1f2430; }\n'
    + 'h1, h2 { line-height: 1.3; }\n'
    + 'table { border-collapse: collapse; width: 100%; margin: 12px 0; }\n'
    + 'th, td { border: 1px solid #d7dde8; padding: 6px 10px; text-align: left; font-size: 14px; vertical-align: top; }\n'
    + 'th { background: #f2f5fa; white-space: nowrap; }\n'
    + '.status-success { color: #16794f; }\n'
    + '.status-failed { color: #b42318; }\n'
    + '.status-missing { color: #b54708; }\n'
    + '</style>\n</head>\n<body>\n');
  html.push('<h1>过夜自主科研晨报</h1>');
  html.push('<p>生成时间：' + escapeHtml(new Date().toISOString()) + '；队列文件：<code>' + escapeHtml(ledger.queue.queuePath) + '</code></p>');
  html.push('<h2>一、批处理统计</h2>');
  html.push('<table><tbody>'
    + statRow('队列行数', totals.lines)
    + statRow('有效条目', totals.valid)
    + statRow('重复剔除', totals.duplicates)
    + statRow('无效行', totals.invalid)
    + statRow('批次数', ledger.queue.batchCount)
    + statRow('计划条目', stats.total)
    + statRow('成功', stats.success)
    + statRow('失败', stats.failed)
    + statRow('缺失', stats.missing)
    + statRow('完成率', stats.completionRate + '%')
    + '</tbody></table>');
  var duplicateIds = Array.isArray(ledger.queue.duplicateIds) ? ledger.queue.duplicateIds : [];
  if (duplicateIds.length) {
    html.push('<p>重复剔除的条目 id：' + escapeHtml(duplicateIds.join(', ')) + '</p>');
  }
  var invalidLines = Array.isArray(ledger.queue.invalidLines) ? ledger.queue.invalidLines : [];
  if (invalidLines.length) {
    html.push('<p>无效行：' + escapeHtml(invalidLines.map(function (row) {
      return '第 ' + row.line + ' 行（' + row.reason + '）';
    }).join('；')) + '</p>');
  }
  html.push('<h2>二、逐项结果清单</h2>');
  html.push('<table><thead><tr><th>编号</th><th>类型</th><th>批次</th><th>状态</th><th>结果摘要</th></tr></thead><tbody>');
  for (var i = 0; i < ledger.items.length; i++) {
    var item = ledger.items[i];
    html.push('<tr><td>' + escapeHtml(item.id) + '</td><td>' + escapeHtml(item.type) + '</td><td>' + escapeHtml(item.batchIndex)
      + '</td><td class="status-' + escapeHtml(item.status) + '">' + statusLabel(item.status) + '</td><td>'
      + escapeHtml(item.summary || item.reason || '-') + '</td></tr>');
  }
  html.push('</tbody></table>');
  html.push('<h2>三、失败项与原因</h2>');
  var failures = Array.isArray(ledger.failures) ? ledger.failures : [];
  if (!failures.length) {
    html.push('<p>本次运行无失败项。</p>');
  } else {
    html.push('<table><thead><tr><th>编号</th><th>类型</th><th>状态</th><th>原因</th></tr></thead><tbody>');
    for (var f = 0; f < failures.length; f++) {
      html.push('<tr><td>' + escapeHtml(failures[f].id) + '</td><td>' + escapeHtml(failures[f].type) + '</td><td>'
        + statusLabel(failures[f].status) + '</td><td>' + escapeHtml(failures[f].reason) + '</td></tr>');
    }
    html.push('</tbody></table>');
  }
  html.push('<h2>四、下一步建议</h2>');
  html.push('<p>（占位）下一步建议将由后续版本自动生成：基于失败项与缺失项给出重试/补充实验建议，并汇总需人工复核的事项。</p>');
  var unexpected = Array.isArray(ledger.unexpected) ? ledger.unexpected : [];
  if (unexpected.length) {
    html.push('<p>计划外结果：' + escapeHtml(unexpected.map(function (row) { return row.id; }).join(', ')) + '</p>');
  }
  html.push('</body>\n</html>');
  var document = html.join('\n');
  var reportPath = path.join(path.dirname(ledger.queue.queuePath), 'morning-report.html');
  fs.writeFileSync(reportPath, document, 'utf8');
  process.stdout.write(JSON.stringify({
    format: 'html',
    title: '过夜自主科研晨报',
    reportPath: reportPath,
    bytes: Buffer.byteLength(document),
    stats: stats,
  }));
});`

// Figure-drawing (scientific-illustrator loop, deterministic v1): a drawing
// brief is validated into normalized JSON, one agent node produces a standalone
// SVG document (conventions pinned by the bound "scientific-figure-style"
// skill from the research skill pack), a script node renders figure.svg next
// to the brief's outDir, and an optional gated script node exports the figure
// elements into a .pptx through the python-pptx sidecar. The pptx stage
// degrades gracefully (pptxExported:false + reason) when the sidecar is not
// configured — figure.svg stays the primary artifact.
const FD_INTAKE_CODE = String.raw`'use strict';
${ENGINE_WRAPPER_HELPERS}var rawInput = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', function (chunk) { rawInput += chunk; });
process.stdin.on('end', function () {
  var fs = require('node:fs');
  var path = require('node:path');
  var text = stripEngineWrapperLines(rawInput);
  if (!text) {
    console.error('figure intake node received no input: pass JSON {"title":"...","outDir":"<absolute dir>","figureType":"bar","labels":[...],"data":[...]} or an absolute path to a brief JSON file');
    process.exit(1);
  }
  var brief = parseJsonPayload(text);
  if (!brief && path.isAbsolute(text.trim())) {
    var briefPath = text.trim();
    try {
      brief = JSON.parse(fs.readFileSync(briefPath, 'utf8'));
    } catch (error) {
      console.error('failed to read brief file ' + briefPath + ': ' + error.message);
      process.exit(1);
    }
  }
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)) {
    console.error('figure intake node expects a drawing brief JSON object (inline or via absolute file path)');
    process.exit(1);
  }
  function fail(message) {
    console.error('invalid drawing brief: ' + message);
    process.exit(1);
  }
  if (typeof brief.title !== 'string' || !brief.title.trim()) fail('title must be a non-empty string');
  if (typeof brief.outDir !== 'string' || !brief.outDir.trim()) fail('outDir must be an absolute output directory path');
  if (!path.isAbsolute(brief.outDir.trim())) fail('outDir must be an absolute path, received: ' + brief.outDir);
  var figureType = typeof brief.figureType === 'string' && brief.figureType.trim() ? brief.figureType.trim().toLowerCase() : 'bar';
  var allowedTypes = ['bar', 'line', 'scatter', 'pie', 'custom'];
  if (allowedTypes.indexOf(figureType) === -1) fail('figureType must be one of ' + allowedTypes.join(', ') + ', received: ' + figureType);
  var labels = brief.labels === undefined ? [] : brief.labels;
  if (!Array.isArray(labels) || labels.some(function (label) { return typeof label !== 'string'; })) fail('labels must be an array of strings');
  var data = brief.data === undefined ? [] : brief.data;
  if (!Array.isArray(data) || data.some(function (value) { return typeof value !== 'number' || !isFinite(value); })) fail('data must be an array of finite numbers');
  if (labels.length && data.length && labels.length !== data.length) fail('labels and data must have the same length');
  var xLabel = typeof brief.xLabel === 'string' ? brief.xLabel : '';
  var yLabel = typeof brief.yLabel === 'string' ? brief.yLabel : '';
  var referencePath = null;
  if (brief.referencePath !== undefined && brief.referencePath !== null) {
    if (typeof brief.referencePath !== 'string' || !brief.referencePath.trim()) fail('referencePath must be a non-empty string when provided');
    if (!path.isAbsolute(brief.referencePath.trim())) fail('referencePath must be an absolute path');
    if (!fs.existsSync(brief.referencePath.trim())) fail('referencePath does not exist: ' + brief.referencePath);
    referencePath = brief.referencePath.trim();
  }
  var notes = typeof brief.notes === 'string' ? brief.notes : '';
  process.stdout.write(JSON.stringify({
    title: brief.title.trim(),
    figureType: figureType,
    outDir: path.resolve(brief.outDir.trim()),
    labels: labels,
    data: data,
    xLabel: xLabel,
    yLabel: yLabel,
    referencePath: referencePath,
    notes: notes,
    labelCount: labels.length,
    dataCount: data.length,
  }));
});`

const FD_RENDER_CODE = String.raw`'use strict';
${ENGINE_WRAPPER_HELPERS}function splitUpstreamSections(text) {
  var sections = [];
  var current = null;
  var lines = text.split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var header = line.match(/^\[Upstream: (.*?)\]\s*$/);
    if (header) {
      current = { title: header[1], lines: [] };
      sections.push(current);
      continue;
    }
    var trimmed = line.trim();
    if (trimmed === '[Workflow upstream results]') continue;
    if (trimmed === '[Current task]') break;
    if (current) current.lines.push(line);
  }
  return sections;
}
function extractSvgDocument(text) {
  var fence = String.fromCharCode(96, 96, 96);
  var fencePattern = new RegExp(fence + '\\s*svg\\s*\\r?\\n([\\s\\S]*?)\\r?\\n\\s*' + fence, 'i');
  var fenced = text.match(fencePattern);
  var candidate = fenced ? fenced[1] : text;
  var start = candidate.indexOf('<svg');
  var end = candidate.lastIndexOf('</svg>');
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + '</svg>'.length).trim();
}
var rawInput = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', function (chunk) { rawInput += chunk; });
process.stdin.on('end', function () {
  var fs = require('node:fs');
  var path = require('node:path');
  var sections = splitUpstreamSections(rawInput);
  var brief = null;
  var svg = null;
  for (var i = 0; i < sections.length; i++) {
    var sectionText = sections[i].lines.join('\n').trim();
    if (!sectionText) continue;
    if (!brief) {
      var parsed = parseJsonPayload(sectionText);
      if (parsed && typeof parsed.outDir === 'string') {
        brief = parsed;
        continue;
      }
    }
    if (!svg) svg = extractSvgDocument(sectionText);
  }
  if (!brief || typeof brief.outDir !== 'string') {
    console.error('render node could not find the drawing brief JSON (with outDir) from the intake node upstream');
    process.exit(1);
  }
  if (!svg) {
    console.error('render node could not find an SVG document in the upstream agent output; the drawing node must output exactly one ' + String.fromCharCode(96, 96, 96) + 'svg fenced block');
    process.exit(1);
  }
  if (/<script/i.test(svg)) {
    console.error('render node rejected the SVG document: <script> elements are not allowed in rendered figures');
    process.exit(1);
  }
  // Inline event attributes: the leading \s anchor keeps prose like "press
  // onward" safe — only a whitespace-delimited on* attribute followed by "="
  // (e.g. onload=) matches.
  if (/\son\w+\s*=/i.test(svg)) {
    console.error('render node rejected the SVG document: inline event handler attributes (on*) are not allowed in rendered figures');
    process.exit(1);
  }
  if (/javascript:/i.test(svg)) {
    console.error('render node rejected the SVG document: javascript: URLs are not allowed in rendered figures');
    process.exit(1);
  }
  if (/<(foreignObject|image|use)\b/i.test(svg)) {
    console.error('render node rejected the SVG document: foreignObject, image, and use elements are not allowed in rendered figures');
    process.exit(1);
  }
  if (svg.length < 100) {
    console.error('render node rejected the SVG document: too small to be a real figure (' + svg.length + ' bytes)');
    process.exit(1);
  }
  fs.mkdirSync(brief.outDir, { recursive: true });
  var svgPath = path.join(brief.outDir, 'figure.svg');
  fs.writeFileSync(svgPath, svg, 'utf8');
  var width = (svg.match(/width\s*=\s*"(\d+(?:\.\d+)?)/) || [])[1] || null;
  var height = (svg.match(/height\s*=\s*"(\d+(?:\.\d+)?)/) || [])[1] || null;
  process.stdout.write(JSON.stringify({
    format: 'svg',
    title: brief.title,
    figureType: brief.figureType,
    svgPath: svgPath,
    bytes: Buffer.byteLength(svg),
    width: width === null ? null : Number(width),
    height: height === null ? null : Number(height),
  }));
});`

// Optional gated export: hands the rendered SVG to the python-pptx sidecar so
// the figure lands as editable .pptx elements (scientific-illustrator v1
// degradation: file export instead of desktop automation). The stage is
// intentionally non-fatal — without RESEARCH_FIGURE_PPTX_PYTHON configured it
// reports pptxExported:false with a reason and the run still completes with
// figure.svg as the primary artifact.
const FD_PPTX_CODE = String.raw`'use strict';
${ENGINE_WRAPPER_HELPERS}var rawInput = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', function (chunk) { rawInput += chunk; });
process.stdin.on('end', function () {
  var fs = require('node:fs');
  var path = require('node:path');
  var cp = require('node:child_process');
  // Exactly one settlement: a failed spawn emits both 'error' and 'close', and
  // two finish() calls would glue two JSON objects into stdout and break the
  // engine's JSON parsing of the node output.
  var finished = false;
  function finish(payload) {
    if (finished) return;
    finished = true;
    process.stdout.write(JSON.stringify(payload));
  }
  var render = parseJsonPayload(stripEngineWrapperLines(rawInput));
  if (!render || typeof render.svgPath !== 'string' || !render.svgPath) {
    console.error('pptx export node expects the render node JSON (svgPath) from its upstream');
    process.exit(1);
  }
  if (!fs.existsSync(render.svgPath)) {
    finish({ pptxExported: false, reason: 'rendered SVG is missing: ' + render.svgPath });
    return;
  }
  var pythonBin = process.env.RESEARCH_FIGURE_PPTX_PYTHON || '';
  if (!pythonBin) {
    finish({
      pptxExported: false,
      reason: 'optional pptx export is not configured: set RESEARCH_FIGURE_PPTX_PYTHON to a Python interpreter with python-pptx installed (see the template optionalEnv docs); figure.svg remains the primary artifact',
      svgPath: render.svgPath,
    });
    return;
  }
  var sidecarPath = process.env.RESEARCH_FIGURE_PPTX_SIDECAR || '';
  if (!sidecarPath) {
    finish({
      pptxExported: false,
      reason: 'optional pptx export is not fully configured: set RESEARCH_FIGURE_PPTX_SIDECAR to the absolute path of figure_svg_to_pptx.py (script nodes execute inside the run workspace, so a repo-relative default cannot be trusted); figure.svg remains the primary artifact',
      svgPath: render.svgPath,
    });
    return;
  }
  if (!fs.existsSync(sidecarPath)) {
    finish({ pptxExported: false, reason: 'python-pptx sidecar script not found at ' + sidecarPath, svgPath: render.svgPath });
    return;
  }
  var pptxPath = path.join(path.dirname(render.svgPath), 'figure.pptx');
  var args = [sidecarPath, render.svgPath, pptxPath, String(render.title || 'Scientific figure')];
  // No cwd override: the default sidecar path resolves against the server
  // process working directory, so the child must inherit it.
  var child = cp.spawn(pythonBin, args, {
    shell: false,
    windowsHide: true,
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
    finish({ pptxExported: false, reason: 'failed to spawn the configured python interpreter "' + pythonBin + '": ' + error.message, svgPath: render.svgPath });
  });
  child.on('close', function (code) {
    if (code === 0 && fs.existsSync(pptxPath)) {
      finish({
        pptxExported: true,
        pptxPath: pptxPath,
        bytes: fs.statSync(pptxPath).size,
        sidecar: sidecarPath,
        svgPath: render.svgPath,
        title: String(render.title || 'Scientific figure'),
      });
      return;
    }
    var detail = (stderrText.trim() || stdoutText.trim() || 'no output').split('\n').slice(-3).join('\n');
    finish({ pptxExported: false, reason: 'pptx sidecar exited with code ' + code + ': ' + detail, svgPath: render.svgPath });
  });
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

// ARIS-style overnight batch research (DESIGN.md §3): a JSONL task queue is
// validated/deduped/chunked deterministically, a single agent node executes the
// planned batches (the engine delegates to the configured chat runtime), a
// script node joins the plan with the agent output into an audited ledger, and
// a final script node renders the morning report HTML. The diamond edge
// (intake -> aggregate) is what lets the aggregation node reconcile the plan
// against the agent output deterministically.
const overnightResearch: ResearchWorkflowTemplate = {
  id: 'overnight-research',
  name: '过夜自主科研',
  description: 'ARIS 式批处理工作流：JSONL 任务队列接入（校验/去重/分批）→ agent 逐批执行 → 确定性逐批聚合与进度统计 → 晨报 HTML 产物。',
  profile: 'default',
  steps: ['队列接入', '批处理执行', '逐批聚合', '晨报报告'],
  nodes: [
    scriptTemplateNode({
      id: 'or-queue-intake',
      title: '队列接入',
      position: nodePosition(0),
      code: OR_QUEUE_INTAKE_CODE,
    }),
    agentTemplateNode({
      id: 'or-batch-executor',
      title: '批处理执行',
      position: nodePosition(1),
      input: [
        '你是过夜批处理执行助手。上游输入是队列接入节点产出的批次计划 JSON（batches 数组，每批含 items：id/type/payload）。',
        '逐批执行计划中的每个条目：',
        '1. type 为 literature：围绕 payload 的 title/query 产出一条文献要点摘要（一句话）。',
        '2. type 为 experiment：说明该实验任务的执行结果与结论（一句话）。',
        '3. 其他 type：按 payload 字面内容做通用处理（一句话）。',
        '输出格式（严格遵循，供下游确定性聚合）：',
        '1. 每个条目输出一行 JSON：{"id": "<条目id>", "status": "success" 或 "failed", "summary": "<一句话结果>", "reason": "<失败原因，失败时必填>"}',
        '2. 除这些 JSON 行外，不得输出任何标题、解释或代码块标记。',
        '3. 必须覆盖计划中的每一个 id，一次给全，不得遗漏。',
      ].join('\n'),
    }),
    scriptTemplateNode({
      id: 'or-batch-aggregate',
      title: '逐批聚合',
      position: nodePosition(2),
      code: OR_BATCH_AGGREGATE_CODE,
    }),
    scriptTemplateNode({
      id: 'or-morning-report',
      title: '晨报报告',
      position: nodePosition(3),
      code: OR_MORNING_REPORT_CODE,
    }),
  ],
  edges: [
    templateEdge('or-e1', 'or-queue-intake', 'or-batch-executor'),
    templateEdge('or-e2', 'or-queue-intake', 'or-batch-aggregate'),
    templateEdge('or-e3', 'or-batch-executor', 'or-batch-aggregate'),
    templateEdge('or-e4', 'or-batch-aggregate', 'or-morning-report'),
  ],
}

// scientific-illustrator loop (DESIGN.md §3) made deterministic for v1: the
// desktop-automation part degrades to file export. The agent node binds the
// "scientific-figure-style" skill from the research skill pack, so the pack
// must be loaded (POST /api/studio/research/skillpacks/nature-research/load)
// before this template can run — the engine's skill preflight enforces it.
const figureDrawing: ResearchWorkflowTemplate = {
  id: 'figure-drawing',
  name: '科研绘图',
  description: '绘图 brief 接入校验 → agent 绑定科研绘图技能生成独立 SVG（绘制→检查→修正约定）→ 确定性渲染 figure.svg → 可选门控 pptx 导出（python-pptx sidecar，未配置时优雅降级）。',
  profile: 'default',
  steps: ['绘图需求接入', 'SVG 绘图生成', '确定性渲染', 'pptx 导出（可选）'],
  optionalEnv: {
    RESEARCH_FIGURE_PPTX_PYTHON: '用于 pptx 导出的 Python 解释器（需已安装 python-pptx）；未设置时跳过 pptx 导出，figure.svg 仍为主产物',
    RESEARCH_FIGURE_PPTX_SIDECAR: 'figure_svg_to_pptx.py 的绝对路径（脚本节点在工作区目录内执行，必须用绝对路径）；未设置时跳过 pptx 导出',
  },
  nodes: [
    scriptTemplateNode({
      id: 'fd-intake',
      title: '绘图需求接入',
      position: nodePosition(0),
      code: FD_INTAKE_CODE,
    }),
    agentTemplateNode({
      id: 'fd-figure-agent',
      title: 'SVG 绘图生成',
      position: nodePosition(1),
      skills: ['scientific-figure-style'],
      input: [
        '你是科研绘图助手。上游输入是绘图需求接入节点产出的规范化 brief JSON（title/figureType/outDir/labels/data/xLabel/yLabel/referencePath/notes）。',
        '任务：根据 brief 生成一幅可直接渲染的独立 SVG 科研图。遵循已装载的 scientific-figure-style 技能中的绘制→检查→修正循环与 SVG 输出约定。',
        '硬性要求：',
        '1. 输出有且仅有一个 ```svg 围栏代码块，块内是完整独立 SVG（根元素带 width/height/viewBox，画布 900×560，白色背景 rect）。',
        '2. 只允许 rect/circle/ellipse/line/polyline/polygon/path(简单折线)/text/g(平移) 图元；禁止 <script>、外部资源、动画。',
        '3. figureType=bar：按 labels/data 画柱状图——柱高按数据线性换算为像素（先算比例再写坐标），每根柱配数据标签；figureType=line：画折线（polyline 或多段 line）并标注数据点；figureType=scatter：画圆点散点；figureType=custom：按 notes 与参考图描述画示意图（框+箭头，单一主流向）。',
        '4. 标题、坐标轴（两条轴线 + 刻度）、轴标签（含单位）、图例齐全；文字用 text-anchor 防截断。',
        '5. 色板用 Okabe-Ito（主色 #0072B2，强调 #D55E00）；同含义同色。',
        '输出检查（在输出前自查并修正）：数据保真、文字完整、无元素越界、柱高与数值成比例。除 svg 围栏块外不得输出任何其他文字。',
      ].join('\n'),
    }),
    scriptTemplateNode({
      id: 'fd-render',
      title: '确定性渲染',
      position: nodePosition(2),
      code: FD_RENDER_CODE,
    }),
    scriptTemplateNode({
      id: 'fd-pptx',
      title: 'pptx 导出（可选）',
      position: nodePosition(3),
      code: FD_PPTX_CODE,
    }),
  ],
  edges: [
    templateEdge('fd-e1', 'fd-intake', 'fd-figure-agent'),
    templateEdge('fd-e2', 'fd-intake', 'fd-render'),
    templateEdge('fd-e3', 'fd-figure-agent', 'fd-render'),
    templateEdge('fd-e4', 'fd-render', 'fd-pptx'),
  ],
}

/** Registered research workflow templates, keyed lookup by `id`. */
export const RESEARCH_WORKFLOW_TEMPLATES: readonly ResearchWorkflowTemplate[] = [literatureReview, paperTranslate, overnightResearch, figureDrawing]

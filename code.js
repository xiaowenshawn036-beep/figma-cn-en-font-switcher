// CN EN Font Switcher v1.2.0 · Figma development plugin
// Scans a selected Frame. Only fontName is edited; no text or size rewrite.
// Missing-font recovery is explicitly opt-in and only allowed for fully reconstructible nodes.
figma.showUI(__html__, { width: 460, height: 670, themeColors: true, title: '中英文字体批量替换' });

const DEFAULTS = { cn: 'HarmonyOS Sans SC', latin: 'Poppins', digitsLatin: true, punctuationCN: true, repairMissing: false };
const VERSION = '1.2.0';
let byFamily = new Map();
let previewSignature = '';
let busy = false;
const axisCache = new Map();
const FONT_KEY = f => `${f.family}::${f.style}`;
const fold = s => String(s || '').trim().toLowerCase();
const msg = (type, data) => figma.ui.postMessage({ type, ...data });

function weightFromStyle(style) {
  const s = String(style || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (/thin|hairline/.test(s)) return 100;
  if (/extralight|ultralight/.test(s)) return 200;
  if (/light/.test(s)) return 300;
  if (/semibold|demibold/.test(s)) return 600;
  if (/extrabold|ultrabold/.test(s)) return 800;
  if (/black|heavy/.test(s)) return 900;
  if (/bold/.test(s)) return 700;
  if (/medium/.test(s)) return 500;
  if (/regular|normal|roman|book|italic|oblique|variable/.test(s)) return 400;
  return null;
}
function isItalic(style) { return /italic|oblique/i.test(String(style || '')); }
function sourceItalic(seg) { return seg.fontStyle === 'ITALIC' || isItalic(seg.fontName && seg.fontName.style); }
function available(font) {
  const arr = byFamily.get(fold(font && font.family)) || [];
  return arr.some(x => x.style === font.style);
}
function variationAxes(family) {
  if (axisCache.has(family)) return axisCache.get(family);
  let axes = [];
  try { axes = figma.getFontFamilyVariationAxes(family) || []; } catch (e) { /* static */ }
  axisCache.set(family, axes);
  return axes;
}
function pickFont(family, weight, italic) {
  const entries = byFamily.get(fold(family)) || [];
  if (!entries.length) return { error: `字体不可用：${family}` };
  const w = Number(weight);
  if (!Number.isFinite(w) || w < 1 || w > 1000) return { error: '原字重无法读取' };
  const matches = entries.filter(x => isItalic(x.style) === italic);
  if (!matches.length) return { error: `${family} 缺少${italic ? '斜体' : '正体'}` };
  const exact = matches.find(x => weightFromStyle(x.style) === w);
  if (exact) return { font: { family: exact.family, style: exact.style } };
  if (variationAxes(entries[0].family).includes('wght')) {
    const base = matches.find(x => /regular/i.test(x.style)) || matches[0];
    return { font: { family: base.family, style: base.style, variationSettings: { wght: w } } };
  }
  return { error: `${family} 没有同级字重 ${w}（已跳过）` };
}
function characterKind(ch, opts) {
  const cp = ch.codePointAt(0);
  if ((cp >= 0x3400 && cp <= 0x9FFF) || (cp >= 0xF900 && cp <= 0xFAFF)
    || (cp >= 0x20000 && cp <= 0x2FA1F) || cp === 0x3007) return 'cn';
  if ((cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122)
    || (cp >= 0xC0 && cp <= 0x24F) || (cp >= 0x1E00 && cp <= 0x1EFF)) return 'latin';
  if (opts.digitsLatin && cp >= 48 && cp <= 57) return 'latin';
  if (opts.punctuationCN && '，。！？、；：‘’“”（）《》【】「」『』—…·％＋＝＜＞￥～'.includes(ch)) return 'cn';
  return null;
}
function easyFiller(ch) { return /^\s$/u.test(ch); }
function rangesForSegment(seg, opts) {
  const runs = [];
  let active = null, offset = seg.start;
  for (const ch of seg.characters) {
    const kind = characterKind(ch, opts);
    const end = offset + ch.length;
    if (active && kind === active.kind && active.end === offset) active.end = end;
    else {
      if (active) runs.push(active);
      active = { kind, start: offset, end };
    }
    offset = end;
  }
  if (active) runs.push(active);
  return runs;
}
function selectedTextNodes() {
  const selected = figma.currentPage.selection;
  const nodes = [], seen = new Set();
  let lockedCount = 0, hiddenCount = 0;
  const walk = (node, lock, hide) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    lock = lock || !!node.locked;
    hide = hide || node.visible === false;
    if (node.type === 'TEXT' || node.type === 'TEXT_PATH') {
      if (lock) lockedCount++;
      else if (hide) hiddenCount++;
      else nodes.push(node);
    }
    if ('children' in node) for (const child of node.children) walk(child, lock, hide);
  };
  for (const n of selected) walk(n, false, false);
  return { nodes, selectedCount: selected.length, lockedCount, hiddenCount };
}
function optsFrom(raw) {
  const o = raw || {};
  return { cn: String(o.cn || '').trim(), latin: String(o.latin || '').trim(),
    digitsLatin: !!o.digitsLatin, punctuationCN: !!o.punctuationCN, repairMissing: !!o.repairMissing };
}
function signature(opts, scan) { return JSON.stringify({ ids: figma.currentPage.selection.map(x => x.id), opts, fingerprint: scan.fingerprint }); }
function fontEquals(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function fontAvailableOrVariable(f) { return available(f); }
function fontMatches(actual, expected) {
  return !!actual && actual !== figma.mixed && fold(actual.family) === fold(expected.family)
    && actual.style === expected.style
    && (!expected.variationSettings || Object.keys(expected.variationSettings).every(
      axis => actual.variationSettings && actual.variationSettings[axis] === expected.variationSettings[axis]));
}
const PRESERVED_FIELDS = ['fontSize', 'lineHeight', 'letterSpacing', 'paragraphSpacing', 'fills'];
function preservedSnapshot(node) {
  return JSON.stringify({ characters: node.characters,
    segments: node.getStyledTextSegments(PRESERVED_FIELDS),
    alignH: node.textAlignHorizontal, alignV: node.textAlignVertical,
    opacity: node.opacity, x: node.x, y: node.y });
}

// Converts a missing-font node to an all-fonts-available plan BEFORE touching the node.
// Non-classified visible glyphs whose original font is missing are NEVER guessed.
function recoveryPlan(node, segments, opts) {
  const chars = [];
  for (const seg of segments) {
    let off = seg.start;
    for (const ch of seg.characters) {
      chars.push({ ch, start: off, end: off + ch.length, kind: characterKind(ch, opts), seg });
      off += ch.length;
    }
  }
  const chosen = [];
  let changedChars = 0, fillerChars = 0;
  for (let i = 0; i < chars.length; i++) {
    const item = chars[i], old = item.seg.fontName;
    let kind = item.kind;
    if (!kind && fontAvailableOrVariable(old)) {
      chosen.push({ ...item, font: old });
      continue;
    }
    if (!kind) {
      // Only whitespace can borrow a neighbouring font. Other symbols are not guessed.
      if (!easyFiller(item.ch)) return { error: `存在缺失字体的未分类符号「${item.ch}」，已跳过整个图层` };
      let best = null, min = Infinity;
      for (let j = 0; j < chars.length; j++) {
        if (!chars[j].kind) continue;
        const dist = Math.abs(j - i);
        if (dist < min || (dist === min && j < i)) { best = chars[j].kind; min = dist; }
      }
      if (!best) return { error: '整段只有标点/空白，无法判断替代字体，已跳过' };
      kind = best;
      fillerChars += item.end - item.start;
    }
    const destination = kind === 'cn' ? opts.cn : opts.latin;
    const sameFamily = fold(old.family) === fold(destination) && fontAvailableOrVariable(old);
    let font;
    if (sameFamily) font = old;
    else {
      const target = pickFont(destination, item.seg.fontWeight, sourceItalic(item.seg));
      if (!target.font) return { error: target.error };
      font = target.font;
      if (item.kind) changedChars += item.end - item.start;
    }
    chosen.push({ ...item, font });
  }
  const fullRuns = [];
  for (const item of chosen) {
    const last = fullRuns[fullRuns.length - 1];
    if (last && last.end === item.start && fontEquals(last.font, item.font)) last.end = item.end;
    else fullRuns.push({ start: item.start, end: item.end, font: item.font });
  }
  if (!fullRuns.length) return { error: '空文字图层' };
  return { fullRuns, changedChars, fillerChars };
}
function buildPlan(opts) {
  const selected = selectedTextNodes();
  const actions = [], issues = [], fingerprint = [], missingFonts = new Set();
  let textLayers = 0, readyCharacters = 0, skippedCharacters = 0,
    readyRuns = 0, alreadyCorrect = 0, rescueLayers = 0, blockedMissingLayers = 0;
  if (!selected.selectedCount) issues.push('没有选区：请在 Layers 中选中首页 Frame。');
  if (!(byFamily.get(fold(opts.cn)) || []).length) issues.push('缺少中文目标字体：' + opts.cn);
  if (!(byFamily.get(fold(opts.latin)) || []).length) issues.push('缺少英文目标字体：' + opts.latin);
  for (const node of selected.nodes) {
    if (!node.characters || !node.characters.length) continue;
    textLayers++;
    let segments;
    try { segments = node.getStyledTextSegments(['fontName', 'fontWeight', 'fontStyle']); }
    catch (e) { skippedCharacters += node.characters.length; issues.push(`「${node.name}」无法读取文字样式：${String(e.message || e)}`); continue; }
    fingerprint.push([node.id, node.characters, node.hasMissingFont, segments]);
    const nodeMissing = segments.filter(seg => !available(seg.fontName));
    for (const seg of nodeMissing) missingFonts.add(`${seg.fontName.family} ${seg.fontName.style}`);
    const nodeJobs = [];
    let same = 0;
    for (const seg of segments) {
      for (const run of rangesForSegment(seg, opts)) {
        if (!run.kind) continue;
        const count = run.end - run.start;
        const family = run.kind === 'cn' ? opts.cn : opts.latin;
        if (fold(seg.fontName.family) === fold(family)) { same += count; continue; }
        const r = pickFont(family, seg.fontWeight, sourceItalic(seg));
        if (r.font) nodeJobs.push({ start: run.start, end: run.end, font: r.font });
        else if (issues.length < 100) issues.push(`「${node.name}」${r.error}（${count} 字符）`);
      }
    }
    alreadyCorrect += same;
    const validCount = nodeJobs.reduce((n, j) => n + j.end - j.start, 0);
    const missing = !!node.hasMissingFont || nodeMissing.length > 0;
    if (missing) {
      if (!opts.repairMissing) {
        skippedCharacters += node.characters.length;
        blockedMissingLayers++;
        if (issues.length < 100) issues.push(`「${node.name}」原字体缺失（${[...new Set(nodeMissing.map(seg => `${seg.fontName.family} ${seg.fontName.style}`))].join('、') || 'Figma 报告缺失'}）：须勾选「修复缺失字体」再预检，或先补齐原字体`);
        continue;
      }
      const recovered = recoveryPlan(node, segments, opts);
      if (recovered.error) {
        skippedCharacters += node.characters.length;
        blockedMissingLayers++;
        if (issues.length < 100) issues.push(`「${node.name}」无法安全修复：${recovered.error}`);
        continue;
      }
      if (!recovered.changedChars) { skippedCharacters += node.characters.length; continue; }
      actions.push({ node, type: 'recovery', fullRuns: recovered.fullRuns, changedChars: recovered.changedChars });
      rescueLayers++;
      readyCharacters += recovered.changedChars;
      readyRuns += recovered.fullRuns.length;
      skippedCharacters += node.characters.length - recovered.changedChars;
      if (recovered.fillerChars && issues.length < 100) issues.push(`「${node.name}」缺失字体中的 ${recovered.fillerChars} 个空白字符将沿用相邻文字字体`);
    } else {
      if (!nodeJobs.length) { skippedCharacters += node.characters.length; continue; }
      actions.push({ node, type: 'normal', jobs: nodeJobs, originalFonts: node.getRangeAllFontNames(0, node.characters.length) });
      readyCharacters += validCount;
      readyRuns += nodeJobs.length;
      skippedCharacters += node.characters.length - validCount;
    }
  }
  if (selected.lockedCount) issues.push(`${selected.lockedCount} 个锁定文字图层已跳过`);
  if (selected.hiddenCount) issues.push(`${selected.hiddenCount} 个隐藏文字图层已跳过`);
  if (missingFonts.size) issues.unshift(`检测到缺失字体/字重：${[...missingFonts].join('、')}`);
  return { actions, issues, fingerprint, summary: {
    selectedCount: selected.selectedCount, textLayers, readyLayers: actions.length,
    skippedLayers: textLayers - actions.length, readyRuns,
    readyCharacters, skippedCharacters, alreadyCorrect, rescueLayers, blockedMissingLayers,
    lockedCount: selected.lockedCount, hiddenCount: selected.hiddenCount,
    missingFonts: [...missingFonts]
  } };
}
async function initialize() {
  try {
    const catalog = await figma.listAvailableFontsAsync();
    byFamily = new Map();
    for (const entry of catalog) {
      const font = entry.fontName;
      const key = fold(font.family);
      if (!byFamily.has(key)) byFamily.set(key, []);
      const arr = byFamily.get(key);
      if (!arr.some(x => x.style === font.style)) arr.push({ family: font.family, style: font.style });
    }
    msg('init', { version: VERSION, families: [...new Set(catalog.map(x => x.fontName.family))].sort((a, b) => a.localeCompare(b)),
      selectedCount: figma.currentPage.selection.length });
  } catch (e) { msg('error', { message: `无法读取字体列表：${String(e.message || e)}` }); }
}
figma.on('selectionchange', () => { previewSignature = ''; msg('selection', { selectedCount: figma.currentPage.selection.length }); });
figma.ui.onmessage = async data => {
  if (busy || !data || !data.type) return;
  if (data.type === 'close') { figma.closePlugin(); return; }
  if (data.type !== 'preview' && data.type !== 'apply') return;
  const opts = optsFrom(data.options || DEFAULTS);
  if (!opts.cn || !opts.latin) { msg('error', { message: '请设置中文和英文字体。' }); return; }
  busy = true;
  try {
    const scan = buildPlan(opts);
    if (data.type === 'preview') {
      previewSignature = signature(opts, scan);
      msg('previewResult', { summary: scan.summary, issues: scan.issues.slice(0, 45) });
      return;
    }
    if (previewSignature !== signature(opts, scan)) { previewSignature = ''; msg('error', { message: '选区、文字或设置已改变，请重新扫描预检。' }); return; }
    if (!scan.actions.length) {
      previewSignature = '';
      msg('applyResult', { changedRuns: 0, changedLayers: 0, changedChars: 0,
        failedLayers: 0, failedChars: 0, unprocessedLayers: 0, unprocessedChars: 0,
        failed: scan.issues.slice(0, 45), ...scan.summary });
      return;
    }
    let changedRuns = 0, changedChars = 0, failedLayers = 0, failedChars = 0, stopped = false;
    const changed = new Set();
    const failed = scan.issues.slice(0, 45);
    const loaded = new Set();
    for (const action of scan.actions) {
      const node = action.node;
      const required = new Map();
      const all = action.type === 'normal'
        ? [...action.originalFonts, ...action.jobs.map(j => j.font)]
        : action.fullRuns.map(j => j.font);
      for (const font of all) required.set(FONT_KEY(font), { family: font.family, style: font.style });
      let attempted = false;
      let stage = '加载字体';
      try {
        for (const font of required.values()) {
          stage = `加载 ${font.family} ${font.style}`;
          const key = FONT_KEY(font);
          if (!loaded.has(key)) { await figma.loadFontAsync(font); loaded.add(key); }
        }
        stage = '写入前状态核对';
        if (signature(opts, scan) !== previewSignature ||
          !scan.fingerprint.some(item => item[0] === node.id && item[1] === node.characters &&
            item[2] === node.hasMissingFont && JSON.stringify(item[3]) ===
              JSON.stringify(node.getStyledTextSegments(['fontName', 'fontWeight', 'fontStyle']))))
          throw new Error('选区或文字样式在字体加载期间改变，请重新扫描预检');
        const before = preservedSnapshot(node);
        figma.commitUndo();
        attempted = true;
        if (action.type === 'normal') {
          for (const job of action.jobs) {
            stage = `setRangeFontName ${job.start}–${job.end} → ${job.font.family} ${job.font.style}`;
            node.setRangeFontName(job.start, job.end, job.font);
          }
        } else {
          // Whole-node .fontName requires the new font only, even if originals are missing.
          const base = action.fullRuns[0].font;
          stage = `fontName 整层初始化 → ${base.family} ${base.style}`;
          node.fontName = base;
          for (const run of action.fullRuns) {
            if (!fontEquals(run.font, base)) {
              stage = `setRangeFontName ${run.start}–${run.end} → ${run.font.family} ${run.font.style}`;
              node.setRangeFontName(run.start, run.end, run.font);
            }
          }
        }
        stage = '写入后状态核对';
        const applied = action.type === 'normal' ? action.jobs : action.fullRuns;
        for (const run of applied) {
          if (!fontMatches(node.getRangeFontName(run.start, run.end), run.font))
            throw new Error(`写入后字体核对失败（${run.start}–${run.end}）`);
        }
        if (preservedSnapshot(node) !== before) throw new Error('写入后发现文字内容或非字体样式变化');
        figma.commitUndo();
        changedRuns += applied.length;
        changedChars += action.type === 'normal'
          ? action.jobs.reduce((n, j) => n + j.end - j.start, 0) : action.changedChars;
        changed.add(node.id);
      } catch (e) {
        failedLayers++;
        failedChars += action.type === 'normal'
          ? action.jobs.reduce((n, j) => n + j.end - j.start, 0) : action.changedChars;
        let rollback = '';
        if (attempted) {
          try { figma.triggerUndo(); rollback = '；该图层已自动撤销'; }
          catch (undoError) { rollback = `；自动撤销失败：${String(undoError.message || undoError)}`; stopped = true; }
        }
        if (failed.length < 80) failed.push(`「${node.name}」[${node.id}] ${action.type === 'recovery' ? '缺失字体修复' : '普通替换'}在「${stage}」失败：${String(e.message || e)}${rollback}`);
        if (stopped) break;
      }
    }
    previewSignature = '';
    msg('applyResult', { changedRuns, changedLayers: changed.size, changedChars, failedLayers, failedChars,
      unprocessedLayers: scan.actions.length - changed.size - failedLayers,
      unprocessedChars: scan.summary.readyCharacters - changedChars - failedChars,
      stopped, failed, ...scan.summary });
    figma.notify(`已修改 ${changed.size} 个文字图层，请检查排版及文字换行。`, { timeout: 5000 });
  } catch (e) { msg('error', { message: `插件运行出错：${String(e.message || e)}` }); }
  finally { busy = false; }
};
initialize();

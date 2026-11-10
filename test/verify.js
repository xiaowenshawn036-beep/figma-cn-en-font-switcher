const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'code.js'), 'utf8');
const catalog = [
  ...['Regular', 'Medium', 'SemiBold', 'Bold'].map(style => ({ family: 'HarmonyOS Sans SC', style })),
  ...['Regular', 'Medium', 'SemiBold', 'Bold'].map(style => ({ family: 'Poppins', style })),
  ...['Regular', 'Medium', 'SemiBold', 'Bold'].map(style => ({ family: 'Inter', style })),
  { family: 'Limited', style: 'Regular' },
];
const weight = { Regular: 400, Medium: 500, SemiBold: 600, Bold: 700 };
let nextId = 0;
function text(value, fonts = 'Inter Regular', props = {}) {
  const split = value.split('');
  const specs = Array.isArray(fonts) ? fonts : split.map(() => fonts);
  const cells = split.map((ch, i) => {
    const [family, style] = specs[i].split('|');
    const fontName = style ? { family, style } : { family: 'Inter', style: 'Regular' };
    return { ch, fontName, fontWeight: weight[fontName.style] || 400,
      fontStyle: 'REGULAR', fontSize: props.sizes?.[i] || 16,
      fills: [{ type: 'SOLID', color: props.colors?.[i] || '#000000' }],
      lineHeight: { unit: 'PIXELS', value: props.lines?.[i] || 22 },
      letterSpacing: { unit: 'PIXELS', value: props.spacing?.[i] || 0 },
      paragraphSpacing: props.paragraphs?.[i] || 0 };
  });
  const node = { id: `n${++nextId}`, type: 'TEXT', name: props.name || value,
    visible: true, locked: false, x: 10, y: 20, opacity: 0.8,
    textAlignHorizontal: 'LEFT', textAlignVertical: 'TOP', cells };
  Object.defineProperty(node, 'characters', { get() { return this.cells.map(c => c.ch).join(''); } });
  return node;
}
function frame(children) { return { id: `n${++nextId}`, type: 'FRAME', visible: true, locked: false, children }; }
function harness(selection, options = {}) {
  const mixed = Symbol('mixed'), loaded = new Set(), messages = [];
  const all = [];
  function walk(n) { if (n.type === 'TEXT') all.push(n); for (const c of n.children || []) walk(c); }
  selection.forEach(walk);
  const key = f => `${f.family}|${f.style}`;
  const available = f => catalog.some(c => key(c) === key(f));
  const figma = {
    mixed, currentPage: { selection },
    showUI() {}, on() {}, notify() {}, closePlugin() {},
    ui: { postMessage(m) { messages.push(m); }, onmessage: null },
    async listAvailableFontsAsync() { return catalog.map(fontName => ({ fontName })); },
    async loadFontAsync(f) { if (!available(f)) throw Error(`missing ${key(f)}`); loaded.add(key(f)); },
    getFontFamilyVariationAxes() { return null; },
    commitUndo() { this.checkpoint = all.map(n => n.cells.map(c => structuredClone(c))); },
    triggerUndo() { all.forEach((n, i) => { n.cells = this.checkpoint[i].map(c => structuredClone(c)); }); },
  };
  for (const n of all) {
    Object.defineProperty(n, 'hasMissingFont', { get() { return this.cells.some(c => !available(c.fontName)); } });
    Object.defineProperty(n, 'fontName', {
      get() { return n.getRangeFontName(0, n.cells.length); },
      set(f) { if (!loaded.has(key(f))) throw Error(`new font unloaded: ${key(f)}`);
        n.cells.forEach(c => { c.fontName = structuredClone(f); c.fontWeight = weight[f.style] || 400; }); },
    });
    n.getStyledTextSegments = function(fields) {
      const out = [];
      for (let i = 0; i < this.cells.length; i++) {
        const c = this.cells[i];
        const data = Object.fromEntries(fields.map(f => [f, structuredClone(c[f])]));
        const previous = out.at(-1);
        if (previous && JSON.stringify(fields.map(f => previous[f])) === JSON.stringify(fields.map(f => data[f]))) {
          previous.characters += c.ch; previous.end++;
        } else out.push({ characters: c.ch, start: i, end: i + 1, ...data });
      }
      return out;
    };
    n.getRangeAllFontNames = function(start, end) {
      return [...new Map(this.cells.slice(start, end).map(c => [key(c.fontName), structuredClone(c.fontName)])).values()];
    };
    n.getRangeFontName = function(start, end) {
      const names = this.getRangeAllFontNames(start, end);
      return names.length === 1 ? names[0] : mixed;
    };
    n.setRangeFontName = function(start, end, f) {
      if (!loaded.has(key(f))) throw Error(`new font unloaded: ${key(f)}`);
      if (this.cells.some(c => !loaded.has(key(c.fontName)))) throw Error(`old font unloaded`);
      if (options.failFirst && this === all[0] && !this.failedOnce) { this.failedOnce = true; throw Error('injected write failure'); }
      this.writeCount = (this.writeCount || 0) + 1;
      if (options.failSecondRangeFirst && this === all[0] && this.writeCount === 2) throw Error('injected second-range failure');
      for (let i = start; i < end; i++) {
        this.cells[i].fontName = structuredClone(f);
        this.cells[i].fontWeight = weight[f.style] || 400;
      }
    };
  }
  vm.runInNewContext(source, { figma, __html__: '' }, { filename: 'code.js' });
  async function run(opts = {}, beforeApply) {
    await new Promise(resolve => setImmediate(resolve));
    const config = { cn: 'HarmonyOS Sans SC', latin: 'Poppins', digitsLatin: true,
      punctuationCN: true, repairMissing: false, ...opts };
    await figma.ui.onmessage({ type: 'preview', options: config });
    const preview = messages.at(-1);
    if (beforeApply) beforeApply();
    await figma.ui.onmessage({ type: 'apply', options: config });
    return { preview, result: messages.at(-1), nodes: all };
  }
  return { run, figma, messages, nodes: all };
}
function f(n) { return n.cells.map(c => c.fontName.family); }
function styles(n) { return n.cells.map(c => c.fontName.style); }
function spec(family, style = 'Regular') { return `${family}|${style}`; }
async function test(name, fn) { try { await fn(); console.log(`PASS ${name}`); } catch (e) { console.error(`FAIL ${name}`); throw e; } }

(async () => {
  await test('pure Chinese and English', async () => {
    const a = text('中文', spec('Inter')), b = text('ABC', spec('Inter'));
    const r = await harness([frame([a, b])]).run();
    assert.equal(r.result.changedLayers, 2);
    assert.deepEqual(f(a), ['HarmonyOS Sans SC', 'HarmonyOS Sans SC']);
    assert.deepEqual(f(b), ['Poppins', 'Poppins', 'Poppins']);
  });
  await test('mixed Chinese and English', async () => {
    const n = text('中文ABC', spec('Inter'));
    await harness([n]).run(); assert.deepEqual(f(n), ['HarmonyOS Sans SC', 'HarmonyOS Sans SC', 'Poppins', 'Poppins', 'Poppins']);
  });
  await test('different font sizes and spacing stay', async () => {
    const n = text('中A', spec('Inter'), { sizes: [16, 24], lines: [24, 30], spacing: [0, 1], paragraphs: [4, 8] });
    const before = n.cells.map(c => [c.fontSize, c.lineHeight, c.letterSpacing, c.paragraphSpacing]);
    await harness([n]).run(); assert.deepEqual(n.cells.map(c => [c.fontSize, c.lineHeight, c.letterSpacing, c.paragraphSpacing]), before);
  });
  await test('four mixed weights stay mapped', async () => {
    const n = text('中A中A', ['Regular', 'Medium', 'SemiBold', 'Bold'].map(s => spec('Inter', s)));
    await harness([n]).run(); assert.deepEqual(styles(n), ['Regular', 'Medium', 'SemiBold', 'Bold']);
  });
  await test('mixed original fonts colors sizes', async () => {
    const n = text('中A', [spec('Inter'), spec('Microsoft YaHei UI')], { colors: ['#f00', '#0f0'], sizes: [18, 32] });
    const before = n.cells.map(c => [c.fills, c.fontSize]);
    const r = await harness([n]).run({ repairMissing: true });
    assert.equal(r.result.changedLayers, 1); assert.deepEqual(n.cells.map(c => [c.fills, c.fontSize]), before);
  });
  await test('missing Microsoft YaHei UI recovery', async () => {
    const n = text('中文AB', spec('Microsoft YaHei UI'));
    const r = await harness([n]).run({ repairMissing: true });
    assert.equal(r.preview.summary.rescueLayers, 1); assert.equal(r.result.changedLayers, 1);
    assert.deepEqual(f(n), ['HarmonyOS Sans SC', 'HarmonyOS Sans SC', 'Poppins', 'Poppins']);
  });
  await test('available source font normal path', async () => {
    const n = text('中A', spec('Inter')); const r = await harness([n]).run();
    assert.equal(r.preview.summary.rescueLayers, 0); assert.equal(r.result.changedLayers, 1);
  });
  await test('unavailable target weight skips without Regular fallback', async () => {
    const n = text('中A', spec('Inter', 'Medium'));
    const h = harness([n]);
    const r = await h.run({ cn: 'Limited', latin: 'Poppins' });
    assert.equal(r.result.changedLayers, 1); assert.equal(n.cells[0].fontName.family, 'Inter');
    assert.equal(n.cells[0].fontName.style, 'Medium');
    assert.equal(n.cells[1].fontName.style, 'Medium');
  });
  await test('nested frame traversal', async () => {
    const n = text('中A', spec('Inter'));
    const r = await harness([frame([frame([n])])]).run(); assert.equal(r.preview.summary.textLayers, 1);
  });
  await test('digits Chinese punctuation special symbols', async () => {
    const n = text('中9，A★', spec('Inter'));
    await harness([n]).run(); assert.deepEqual(f(n), ['HarmonyOS Sans SC', 'Poppins', 'HarmonyOS Sans SC', 'Poppins', 'Inter']);
  });
  await test('missing font unknown symbol skips full layer', async () => {
    const n = text('中★', spec('Microsoft YaHei UI'));
    const r = await harness([n]).run({ repairMissing: true }); assert.equal(r.result.changedLayers, 0);
    assert.deepEqual(f(n), ['Microsoft YaHei UI', 'Microsoft YaHei UI']);
  });
  await test('write failure rolls back one layer and continues', async () => {
    const a = text('中A', spec('Inter')), b = text('中B', spec('Inter'));
    const r = await harness([frame([a, b])], { failFirst: true }).run();
    assert.equal(r.result.failedLayers, 1); assert.equal(r.result.changedLayers, 1);
    assert.deepEqual(f(a), ['Inter', 'Inter']); assert.deepEqual(f(b), ['HarmonyOS Sans SC', 'Poppins']);
  });
  await test('text changed after preview invalidates apply', async () => {
    const n = text('中A', spec('Inter'));
    const r = await harness([n]).run({}, () => { n.cells[1].ch = 'B'; });
    assert.equal(r.result.type, 'error'); assert.deepEqual(f(n), ['Inter', 'Inter']);
  });
  await test('partial first-layer write is undone before next layer', async () => {
    const a = text('中A', spec('Inter')), b = text('中B', spec('Inter'));
    const r = await harness([frame([a, b])], { failSecondRangeFirst: true }).run();
    assert.equal(r.result.failedLayers, 1); assert.equal(r.result.changedLayers, 1);
    assert.deepEqual(f(a), ['Inter', 'Inter']); assert.deepEqual(f(b), ['HarmonyOS Sans SC', 'Poppins']);
  });
})().catch(() => { process.exitCode = 1; });

import {
  STARTER_FILES, STARTER_MAIN, MAX_PROJECT_BYTES,
  isText, isImage, isTex, kindOf, basename, dirname, validatePath, detectMain,
  readFiles, stripCommonRoot, filesFromDrop, toBase64, formatBytes, fileSize, checkProject,
} from './project.js';
import { loadProject, saveProject } from './store.js';

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const els = {
  engine: $('engine'), compile: $('compile'), compileKbd: $('compile-kbd'), auto: $('auto-compile'),
  newFile: $('new-file'), uploadFiles: $('upload-files'), uploadFolder: $('upload-folder'), reset: $('reset'),
  fileInput: $('file-input'), folderInput: $('folder-input'),
  dropzone: $('dropzone'), tree: $('tree'), fileCount: $('file-count'),
  activeIcon: $('active-icon'), activePath: $('active-path'), activeMain: $('active-main'),
  setMain: $('set-main'), rename: $('rename'), del: $('delete'),
  editorFrame: $('editor-frame'), editor: $('editor'), gutter: $('gutter'), viewer: $('viewer'),
  cursorPos: $('cursor-pos'), saveState: $('save-state'),
  pill: $('pill'), open: $('open'), download: $('download'),
  status: $('status'), backendNote: $('backend-note'), previewPane: $('preview-pane'),
  warnbar: $('warnbar'), warnbarToggle: $('warnbar-toggle'), warnbarText: $('warnbar-text'), warnbarList: $('warnbar-list'),
  errorReason: $('error-reason'), errorList: $('error-list'), logDetails: $('log-details'), log: $('log'),
  dialog: $('dialog'), toast: $('toast'),
};
const views = { empty: $('empty'), loading: $('loading'), error: $('error'), pdf: $('pdf') };

// ---------- State ----------
const state = {
  files: new Map(), // path -> { text } | { blob }
  main: null,
  active: null,
  errorLines: new Map(), // path -> Set<line>
  version: 0,
  compiledVersion: -1,
  attemptedVersion: -1,
  compiling: false,
  pdfUrl: null,
  viewerUrl: null,
};

// ---------- Icons ----------
const ICONS = {
  tex: '<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  bib: '<path d="M5 19V5.5A2.5 2.5 0 0 1 7.5 3H19v15H7.5A2.5 2.5 0 0 0 5 20.5 1.5 1.5 0 0 0 6.5 21H19"/><path d="M9 7.5h6"/>',
  image: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><circle cx="9" cy="9" r="1.8"/><path d="m20.5 15-4.5-4.5L6 20.5"/>',
  style: '<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5M10 12l-2 2.5 2 2.5M14 12l2 2.5-2 2.5"/>',
  file: '<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5"/>',
  folder: '<path d="M3.5 18.5v-12A1.5 1.5 0 0 1 5 5h4.2l2 2.5H19a1.5 1.5 0 0 1 1.5 1.5v9.5A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
};
const svg = (name, cls = 'icon') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
const fileIcon = (path) => `<span class="file-icon k-${kindOf(path)}">${svg(kindOf(path))}</span>`;

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

// ---------- Toast & dialog ----------
let toastTimer;
function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 3800);
}

/**
 * Small modal dialog. Resolves to { action: 'ok' | 'alt', value } or null when cancelled.
 */
function ask({ title, body = '', input = null, ok = 'OK', alt = null, danger = false, validate = null }) {
  const d = els.dialog;
  const field = $('dialog-field');
  const inputEl = $('dialog-input');
  const err = $('dialog-error');
  const okBtn = $('dialog-ok');
  const altBtn = $('dialog-alt');
  const cancelBtn = $('dialog-cancel');

  $('dialog-title').textContent = title;
  $('dialog-body').textContent = body;
  field.hidden = !input;
  err.textContent = '';
  inputEl.removeAttribute('aria-invalid');
  if (input) {
    $('dialog-label').textContent = input.label || 'File name';
    inputEl.value = input.value || '';
    inputEl.placeholder = input.placeholder || '';
  }
  okBtn.textContent = ok;
  okBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  altBtn.hidden = !alt;
  altBtn.textContent = alt || '';

  return new Promise((resolve) => {
    const finish = (result) => {
      cleanup();
      d.close();
      resolve(result);
    };
    const onSubmit = (e) => {
      e.preventDefault();
      const value = input ? inputEl.value.trim() : null;
      if (validate) {
        const msg = validate(value);
        if (msg) {
          err.textContent = msg;
          inputEl.setAttribute('aria-invalid', 'true');
          inputEl.focus();
          return;
        }
      }
      finish({ action: 'ok', value });
    };
    const onAlt = () => finish({ action: 'alt', value: null });
    const onCancel = () => finish(null);
    const onEsc = (e) => { e.preventDefault(); finish(null); };
    const onInput = () => { err.textContent = ''; inputEl.removeAttribute('aria-invalid'); };
    function cleanup() {
      $('dialog-form').removeEventListener('submit', onSubmit);
      altBtn.removeEventListener('click', onAlt);
      cancelBtn.removeEventListener('click', onCancel);
      d.removeEventListener('cancel', onEsc);
      inputEl.removeEventListener('input', onInput);
    }
    $('dialog-form').addEventListener('submit', onSubmit);
    altBtn.addEventListener('click', onAlt);
    cancelBtn.addEventListener('click', onCancel);
    d.addEventListener('cancel', onEsc);
    inputEl.addEventListener('input', onInput);

    d.showModal();
    if (input) {
      inputEl.focus();
      const dot = inputEl.value.lastIndexOf('.');
      const slash = inputEl.value.lastIndexOf('/') + 1;
      inputEl.setSelectionRange(slash, dot > slash ? dot : inputEl.value.length);
    } else {
      (danger ? cancelBtn : okBtn).focus();
    }
  });
}

// ---------- Persistence ----------
let saveTimer;
function changed({ content = true } = {}) {
  if (content) {
    state.version++;
    updatePill();
    scheduleAutoCompile();
  }
  els.saveState.textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const ok = await saveProject({
      files: [...state.files].map(([path, f]) => ({ path, ...f })),
      main: state.main,
      active: state.active,
      engine: els.engine.value,
    });
    els.saveState.textContent = ok ? 'Saved in this browser' : 'Not saved (browser storage unavailable)';
  }, 400);
}

// ---------- File tree ----------
function buildTree(paths) {
  const root = { folders: new Map(), files: [] };
  for (const p of paths) {
    const parts = p.split('/');
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.folders.has(part)) node.folders.set(part, { folders: new Map(), files: [] });
      node = node.folders.get(part);
    }
    node.files.push(p);
  }
  return root;
}

function renderTree() {
  const paths = [...state.files.keys()].sort((a, b) => a.localeCompare(b));
  const total = paths.reduce((n, p) => n + fileSize(state.files.get(p)), 0);
  els.fileCount.textContent = `${paths.length} file${paths.length === 1 ? '' : 's'} · ${formatBytes(total)}`;

  const renderNode = (node, depth) => {
    const items = [];
    for (const [name, child] of [...node.folders].sort(([a], [b]) => a.localeCompare(b))) {
      items.push(h('li', {},
        h('div', { class: 'tree-folder', style: `--depth:${depth}`, html: `${svg('folder')}<span>${escapeHtml(name)}</span>` }),
        h('ul', { role: 'list' }, renderNode(child, depth + 1))));
    }
    for (const path of node.files) {
      const hasErr = state.errorLines.has(path);
      const btn = h('button', {
        type: 'button', class: 'tree-file', style: `--depth:${depth}`,
        'aria-current': path === state.active ? 'true' : 'false',
        title: path,
        onclick: () => openFile(path),
      });
      btn.innerHTML = `${fileIcon(path)}<span class="name">${escapeHtml(basename(path))}</span>`;
      if (path === state.main) btn.append(h('span', { class: 'tag tag-main' }, 'main'));
      if (hasErr) btn.append(h('span', { class: 'dot', title: 'Has errors' }), h('span', { class: 'visually-hidden' }, ' (has errors)'));
      items.push(h('li', {}, btn));
    }
    return items;
  };

  els.tree.replaceChildren(...(paths.length
    ? renderNode(buildTree(paths), 0)
    : [h('li', { class: 'tree-empty' }, 'No files yet. Create or upload one.')]));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Editor ----------
function lineHeight() {
  return parseFloat(getComputedStyle(els.editor).lineHeight) || 21;
}

function renderGutter() {
  const count = els.editor.value.split('\n').length;
  const errs = state.errorLines.get(state.active) || new Set();
  let html = '';
  for (let i = 1; i <= count; i++) html += `<div${errs.has(i) ? ' class="err"' : ''}>${i}</div>`;
  els.gutter.innerHTML = html;
  els.gutter.scrollTop = els.editor.scrollTop;
}

function updateCursor() {
  const before = els.editor.value.slice(0, els.editor.selectionStart);
  const line = before.split('\n').length;
  const col = before.length - before.lastIndexOf('\n');
  els.cursorPos.textContent = `Ln ${line}, Col ${col}`;
}

function renderActive() {
  const path = state.active;
  const file = path && state.files.get(path);
  if (state.viewerUrl) { URL.revokeObjectURL(state.viewerUrl); state.viewerUrl = null; }

  els.activePath.textContent = path || 'No file selected';
  els.activeIcon.innerHTML = path ? fileIcon(path) : '';
  els.activeMain.hidden = !path || path !== state.main;
  els.setMain.hidden = !path || !isTex(path) || path === state.main;
  els.rename.hidden = !path;
  els.del.hidden = !path;

  if (file && typeof file.text === 'string') {
    els.editorFrame.hidden = false;
    els.viewer.hidden = true;
    els.editor.value = file.text;
    els.editor.setAttribute('aria-label', `Editing ${path}`);
    els.editor.scrollTop = 0;
    els.editor.setSelectionRange(0, 0);
    renderGutter();
    updateCursor();
    return;
  }

  els.editorFrame.hidden = true;
  els.viewer.hidden = false;
  els.viewer.replaceChildren();
  if (!file) {
    els.viewer.append(h('h3', {}, 'No file selected'), h('p', {}, 'Choose a file in the sidebar, or create a new one.'));
    return;
  }
  const rel = relativeToMain(path);
  if (isImage(path)) {
    state.viewerUrl = URL.createObjectURL(file.blob);
    els.viewer.append(h('img', { src: state.viewerUrl, alt: `Preview of ${basename(path)}` }));
  }
  els.viewer.append(
    h('h3', {}, basename(path)),
    h('p', {}, `${kindOf(path) === 'image' ? 'Image' : 'Binary file'} · ${formatBytes(file.blob.size)} · can't be edited here.`),
  );
  if (kindOf(path) === 'image') {
    els.viewer.append(h('p', {}, 'Use it in your document with:'), h('code', {}, `\\includegraphics[width=\\linewidth]{${rel}}`));
  }
}

function relativeToMain(path) {
  const base = state.main ? dirname(state.main) : '';
  return base && path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path;
}

function openFile(path, line) {
  if (!state.files.has(path)) return;
  if (state.active !== path) {
    state.active = path;
    renderActive();
    renderTree();
    changed({ content: false });
  }
  if (line) goToLine(line);
}

function goToLine(n) {
  if (els.editorFrame.hidden) return;
  const lines = els.editor.value.split('\n');
  const line = Math.min(Math.max(1, n), lines.length);
  let start = 0;
  for (let i = 0; i < line - 1; i++) start += lines[i].length + 1;
  els.editor.focus();
  els.editor.setSelectionRange(start, start + lines[line - 1].length);
  els.editor.scrollTop = Math.max(0, (line - 1) * lineHeight() - els.editor.clientHeight / 3);
  els.gutter.scrollTop = els.editor.scrollTop;
  updateCursor();
  if (matchMedia('(max-width: 960px)').matches) els.editorFrame.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ---------- Project operations ----------
function setProject(entries, main) {
  state.files = new Map(entries.map((e) => [e.path, e.blob ? { blob: e.blob } : { text: e.text ?? '' }]));
  state.main = main && state.files.has(main) ? main : detectMain(state.files);
  state.active = state.main || [...state.files.keys()][0] || null;
  state.errorLines = new Map();
  renderTree();
  renderActive();
}

function isUntouchedStarter() {
  if (state.files.size !== Object.keys(STARTER_FILES).length) return false;
  return Object.entries(STARTER_FILES).every(([p, t]) => state.files.get(p)?.text === t);
}

async function addEntries(entries, { folderName = null } = {}) {
  const { added, skipped } = await readFiles(entries);
  if (!added.length) {
    toast(skipped.length ? `Nothing added: ${skipped.length} file(s) skipped (${skipped[0].why}).` : 'No files to add.');
    return;
  }
  const incomingBytes = added.reduce((n, e) => n + fileSize(e), 0);

  let replace = false;
  if (folderName && state.files.size && !isUntouchedStarter()) {
    const choice = await ask({
      title: `Open folder "${folderName}"?`,
      body: `It has ${added.length} file${added.length === 1 ? '' : 's'}. You can replace your current project, or add the files to it.`,
      ok: 'Replace project', alt: 'Add to project',
    });
    if (!choice) return;
    replace = choice.action === 'ok';
  } else if (folderName) {
    replace = true;
  }

  const currentBytes = replace ? 0 : [...state.files.values()].reduce((n, f) => n + fileSize(f), 0);
  if (currentBytes + incomingBytes > MAX_PROJECT_BYTES) {
    toast(`That would make the project larger than ${formatBytes(MAX_PROJECT_BYTES)}. Nothing was added.`);
    return;
  }

  if (replace) {
    setProject(added, null);
  } else {
    let replaced = 0;
    for (const e of added) {
      if (state.files.has(e.path)) replaced++;
      state.files.set(e.path, e.blob ? { blob: e.blob } : { text: e.text });
    }
    if (!state.main || !state.files.has(state.main)) state.main = detectMain(state.files);
    const firstText = added.find((e) => isTex(e.path)) || added[0];
    state.active = firstText.path;
    renderTree();
    renderActive();
    if (replaced) toast(`Replaced ${replaced} existing file${replaced === 1 ? '' : 's'}.`);
  }
  changed();
  const note = skipped.length ? ` Skipped ${skipped.length} build/hidden file${skipped.length === 1 ? '' : 's'}.` : '';
  announce(`Added ${added.length} file${added.length === 1 ? '' : 's'}.${note}`);
  if (note || !replace) toast(`Added ${added.length} file${added.length === 1 ? '' : 's'}.${note}`);
  else toast(`Opened "${folderName}" · main file: ${state.main || 'none found'}`);
}

async function newFile() {
  const suggested = state.files.has('chapter.tex') ? 'chapters/section.tex' : 'chapter.tex';
  const res = await ask({
    title: 'New file',
    body: 'Use a folder in the name to create one, e.g. chapters/intro.tex.',
    input: { label: 'File name', value: suggested, placeholder: 'chapters/intro.tex' },
    ok: 'Create',
    validate: (v) => validatePath(v)
      || (state.files.has(v) ? 'A file with this name already exists.' : null)
      || (!isText(v) ? 'Only text files (.tex, .bib, .sty, …) can be created here. Upload images instead.' : null),
  });
  if (!res) return;
  state.files.set(res.value, { text: isTex(res.value) && !state.main ? '\\documentclass{article}\n\\begin{document}\n\n\\end{document}\n' : '' });
  if (!state.main && isTex(res.value)) state.main = res.value;
  state.active = res.value;
  renderTree();
  renderActive();
  changed();
  els.editor.focus();
  if (isTex(res.value) && res.value !== state.main) {
    const rel = relativeToMain(res.value).replace(/\.tex$/, '');
    toast(`Created ${res.value}. Include it from ${basename(state.main)} with \\input{${rel}}.`);
  }
}

async function renameActive() {
  const from = state.active;
  if (!from) return;
  const res = await ask({
    title: 'Rename file',
    input: { label: 'New name', value: from },
    ok: 'Rename',
    validate: (v) => validatePath(v) || (v !== from && state.files.has(v) ? 'A file with this name already exists.' : null),
  });
  if (!res || res.value === from) return;
  const entry = state.files.get(from);
  const next = new Map();
  for (const [p, f] of state.files) next.set(p === from ? res.value : p, p === from ? entry : f);
  state.files = next;
  if (state.main === from) state.main = isTex(res.value) ? res.value : detectMain(state.files);
  state.active = res.value;
  state.errorLines.delete(from);
  renderTree();
  renderActive();
  changed();
}

async function deleteActive() {
  const path = state.active;
  if (!path) return;
  const res = await ask({
    title: `Delete ${basename(path)}?`,
    body: path === state.main ? 'This is your main file. Another .tex file will become the main file.' : 'This cannot be undone.',
    ok: 'Delete', danger: true,
  });
  if (!res) return;
  state.files.delete(path);
  state.errorLines.delete(path);
  if (state.main === path) state.main = detectMain(state.files);
  state.active = state.main || [...state.files.keys()].sort()[0] || null;
  renderTree();
  renderActive();
  changed();
}

function setActiveAsMain() {
  if (!state.active || !isTex(state.active)) return;
  state.main = state.active;
  renderTree();
  renderActive();
  changed();
  toast(`${state.main} is now the main file.`);
}

async function resetProject() {
  if (!isUntouchedStarter()) {
    const res = await ask({
      title: 'Reset to the example?',
      body: 'This replaces all files in your project with the starter example. Your current files will be lost.',
      ok: 'Reset project', danger: true,
    });
    if (!res) return;
  }
  setProject(Object.entries(STARTER_FILES).map(([path, text]) => ({ path, text })), STARTER_MAIN);
  clearResult();
  changed();
  els.editor.focus();
}

// ---------- Preview ----------
function show(view) {
  for (const [name, el] of Object.entries(views)) el.hidden = name !== view;
}

function announce(msg) { els.status.textContent = msg; }

function setPill(stateName, text) {
  els.pill.dataset.state = stateName;
  els.pill.textContent = text;
}

let lastPill = { state: 'idle', text: 'Not compiled' };
function updatePill() {
  if (state.compiling) return;
  if (lastPill.state === 'ok' && state.version !== state.compiledVersion) setPill('stale', 'Edited since compile');
  else setPill(lastPill.state, lastPill.text);
}

function setPdf(blob) {
  if (state.pdfUrl) URL.revokeObjectURL(state.pdfUrl);
  state.pdfUrl = blob ? URL.createObjectURL(blob) : null;
  const name = `${basename(state.main || 'document.tex').replace(/\.[^.]+$/, '')}.pdf`;
  if (state.pdfUrl) {
    views.pdf.src = state.pdfUrl;
    els.download.href = state.pdfUrl;
    els.download.download = name;
    els.open.href = state.pdfUrl;
    els.download.removeAttribute('aria-disabled');
    els.download.removeAttribute('tabindex');
    els.open.hidden = false;
  } else {
    views.pdf.removeAttribute('src');
    els.download.href = '#';
    els.download.setAttribute('aria-disabled', 'true');
    els.download.setAttribute('tabindex', '-1');
    els.open.hidden = true;
  }
}

function clearResult() {
  setPdf(null);
  showWarnings([]);
  state.errorLines = new Map();
  lastPill = { state: 'idle', text: 'Not compiled' };
  updatePill();
  els.backendNote.innerHTML = '&nbsp;';
  renderTree();
  renderGutter();
  show('empty');
}

function problemItem(p) {
  const meta = h('div', { class: 'problem-meta' });
  if (p.file && state.files.has(p.file)) {
    const label = p.line ? `${p.file}:${p.line}` : p.file;
    meta.append(h('button', {
      type: 'button', class: 'loc', 'aria-label': `Go to ${p.file}${p.line ? `, line ${p.line}` : ''}`,
      onclick: () => openFile(p.file, p.line),
    }, label));
  } else if (p.line) {
    meta.append(h('span', {}, `Line ${p.line}`));
  }
  if (p.context) meta.append(h('code', {}, p.context));
  return h('li', { class: `problem ${p.severity === 'warning' ? 'warning' : ''}` },
    h('p', { class: 'problem-msg' }, p.message),
    meta.childNodes.length ? meta : null,
    p.hint ? h('p', { class: 'problem-hint' }, p.hint) : null);
}

function showWarnings(list) {
  els.warnbar.hidden = !list.length;
  if (!list.length) return;
  els.warnbarText.textContent = list.length === 1 ? `1 warning: ${list[0].message}` : `${list.length} warnings to check`;
  els.warnbarList.replaceChildren(...list.map(problemItem));
  const open = els.warnbarToggle.getAttribute('aria-expanded') === 'true';
  els.warnbarList.hidden = !open;
}

function markErrorLines(problems) {
  state.errorLines = new Map();
  for (const p of problems) {
    if (!p.file || !p.line || p.severity === 'warning') continue;
    if (!state.errorLines.has(p.file)) state.errorLines.set(p.file, new Set());
    state.errorLines.get(p.file).add(p.line);
  }
  renderTree();
  if (!els.editorFrame.hidden) renderGutter();
}

function showErrors(data, warnings) {
  const errors = data.errors || [];
  const hard = errors.filter((e) => e.severity !== 'warning');
  const soft = [...errors.filter((e) => e.severity === 'warning'), ...warnings];

  els.errorReason.textContent = data.reason
    || (hard.length === 1 ? 'The compiler found 1 problem:' : hard.length ? `The compiler found ${hard.length} problems:` : '');
  els.errorList.replaceChildren(...[...hard, ...soft].map(problemItem));
  els.log.textContent = data.log || '';
  els.logDetails.hidden = !data.log;
  els.logDetails.open = !errors.length && !!data.log;
  showWarnings([]);
  markErrorLines(hard);
  show('error');
}

// ---------- Auto compile ----------
const AUTO_KEY = 'tex-compiler:auto-compile';
const AUTO_DELAY_MS = 1500;
let autoTimer = null;
let autoQueued = false;

function scheduleAutoCompile() {
  clearTimeout(autoTimer);
  if (!els.auto.checked || !state.main) return;
  autoTimer = setTimeout(() => compile({ auto: true }), AUTO_DELAY_MS);
}

function setAutoCompile(on) {
  els.auto.checked = on;
  try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch { /* ignore */ }
  if (on && state.version !== state.attemptedVersion) scheduleAutoCompile();
  if (!on) clearTimeout(autoTimer);
}

// ---------- Compile ----------
async function compile({ auto = false } = {}) {
  clearTimeout(autoTimer);
  if (state.compiling) {
    // Edits arrived while compiling: run once more when this one finishes.
    if (auto) autoQueued = true;
    return;
  }
  if (auto && state.version === state.attemptedVersion) return; // nothing new to compile
  if (!state.main) {
    if (auto) return;
    showErrors({ reason: 'There is no main .tex file. Create one with “New file”, or upload your project.', errors: [] }, []);
    setPill('error', 'Failed');
    return;
  }

  // Pre-compile checks: missing .bib files, images, \input files and citation keys.
  const warnings = checkProject(state.files, state.main);
  const version = state.version;
  state.attemptedVersion = version;

  state.compiling = true;
  els.compile.setAttribute('aria-busy', 'true');
  els.compile.querySelector('.btn-label').textContent = 'Compiling…';
  setPill('busy', auto ? 'Auto-compiling…' : 'Compiling…');
  // In auto mode keep the last PDF or error list on screen until the new result arrives.
  if (!auto || !views.empty.hidden || !views.loading.hidden) {
    show('loading');
    showWarnings([]);
  }
  if (!auto) announce('Compiling…');

  try {
    const files = await Promise.all([...state.files].map(async ([path, f]) => (
      f.blob ? { path, base64: await toBase64(f.blob) } : { path, content: f.text })));
    const res = await fetch('/api/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files, main: state.main, engine: els.engine.value }),
    });
    const type = res.headers.get('Content-Type') || '';
    const engineName = els.engine.options[els.engine.selectedIndex].text;

    if (res.ok && type.startsWith('application/pdf')) {
      setPdf(await res.blob());
      markErrorLines([]);
      show('pdf');
      showWarnings(warnings);
      const secs = (Number(res.headers.get('X-Compile-Ms')) / 1000).toFixed(1);
      state.compiledVersion = version;
      lastPill = { state: 'ok', text: `Compiled · ${secs}s` };
      updatePill();
      els.backendNote.textContent = `${basename(state.main)} · ${engineName} · ${describeBackend(res.headers.get('X-Compile-Backend'))}`;
      announce(`Compilation succeeded${warnings.length ? ` with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''}. The PDF preview is updated.`);
      if (!auto && matchMedia('(max-width: 960px)').matches) els.previewPane.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    let data;
    try { data = await res.json(); } catch { data = { reason: `The server responded with HTTP ${res.status}.`, errors: [] }; }
    setPdf(null);
    showErrors(data, warnings);
    lastPill = { state: 'error', text: 'Failed' };
    updatePill();
    els.backendNote.textContent = data.backend ? `${engineName} · ${describeBackend(data.backend)}` : '\u00a0';
    const n = (data.errors || []).length;
    announce(n ? `Compilation failed with ${n} problem${n === 1 ? '' : 's'}.` : 'Compilation failed.');
    if (!auto) views.error.focus(); // never pull focus away from the editor while typing
  } catch {
    setPdf(null);
    showErrors({ reason: 'Could not reach the app server. Is it still running? Check the terminal where you started it.', errors: [] }, warnings);
    lastPill = { state: 'error', text: 'Failed' };
    updatePill();
    announce('Compilation failed: the app server is unreachable.');
  } finally {
    state.compiling = false;
    els.compile.setAttribute('aria-busy', 'false');
    els.compile.querySelector('.btn-label').textContent = 'Compile';
    updatePill();
    if (autoQueued) {
      autoQueued = false;
      scheduleAutoCompile();
    }
  }
}

function describeBackend(backend) {
  return backend === 'local' ? 'local TeX installation' : 'online compiler (latex.ytotech.com)';
}

// ---------- Wire up ----------
els.editor.addEventListener('input', () => {
  const f = state.files.get(state.active);
  if (!f || typeof f.text !== 'string') return;
  f.text = els.editor.value;
  if (state.errorLines.has(state.active)) {
    state.errorLines.delete(state.active);
    renderTree();
  }
  renderGutter();
  changed();
});
els.editor.addEventListener('scroll', () => { els.gutter.scrollTop = els.editor.scrollTop; });
for (const evt of ['keyup', 'click', 'select', 'focus']) els.editor.addEventListener(evt, updateCursor);

els.compile.addEventListener('click', () => compile());
els.auto.addEventListener('change', () => {
  setAutoCompile(els.auto.checked);
  toast(els.auto.checked ? 'Auto compile is on. The PDF updates shortly after you stop typing.' : 'Auto compile is off.');
});
els.engine.addEventListener('change', () => changed());
els.newFile.addEventListener('click', newFile);
els.uploadFiles.addEventListener('click', () => els.fileInput.click());
els.uploadFolder.addEventListener('click', () => els.folderInput.click());
els.reset.addEventListener('click', resetProject);
els.setMain.addEventListener('click', setActiveAsMain);
els.rename.addEventListener('click', renameActive);
els.del.addEventListener('click', deleteActive);

els.fileInput.addEventListener('change', async () => {
  const entries = [...els.fileInput.files].map((file) => ({ file, path: file.name }));
  els.fileInput.value = '';
  await addEntries(entries);
});
els.folderInput.addEventListener('change', async () => {
  const raw = [...els.folderInput.files].map((file) => ({ file, path: file.webkitRelativePath || file.name }));
  els.folderInput.value = '';
  const { entries, root } = stripCommonRoot(raw);
  await addEntries(entries, { folderName: root || 'folder' });
});

// Drag and drop onto the sidebar (files or a whole folder).
let dragDepth = 0;
els.dropzone.addEventListener('dragenter', (e) => {
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
  e.preventDefault();
  dragDepth++;
  els.dropzone.classList.add('dragging');
});
els.dropzone.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
els.dropzone.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) els.dropzone.classList.remove('dragging');
});
els.dropzone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  els.dropzone.classList.remove('dragging');
  const { entries, folder } = await filesFromDrop(e.dataTransfer);
  if (folder) {
    const { entries: stripped } = stripCommonRoot(entries);
    await addEntries(stripped, { folderName: folder });
  } else {
    await addEntries(entries);
  }
});
// Avoid the browser opening a file dropped elsewhere on the page.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

els.warnbarToggle.addEventListener('click', () => {
  const open = els.warnbarToggle.getAttribute('aria-expanded') !== 'true';
  els.warnbarToggle.setAttribute('aria-expanded', String(open));
  els.warnbarToggle.querySelector('.warnbar-chev').textContent = open ? 'Hide' : 'Show';
  els.warnbarList.hidden = !open;
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    compile();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    toast('Your project is saved automatically in this browser.');
  }
});

if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) els.compileKbd.textContent = '⌘ ↵';

// ---------- Start ----------
(async () => {
  const saved = await loadProject();
  if (saved && saved.files.length) {
    setProject(saved.files, saved.main);
    if (saved.active && state.files.has(saved.active)) { state.active = saved.active; renderTree(); renderActive(); }
    if (saved.engine) els.engine.value = saved.engine;
  } else {
    setProject(Object.entries(STARTER_FILES).map(([path, text]) => ({ path, text })), STARTER_MAIN);
  }
  show('empty');
  try { if (localStorage.getItem(AUTO_KEY) === '1') els.auto.checked = true; } catch { /* ignore */ }
  if (els.auto.checked) compile({ auto: true });
})();

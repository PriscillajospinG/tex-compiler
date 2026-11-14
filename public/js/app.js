import {
  STARTER_FILES, STARTER_MAIN, MAX_PROJECT_BYTES,
  isText, isImage, isTex, kindOf, basename, dirname, validatePath, detectMain,
  readFiles, stripCommonRoot, filesFromDrop, toBase64, formatBytes, fileSize, checkProject,
} from './project.js';
import { loadProject, saveProject } from './store.js';
import { CodeEditor } from './editor.js';
import { PdfViewer } from './pdfview.js';

// =========================================================
// DOM
// =========================================================
const $ = (id) => document.getElementById(id);
const els = {
  layout: $('layout'), sidebar: $('sidebar'), toggleSidebar: $('toggle-sidebar'), splitter: $('splitter'),
  engine: $('engine'), compile: $('compile'), compileKbd: $('compile-kbd'), auto: $('auto-compile'), progress: $('progress'),
  newFile: $('new-file'), uploadFiles: $('upload-files'), uploadFolder: $('upload-folder'), reset: $('reset'),
  fileInput: $('file-input'), folderInput: $('folder-input'),
  dropzone: $('dropzone'), tree: $('tree'), fileCount: $('file-count'),
  activeIcon: $('active-icon'), activeDir: $('active-dir'), activeName: $('active-name'), activeMain: $('active-main'),
  setMain: $('set-main'), rename: $('rename'), del: $('delete'),
  code: $('code'), textarea: $('editor'), viewer: $('viewer'),
  cursorPos: $('cursor-pos'), saveState: $('save-state'),
  pill: $('pill'), open: $('open'), download: $('download'),
  pdfTools: $('pdf-tools'), pageLabel: $('page-label'), zoomIn: $('zoom-in'), zoomOut: $('zoom-out'), zoomLabel: $('zoom-label'),
  status: $('status'), backendNote: $('backend-note'),
  warnbar: $('warnbar'), warnbarToggle: $('warnbar-toggle'), warnbarText: $('warnbar-text'), warnbarList: $('warnbar-list'),
  errorReason: $('error-reason'), errorList: $('error-list'), logDetails: $('log-details'), log: $('log'),
  pdfFrame: $('pdf-frame'), tabs: [...document.querySelectorAll('.tab')], tabDot: $('tab-dot'),
  dialog: $('dialog'), toast: $('toast'),
};
const views = { empty: $('empty'), loading: $('loading'), error: $('error'), pdf: $('pdf'), frame: $('pdf-frame') };
const mobile = matchMedia('(max-width: 900px)');

// =========================================================
// State
// =========================================================
const state = {
  files: new Map(), // path -> { text } | { blob }
  main: null,
  active: null,
  errorLines: new Map(), // path -> Set<line>
  collapsed: new Set(), // collapsed folder paths
  version: 0,
  compiledVersion: -1,
  attemptedVersion: -1,
  compiling: false,
  pdfUrl: null,
  viewerUrl: null,
  hasPdf: false,
};

const editor = new CodeEditor(els.code, {
  onInput: (text) => {
    const f = state.files.get(state.active);
    if (!f || typeof f.text !== 'string') return;
    f.text = text;
    if (state.errorLines.has(state.active)) {
      state.errorLines.delete(state.active);
      editor.setErrorLines([]);
      renderTree();
    }
    changed();
  },
  onCursor: ({ line, col, selected }) => {
    els.cursorPos.textContent = selected ? `Ln ${line}, Col ${col} (${selected} selected)` : `Ln ${line}, Col ${col}`;
  },
});

let pdf = null; // created once pdf.js has loaded

// =========================================================
// Small helpers
// =========================================================
const ICONS = {
  tex: '<path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5z"/><path d="M13.5 3.5v5h5M9 13h6M9 16.5h4"/>',
  bib: '<path d="M5.5 18.5V6a2.5 2.5 0 0 1 2.5-2.5h10.5v14H8a2.5 2.5 0 0 0-2.5 2.5v0A1.5 1.5 0 0 0 7 21.5h11.5"/><path d="M9.5 7.5h5"/>',
  image: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><circle cx="9.5" cy="9.5" r="1.6"/><path d="m20 15-4.2-4.2L6 20"/>',
  style: '<path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5z"/><path d="M13.5 3.5v5h5M10.5 12.5l-2 2 2 2M13.5 12.5l2 2-2 2"/>',
  file: '<path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5z"/><path d="M13.5 3.5v5h5"/>',
  folder: '<path d="M3.5 17.5v-11a2 2 0 0 1 2-2h3.7l2 2.5h7.3a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  chev: '<path d="m7 9.5 5 5 5-5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};
const svg = (name, cls = 'icon') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
const fileIcon = (path) => `<span class="file-icon k-${kindOf(path)}">${svg(kindOf(path))}</span>`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* ignore */ } },
};

// =========================================================
// Toast & dialog
// =========================================================
let toastTimer;
function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  els.toast.style.animation = 'none';
  void els.toast.offsetWidth; // restart the entrance animation
  els.toast.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 4000);
}

/** Modal dialog. Resolves to { action: 'ok' | 'alt', value } or null when cancelled. */
function ask({ title, body = '', input = null, ok = 'OK', alt = null, danger = false, validate = null }) {
  const d = els.dialog;
  const field = $('dialog-field');
  const inputEl = $('dialog-input');
  const err = $('dialog-error');
  const okBtn = $('dialog-ok');
  const altBtn = $('dialog-alt');
  const cancelBtn = $('dialog-cancel');
  const form = $('dialog-form');

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
    const finish = (result) => { cleanup(); d.close(); resolve(result); };
    const onSubmit = (e) => {
      e.preventDefault();
      const value = input ? inputEl.value.trim() : null;
      const msg = validate && validate(value);
      if (msg) {
        err.textContent = msg;
        inputEl.setAttribute('aria-invalid', 'true');
        inputEl.focus();
        return;
      }
      finish({ action: 'ok', value });
    };
    const onAlt = () => finish({ action: 'alt', value: null });
    const onCancel = () => finish(null);
    const onEsc = (e) => { e.preventDefault(); finish(null); };
    const onInput = () => { err.textContent = ''; inputEl.removeAttribute('aria-invalid'); };
    function cleanup() {
      form.removeEventListener('submit', onSubmit);
      altBtn.removeEventListener('click', onAlt);
      cancelBtn.removeEventListener('click', onCancel);
      d.removeEventListener('cancel', onEsc);
      inputEl.removeEventListener('input', onInput);
    }
    form.addEventListener('submit', onSubmit);
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

// =========================================================
// Persistence
// =========================================================
let saveTimer;
function changed({ content = true } = {}) {
  if (content) {
    state.version++;
    updatePill();
    scheduleAutoCompile();
  }
  els.saveState.textContent = 'Saving…';
  els.saveState.className = 'save-state is-saving';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const ok = await saveProject({
      files: [...state.files].map(([path, f]) => ({ path, ...f })),
      main: state.main,
      active: state.active,
      engine: els.engine.value,
    });
    els.saveState.textContent = ok ? 'Saved' : 'Not saved';
    els.saveState.className = `save-state${ok ? '' : ' is-error'}`;
    els.saveState.title = ok ? 'Your project is saved in this browser.' : 'Browser storage is unavailable, so changes will be lost on reload.';
  }, 400);
}

// =========================================================
// File tree
// =========================================================
function buildTree(paths) {
  const root = { folders: new Map(), files: [] };
  for (const p of paths) {
    const parts = p.split('/');
    let node = root;
    let prefix = '';
    for (const part of parts.slice(0, -1)) {
      prefix = prefix ? `${prefix}/${part}` : part;
      if (!node.folders.has(part)) node.folders.set(part, { path: prefix, folders: new Map(), files: [] });
      node = node.folders.get(part);
    }
    node.files.push(p);
  }
  return root;
}

function renderTree() {
  const paths = [...state.files.keys()].sort((a, b) => a.localeCompare(b));
  const total = paths.reduce((n, p) => n + fileSize(state.files.get(p)), 0);
  els.fileCount.textContent = paths.length ? `${paths.length} · ${formatBytes(total)}` : '';

  const renderNode = (node, depth) => {
    const items = [];
    for (const [name, child] of [...node.folders].sort(([a], [b]) => a.localeCompare(b))) {
      const open = !state.collapsed.has(child.path);
      const row = h('button', {
        type: 'button', class: 'tree-row tree-folder', style: `--depth:${depth}`, 'aria-expanded': String(open),
        onclick: () => {
          if (open) state.collapsed.add(child.path); else state.collapsed.delete(child.path);
          renderTree();
        },
        html: `${svg('chev', 'icon chev')}${svg('folder')}<span class="name">${escapeHtml(name)}</span>`,
      });
      items.push(h('li', {}, row, open ? h('ul', { role: 'list' }, renderNode(child, depth + 1)) : null));
    }
    for (const path of node.files) {
      const btn = h('button', {
        type: 'button', class: 'tree-row tree-file', style: `--depth:${depth}`,
        'aria-current': path === state.active ? 'true' : 'false', title: path,
        onclick: () => { openFile(path); if (mobile.matches) setView('editor'); },
        html: `${fileIcon(path)}<span class="name">${escapeHtml(basename(path))}</span>`,
      });
      if (path === state.main) btn.append(h('span', { class: 'badge badge-main' }, 'main'));
      if (state.errorLines.has(path)) btn.append(h('span', { class: 'err-dot', title: 'Has errors' }), h('span', { class: 'visually-hidden' }, ' (has errors)'));
      items.push(h('li', {}, btn));
    }
    return items;
  };

  els.tree.replaceChildren(...(paths.length
    ? renderNode(buildTree(paths), 0)
    : [h('li', { class: 'tree-empty' }, 'No files yet — create or upload one.')]));
}

// =========================================================
// Editor / active file
// =========================================================
function renderActive() {
  const path = state.active;
  const file = path && state.files.get(path);
  if (state.viewerUrl) { URL.revokeObjectURL(state.viewerUrl); state.viewerUrl = null; }

  els.activeDir.textContent = path && path.includes('/') ? `${dirname(path)}/` : '';
  els.activeName.textContent = path ? basename(path) : 'No file open';
  els.activeIcon.innerHTML = path ? fileIcon(path) : '';
  els.activeMain.hidden = !path || path !== state.main;
  els.setMain.hidden = !path || !isTex(path) || path === state.main;
  els.rename.hidden = !path;
  els.del.hidden = !path;

  if (file && typeof file.text === 'string') {
    els.code.hidden = false;
    els.viewer.hidden = true;
    els.textarea.setAttribute('aria-label', `Editing ${path}`);
    editor.errorLines = new Set(state.errorLines.get(path) || []);
    editor.setValue(file.text, path);
    return;
  }

  els.code.hidden = true;
  els.viewer.hidden = false;
  els.viewer.replaceChildren();
  if (!file) {
    els.viewer.append(h('h3', {}, 'No file open'), h('p', {}, 'Choose a file from the sidebar, or create a new one.'));
    return;
  }
  if (isImage(path)) {
    state.viewerUrl = URL.createObjectURL(file.blob);
    els.viewer.append(h('img', { src: state.viewerUrl, alt: `Preview of ${basename(path)}` }));
  }
  const isPicture = kindOf(path) === 'image';
  els.viewer.append(
    h('h3', {}, basename(path)),
    h('p', {}, `${isPicture ? 'Image' : 'Binary file'} · ${formatBytes(file.blob.size)}`),
  );
  if (isPicture) {
    const snippet = `\\includegraphics[width=\\linewidth]{${relativeToMain(path)}}`;
    const copy = h('button', {
      type: 'button', class: 'btn btn-ghost btn-sm',
      onclick: async () => {
        try { await navigator.clipboard.writeText(snippet); toast('Copied to clipboard.'); } catch { toast('Copy failed — select the text instead.'); }
      },
    }, 'Copy');
    els.viewer.append(h('p', {}, 'Use it in your document with:'), h('div', { class: 'snippet' }, h('code', {}, snippet), copy));
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
    // Make sure the file's folders are expanded.
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) state.collapsed.delete(parts.slice(0, i).join('/'));
    renderActive();
    renderTree();
    changed({ content: false });
  }
  if (line && !els.code.hidden) {
    if (mobile.matches) setView('editor');
    editor.goToLine(line);
  }
}

// =========================================================
// Project operations
// =========================================================
function setProject(entries, main) {
  state.files = new Map(entries.map((e) => [e.path, e.blob ? { blob: e.blob } : { text: e.text ?? '' }]));
  state.main = main && state.files.has(main) ? main : detectMain(state.files);
  state.active = state.main || [...state.files.keys()][0] || null;
  state.errorLines = new Map();
  state.collapsed = new Set();
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
    toast(skipped.length ? `Nothing added — ${plural(skipped.length, 'file')} skipped (${skipped[0].why}).` : 'No files to add.');
    return;
  }
  const incomingBytes = added.reduce((n, e) => n + fileSize(e), 0);

  let replace = false;
  if (folderName && state.files.size && !isUntouchedStarter()) {
    const choice = await ask({
      title: `Open “${folderName}”?`,
      body: `This folder has ${plural(added.length, 'file')}. Replace your current project with it, or add the files to what you have.`,
      ok: 'Replace project', alt: 'Add to project',
    });
    if (!choice) return;
    replace = choice.action === 'ok';
  } else if (folderName) {
    replace = true;
  }

  const currentBytes = replace ? 0 : [...state.files.values()].reduce((n, f) => n + fileSize(f), 0);
  if (currentBytes + incomingBytes > MAX_PROJECT_BYTES) {
    toast(`That would make the project larger than ${formatBytes(MAX_PROJECT_BYTES)}, so nothing was added.`);
    return;
  }

  let replaced = 0;
  if (replace) {
    setProject(added, null);
    clearResult();
  } else {
    for (const e of added) {
      if (state.files.has(e.path)) replaced++;
      state.files.set(e.path, e.blob ? { blob: e.blob } : { text: e.text });
    }
    if (!state.main || !state.files.has(state.main)) state.main = detectMain(state.files);
    state.active = (added.find((e) => isTex(e.path)) || added[0]).path;
    renderTree();
    renderActive();
  }
  changed();

  const skippedNote = skipped.length ? ` ${plural(skipped.length, 'build/hidden file')} skipped.` : '';
  if (replace) toast(`Opened “${folderName}” · main file: ${state.main || 'none found'}.${skippedNote}`);
  else toast(`Added ${plural(added.length, 'file')}${replaced ? ` (${replaced} replaced)` : ''}.${skippedNote}`);
}

async function newFile() {
  const suggested = state.files.has('chapter.tex') ? 'chapters/section.tex' : 'chapter.tex';
  const res = await ask({
    title: 'New file',
    body: 'Include a folder in the name to create one — for example chapters/intro.tex.',
    input: { label: 'File name', value: suggested, placeholder: 'chapters/intro.tex' },
    ok: 'Create file',
    validate: (v) => validatePath(v)
      || (state.files.has(v) ? 'A file with this name already exists.' : null)
      || (!isText(v) ? 'Only text files (.tex, .bib, .sty, …) can be created here. Upload images instead.' : null),
  });
  if (!res) return;
  const starter = isTex(res.value) && !state.main ? '\\documentclass{article}\n\\begin{document}\n\n\\end{document}\n' : '';
  state.files.set(res.value, { text: starter });
  if (!state.main && isTex(res.value)) state.main = res.value;
  state.active = res.value;
  renderTree();
  renderActive();
  changed();
  if (mobile.matches) setView('editor');
  editor.focus();
  if (isTex(res.value) && res.value !== state.main) {
    toast(`Created ${res.value}. Include it from ${basename(state.main)} with \\input{${relativeToMain(res.value).replace(/\.tex$/, '')}}.`);
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
  const next = new Map();
  for (const [p, f] of state.files) next.set(p === from ? res.value : p, f);
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
    body: path === state.main ? 'This is your main file. Another .tex file will become the main file.' : 'This can’t be undone.',
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
      title: 'Start over with the example?',
      body: 'All files in your project will be replaced by the starter example. Your current files will be lost.',
      ok: 'Reset project', danger: true,
    });
    if (!res) return;
  }
  setProject(Object.entries(STARTER_FILES).map(([path, text]) => ({ path, text })), STARTER_MAIN);
  clearResult();
  changed();
  if (mobile.matches) setView('editor');
  editor.focus();
}

// =========================================================
// Preview
// =========================================================
function show(view) {
  for (const [name, el] of Object.entries(views)) el.hidden = name !== view;
  els.pdfTools.hidden = view !== 'pdf';
}

function announce(msg) { els.status.textContent = msg; }

function setPill(stateName, text) {
  els.pill.dataset.state = stateName;
  els.pill.textContent = text;
}

let lastPill = { state: 'idle', text: 'Not compiled' };
function updatePill() {
  if (state.compiling) return;
  if (lastPill.state === 'ok' && state.version !== state.compiledVersion) setPill('stale', 'Edited');
  else setPill(lastPill.state, lastPill.text);
}

function pdfName() {
  return `${basename(state.main || 'document.tex').replace(/\.[^.]+$/, '')}.pdf`;
}

async function showPdf(blob) {
  if (state.pdfUrl) URL.revokeObjectURL(state.pdfUrl);
  state.pdfUrl = URL.createObjectURL(blob);
  els.download.href = state.pdfUrl;
  els.download.download = pdfName();
  els.open.href = state.pdfUrl;
  els.download.removeAttribute('aria-disabled');
  els.download.removeAttribute('tabindex');
  els.open.hidden = false;
  state.hasPdf = true;

  if (pdf && pdf.available) {
    show('pdf');
    try {
      await pdf.show(blob);
      return;
    } catch (err) {
      console.warn('PDF.js could not render this file, using the browser viewer instead.', err);
    }
  }
  views.frame.src = state.pdfUrl;
  show('frame');
}

function clearPdf() {
  if (state.pdfUrl) URL.revokeObjectURL(state.pdfUrl);
  state.pdfUrl = null;
  state.hasPdf = false;
  pdf?.clear();
  views.frame.removeAttribute('src');
  els.download.href = '#';
  els.download.setAttribute('aria-disabled', 'true');
  els.download.setAttribute('tabindex', '-1');
  els.open.hidden = true;
}

function clearResult() {
  clearPdf();
  showWarnings([]);
  setErrorLines([]);
  lastPill = { state: 'idle', text: 'Not compiled' };
  state.compiledVersion = -1;
  state.attemptedVersion = -1;
  updatePill();
  els.backendNote.innerHTML = '<span>&nbsp;</span>';
  setTabDot(null);
  show('empty');
}

function problemItem(p) {
  const meta = h('div', { class: 'problem-meta' });
  if (p.file && state.files.has(p.file)) {
    const label = p.line ? `${p.file}:${p.line}` : p.file;
    meta.append(h('button', {
      type: 'button', class: 'loc', title: 'Open in editor',
      'aria-label': `Go to ${p.file}${p.line ? `, line ${p.line}` : ''}`,
      onclick: () => openFile(p.file, p.line || 1),
      html: `${escapeHtml(label)}${svg('arrow')}`,
    }));
  } else if (p.line) {
    meta.append(h('span', {}, `Line ${p.line}`));
  }
  if (p.context) meta.append(h('code', {}, p.context));
  return h('li', { class: `problem${p.severity === 'warning' ? ' is-warning' : ''}` },
    h('p', { class: 'problem-msg' }, p.message),
    meta.childNodes.length ? meta : null,
    p.hint ? h('p', { class: 'problem-hint' }, p.hint) : null);
}

function showWarnings(list) {
  els.warnbar.hidden = !list.length;
  if (!list.length) return;
  els.warnbarText.textContent = list.length === 1 ? list[0].message : `${list.length} things to check before you share this PDF`;
  els.warnbarList.replaceChildren(...list.map(problemItem));
  els.warnbarList.hidden = els.warnbarToggle.getAttribute('aria-expanded') !== 'true';
}

function setErrorLines(problems) {
  state.errorLines = new Map();
  for (const p of problems) {
    if (!p.file || !p.line || p.severity === 'warning') continue;
    if (!state.errorLines.has(p.file)) state.errorLines.set(p.file, new Set());
    state.errorLines.get(p.file).add(p.line);
  }
  renderTree();
  editor.setErrorLines([...(state.errorLines.get(state.active) || [])]);
}

function showErrors(data, warnings) {
  const errors = data.errors || [];
  const hard = errors.filter((e) => e.severity !== 'warning');
  const soft = [...errors.filter((e) => e.severity === 'warning'), ...warnings];

  els.errorReason.textContent = data.reason
    || (hard.length ? `The compiler found ${plural(hard.length, 'problem')}. Click a location to jump to it.` : '');
  els.errorList.replaceChildren(...[...hard, ...soft].map(problemItem));
  els.log.textContent = data.log || '';
  els.logDetails.hidden = !data.log;
  els.logDetails.open = !errors.length && !!data.log;
  showWarnings([]);
  clearPdf();
  setErrorLines(hard);
  show('error');
}

function setTabDot(kind) {
  els.tabDot.hidden = !kind;
  els.tabDot.classList.toggle('is-error', kind === 'error');
}

function describeBackend(backend, service) {
  return backend === 'local' ? 'local TeX' : (service || 'online compiler');
}

// =========================================================
// Auto compile
// =========================================================
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
  store.set(AUTO_KEY, on ? '1' : '0');
  if (on && state.version !== state.attemptedVersion) scheduleAutoCompile();
  if (!on) clearTimeout(autoTimer);
}

// =========================================================
// Compile
// =========================================================
async function compile({ auto = false } = {}) {
  clearTimeout(autoTimer);
  if (state.compiling) {
    if (auto) autoQueued = true; // edits arrived mid-compile: run once more afterwards
    return;
  }
  if (auto && state.version === state.attemptedVersion) return;
  if (!state.main) {
    if (auto) return;
    showErrors({ reason: 'There’s no main .tex file yet. Create one with “New file”, or upload your project.', errors: [] }, []);
    lastPill = { state: 'error', text: 'Failed' };
    updatePill();
    return;
  }

  const warnings = checkProject(state.files, state.main);
  const version = state.version;
  state.attemptedVersion = version;

  state.compiling = true;
  els.compile.setAttribute('aria-busy', 'true');
  els.compile.querySelector('.btn-label').textContent = 'Compiling';
  els.progress.classList.add('is-active');
  setPill('busy', 'Compiling');
  // Keep the previous PDF or error list on screen until the new result arrives.
  if (!views.empty.hidden) show('loading');
  if (!auto) announce('Compiling…');

  try {
    const files = await Promise.all([...state.files].map(async ([path, f]) => (
      f.blob ? { path, base64: await toBase64(f.blob) } : { path, content: f.text })));
    const res = await fetch('api/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files, main: state.main, engine: els.engine.value }),
    });
    const type = res.headers.get('Content-Type') || '';
    const engineName = els.engine.options[els.engine.selectedIndex].text;

    if (res.ok && type.startsWith('application/pdf')) {
      const blob = await res.blob();
      setErrorLines([]);
      await showPdf(blob);
      showWarnings(warnings);
      const secs = (Number(res.headers.get('X-Compile-Ms')) / 1000).toFixed(1);
      state.compiledVersion = version;
      lastPill = { state: 'ok', text: `Compiled in ${secs}s` };
      const pages = pdf?.pageCount;
      els.backendNote.innerHTML = '';
      els.backendNote.append(
        h('span', {}, `${basename(state.main)} · ${engineName}`),
        pages ? h('span', {}, `· ${plural(pages, 'page')}`) : null,
        h('span', { class: 'statusbar-spacer' }),
        h('span', {}, describeBackend(res.headers.get('X-Compile-Backend'), res.headers.get('X-Compile-Service'))),
      );
      const note = res.headers.get('X-Compile-Note');
      if (note) toast(`${decodeURIComponent(note)} Used the backup compiler instead.`);
      announce(`Compiled successfully${warnings.length ? ` with ${plural(warnings.length, 'warning')}` : ''}.`);
      if (mobile.matches) {
        if (!auto) setView('preview');
        else if (currentView !== 'preview') setTabDot('ok');
      }
      return;
    }

    let data;
    try { data = await res.json(); } catch { data = { reason: `The server responded with HTTP ${res.status}.`, errors: [] }; }
    showErrors(data, warnings);
    lastPill = { state: 'error', text: data.errors?.length ? plural(data.errors.filter((e) => e.severity !== 'warning').length || data.errors.length, 'error') : 'Failed' };
    els.backendNote.innerHTML = '';
    els.backendNote.append(h('span', {}, `${engineName}`), h('span', { class: 'statusbar-spacer' }),
      h('span', {}, data.backend ? describeBackend(data.backend, data.service) : ''));
    const n = (data.errors || []).length;
    announce(n ? `Compilation failed with ${plural(n, 'problem')}.` : 'Compilation failed.');
    if (!auto) {
      if (mobile.matches) setView('preview');
      views.error.focus({ preventScroll: true });
    } else if (mobile.matches && currentView !== 'preview') {
      setTabDot('error');
    }
  } catch {
    showErrors({ reason: 'Couldn’t reach the server. Check your connection and try again.', errors: [] }, warnings);
    lastPill = { state: 'error', text: 'Offline' };
    announce('Compilation failed: the server is unreachable.');
  } finally {
    state.compiling = false;
    els.compile.setAttribute('aria-busy', 'false');
    els.compile.querySelector('.btn-label').textContent = 'Compile';
    els.progress.classList.remove('is-active');
    updatePill();
    if (autoQueued) {
      autoQueued = false;
      scheduleAutoCompile();
    }
  }
}

// =========================================================
// Layout: mobile tabs, sidebar toggle, resizable split
// =========================================================
let currentView = 'editor';
function setView(view) {
  currentView = view;
  els.layout.dataset.view = view;
  for (const t of els.tabs) t.setAttribute('aria-pressed', String(t.dataset.view === view));
  if (view === 'preview') setTabDot(null);
  if (view === 'preview' && pdf?.doc) requestAnimationFrame(() => pdf.fitWidth());
}

const SIDEBAR_KEY = 'tex-compiler:sidebar';
function setSidebar(open) {
  els.layout.classList.toggle('sidebar-hidden', !open);
  els.toggleSidebar.setAttribute('aria-expanded', String(open));
  els.toggleSidebar.title = open ? 'Hide files panel' : 'Show files panel';
  store.set(SIDEBAR_KEY, open ? '1' : '0');
}

const SPLIT_KEY = 'tex-compiler:split';
function setSplit(pct) {
  const v = Math.min(75, Math.max(25, Math.round(pct)));
  els.layout.style.setProperty('--left', `${v}fr`);
  els.layout.style.setProperty('--right', `${100 - v}fr`);
  els.splitter.setAttribute('aria-valuenow', String(v));
  store.set(SPLIT_KEY, String(v));
}

function initSplitter() {
  const start = (e) => {
    e.preventDefault();
    els.layout.classList.add('is-resizing');
    els.splitter.setPointerCapture(e.pointerId);
    const editorPane = document.querySelector('.pane-editor');
    const left = editorPane.getBoundingClientRect().left;
    const total = document.querySelector('.pane-preview').getBoundingClientRect().right - left;
    const move = (ev) => setSplit(((ev.clientX - left) / total) * 100);
    const end = () => {
      els.layout.classList.remove('is-resizing');
      els.splitter.removeEventListener('pointermove', move);
      els.splitter.removeEventListener('pointerup', end);
      els.splitter.removeEventListener('pointercancel', end);
    };
    els.splitter.addEventListener('pointermove', move);
    els.splitter.addEventListener('pointerup', end);
    els.splitter.addEventListener('pointercancel', end);
  };
  els.splitter.addEventListener('pointerdown', start);
  els.splitter.addEventListener('dblclick', () => setSplit(50));
  els.splitter.addEventListener('keydown', (e) => {
    const now = Number(els.splitter.getAttribute('aria-valuenow'));
    if (e.key === 'ArrowLeft') { e.preventDefault(); setSplit(now - 5); }
    if (e.key === 'ArrowRight') { e.preventDefault(); setSplit(now + 5); }
    if (e.key === 'Home') { e.preventDefault(); setSplit(25); }
    if (e.key === 'End') { e.preventDefault(); setSplit(75); }
  });
}

// =========================================================
// Wire up
// =========================================================
els.compile.addEventListener('click', () => compile());
els.auto.addEventListener('change', () => {
  setAutoCompile(els.auto.checked);
  toast(els.auto.checked ? 'Auto compile is on — the PDF updates shortly after you stop typing.' : 'Auto compile is off.');
});
els.engine.addEventListener('change', () => changed());
els.newFile.addEventListener('click', newFile);
els.uploadFiles.addEventListener('click', () => els.fileInput.click());
els.uploadFolder.addEventListener('click', () => els.folderInput.click());
els.reset.addEventListener('click', resetProject);
els.setMain.addEventListener('click', setActiveAsMain);
els.rename.addEventListener('click', renameActive);
els.del.addEventListener('click', deleteActive);
els.toggleSidebar.addEventListener('click', () => setSidebar(els.layout.classList.contains('sidebar-hidden')));
for (const t of els.tabs) t.addEventListener('click', () => setView(t.dataset.view));

els.zoomIn.addEventListener('click', () => pdf?.zoomBy(1.2));
els.zoomOut.addEventListener('click', () => pdf?.zoomBy(1 / 1.2));
els.zoomLabel.addEventListener('click', () => pdf?.fitWidth());

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

// Drag and drop onto the files panel (files or a whole folder).
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
els.dropzone.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  els.dropzone.classList.add('is-dragging');
});
els.dropzone.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
els.dropzone.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) els.dropzone.classList.remove('is-dragging');
});
els.dropzone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  els.dropzone.classList.remove('is-dragging');
  const { entries, folder } = await filesFromDrop(e.dataTransfer);
  if (folder) await addEntries(stripCommonRoot(entries).entries, { folderName: folder });
  else await addEntries(entries);
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

els.warnbarToggle.addEventListener('click', () => {
  const open = els.warnbarToggle.getAttribute('aria-expanded') !== 'true';
  els.warnbarToggle.setAttribute('aria-expanded', String(open));
  els.warnbarToggle.querySelector('.warnbar-action').textContent = open ? 'Hide' : 'Show';
  els.warnbarList.hidden = !open;
});

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === 'Enter') {
    e.preventDefault();
    compile();
  } else if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    toast('Your project saves automatically in this browser.');
  }
});

if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) els.compileKbd.textContent = '⌘ ↵';

// =========================================================
// Start
// =========================================================
initSplitter();
setSplit(Number(store.get(SPLIT_KEY)) || 50);
setSidebar(store.get(SIDEBAR_KEY) !== '0');
setView('editor');

// pdf.min.js is a deferred script placed before this module, so it has already run.
// If it failed to load, PdfViewer reports unavailable and we fall back to the browser's viewer.
pdf = new PdfViewer(views.pdf, { pageLabel: els.pageLabel, zoomLabel: els.zoomLabel });

// First-visit notice: only when this deployment compiles with the online service (no TeX on the server).
const NOTICE_KEY = 'tex-compiler:notice-dismissed';
// OS tabs and copy buttons inside the notice.
function initInstallHelp() {
  const tabs = [...document.querySelectorAll('#notice .seg-btn')];
  const select = (os, focus = false) => {
    for (const t of tabs) {
      const on = t.dataset.os === os;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
      if (on && focus) t.focus();
    }
  };
  const ua = `${navigator.userAgentData?.platform || ''} ${navigator.platform || ''} ${navigator.userAgent}`;
  select(/Win/i.test(ua) ? 'win' : /Linux|X11|CrOS/i.test(ua) && !/Android/i.test(ua) ? 'linux' : 'mac');
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t.dataset.os));
    t.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (step) { e.preventDefault(); select(tabs[(i + step + tabs.length) % tabs.length].dataset.os, true); }
    });
  });
  for (const btn of document.querySelectorAll('#notice .cmd-copy')) {
    btn.addEventListener('click', async () => {
      const text = btn.parentElement.querySelector('code').textContent;
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = 'Copied';
      } catch {
        const range = document.createRange();
        range.selectNodeContents(btn.parentElement.querySelector('code'));
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        btn.textContent = 'Press Ctrl+C';
      }
      btn.classList.add('is-copied');
      setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('is-copied'); }, 1800);
    });
  }
}

async function showNoticeIfRemote() {
  if (store.get(NOTICE_KEY) === '1') return;
  let backend = null;
  try {
    const res = await fetch('healthz', { cache: 'no-store' });
    backend = (await res.json()).backend;
  } catch { return; }
  if (backend !== 'remote') return;
  const dialog = $('notice');
  initInstallHelp();
  dialog.addEventListener('close', () => {
    if ($('notice-dismiss').checked) store.set(NOTICE_KEY, '1');
    editor.focus();
  }, { once: true });
  dialog.showModal();
  $('notice-ok').focus();
}

(async () => {
  showNoticeIfRemote();
  const saved = await loadProject();
  if (saved && saved.files.length) {
    setProject(saved.files, saved.main);
    if (saved.active && state.files.has(saved.active)) { state.active = saved.active; renderTree(); renderActive(); }
    if (saved.engine) els.engine.value = saved.engine;
  } else {
    setProject(Object.entries(STARTER_FILES).map(([path, text]) => ({ path, text })), STARTER_MAIN);
  }
  els.saveState.textContent = 'Saved';
  show('empty');
  if (store.get(AUTO_KEY) === '1') {
    els.auto.checked = true;
    compile({ auto: true });
  }
})();

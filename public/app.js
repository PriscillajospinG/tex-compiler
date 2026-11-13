'use strict';

const STARTER = String.raw`\documentclass{article}
\usepackage{amsmath}

\title{My First Document}
\author{Your Name}
\date{\today}

\begin{document}

\maketitle

\section{Introduction}
Welcome to \LaTeX! Edit this text, then press \textbf{Compile}
to see your changes in the PDF preview.

\section{Some Math}
Inline math goes between dollar signs, like $E = mc^2$.
Bigger equations get their own line:
\begin{equation}
  \int_0^1 x^2 \, dx = \frac{1}{3}
\end{equation}

\section{A List}
\begin{itemize}
  \item Use \verb|\textbf{...}| for \textbf{bold} text.
  \item Use \verb|\emph{...}| for \emph{emphasis}.
  \item Start a new section with \verb|\section{...}|.
\end{itemize}

\end{document}
`;

const STORAGE_KEY = 'tex-compiler:draft';

const $ = (id) => document.getElementById(id);
const editor = $('editor');
const gutter = $('gutter');
const compileBtn = $('compile');
const resetBtn = $('reset');
const engineSel = $('engine');
const downloadLink = $('download');
const openLink = $('open');
const statusEl = $('status');
const backendNote = $('backend-note');
const views = { empty: $('empty'), loading: $('loading'), error: $('error'), pdf: $('pdf') };

let pdfUrl = null;
let errorLines = new Set();
let compiling = false;

// ---------- storage (best effort) ----------
function loadDraft() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
}
function saveDraft() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ source: editor.value, engine: engineSel.value })); } catch {}
}

// ---------- editor gutter ----------
function lineHeight() {
  return parseFloat(getComputedStyle(editor).lineHeight) || 21;
}
function renderGutter() {
  const count = editor.value.split('\n').length;
  let html = '';
  for (let i = 1; i <= count; i++) html += `<div${errorLines.has(i) ? ' class="err"' : ''}>${i}</div>`;
  gutter.innerHTML = html;
  syncScroll();
}
function syncScroll() { gutter.scrollTop = editor.scrollTop; }

function updateCursor() {
  const before = editor.value.slice(0, editor.selectionStart);
  const line = before.split('\n').length;
  const col = before.length - before.lastIndexOf('\n');
  $('cursor-pos').textContent = `Line ${line}, column ${col}`;
}

function goToLine(n) {
  const lines = editor.value.split('\n');
  const line = Math.min(Math.max(1, n), lines.length);
  let start = 0;
  for (let i = 0; i < line - 1; i++) start += lines[i].length + 1;
  const end = start + lines[line - 1].length;
  editor.focus();
  editor.setSelectionRange(start, end);
  editor.scrollTop = Math.max(0, (line - 1) * lineHeight() - editor.clientHeight / 3);
  syncScroll();
  updateCursor();
}

// ---------- preview states ----------
function show(view) {
  for (const [name, el] of Object.entries(views)) el.hidden = name !== view;
}

function setPdf(blob) {
  if (pdfUrl) URL.revokeObjectURL(pdfUrl);
  pdfUrl = blob ? URL.createObjectURL(blob) : null;
  if (pdfUrl) {
    views.pdf.src = pdfUrl;
    downloadLink.href = pdfUrl;
    openLink.href = pdfUrl;
    downloadLink.removeAttribute('aria-disabled');
    downloadLink.removeAttribute('tabindex');
    openLink.hidden = false;
  } else {
    views.pdf.removeAttribute('src');
    downloadLink.href = '#';
    downloadLink.setAttribute('aria-disabled', 'true');
    downloadLink.setAttribute('tabindex', '-1');
    openLink.hidden = true;
  }
}

function setBusy(busy) {
  compiling = busy;
  compileBtn.setAttribute('aria-busy', String(busy));
  compileBtn.querySelector('.btn-label').textContent = busy ? 'Compiling…' : 'Compile';
}

function describeBackend(backend) {
  return backend === 'local' ? 'local TeX installation' : 'texlive.net';
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

function showErrors(data) {
  const list = $('error-list');
  list.replaceChildren();
  const errors = data.errors || [];

  $('error-reason').textContent = data.reason
    || (errors.length === 1 ? 'TeX found 1 problem in your document:' : `TeX found ${errors.length} problems in your document:`);

  for (const e of errors) {
    const where = el('div', { class: 'where' });
    if (e.line) {
      where.append(el('button', { type: 'button', class: 'line-link', onclick: () => goToLine(e.line) }, `Go to line ${e.line}`));
    } else {
      where.append(el('span', {}, 'Line number not reported'));
    }
    if (e.context) where.append(el('code', {}, e.context));
    list.append(el('li', { class: 'error-item' },
      el('div', { class: 'msg' }, e.message),
      where,
      e.hint ? el('p', { class: 'hint' }, e.hint) : null));
  }

  $('log').textContent = data.log || '(no log available)';
  $('log-details').hidden = !data.log;
  $('log-details').open = !errors.length && !!data.log;

  errorLines = new Set(errors.map((e) => e.line).filter(Boolean));
  renderGutter();
  show('error');
}

// ---------- compile ----------
async function compile() {
  if (compiling) return;
  const source = editor.value;
  if (!source.trim()) {
    showErrors({ reason: 'The editor is empty. Write some LaTeX or press “Reset example”.', errors: [] });
    return;
  }

  setBusy(true);
  show('loading');
  const announce = statusEl;
  announce.textContent = 'Compiling…';

  try {
    const res = await fetch('/api/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, engine: engineSel.value }),
    });
    const type = res.headers.get('Content-Type') || '';

    if (res.ok && type.startsWith('application/pdf')) {
      const blob = await res.blob();
      errorLines = new Set();
      renderGutter();
      setPdf(blob);
      show('pdf');
      const secs = (Number(res.headers.get('X-Compile-Ms')) / 1000).toFixed(1);
      backendNote.textContent = `Compiled with ${engineSel.options[engineSel.selectedIndex].text} on ${describeBackend(res.headers.get('X-Compile-Backend'))} in ${secs}s.`;
      announce.textContent = 'Compilation succeeded. The PDF preview is updated.';
      // On narrow screens the preview sits below the editor, so bring it into view.
      if (matchMedia('(max-width: 899px)').matches) $('preview').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    let data;
    try { data = await res.json(); } catch { data = { reason: `The server responded with HTTP ${res.status}.` }; }
    setPdf(null);
    showErrors(data);
    backendNote.textContent = data.backend ? `Tried ${describeBackend(data.backend)}.` : ' ';
    const n = (data.errors || []).length;
    announce.textContent = n ? `Compilation failed with ${n} error${n === 1 ? '' : 's'}.` : 'Compilation failed.';
    views.error.focus();
  } catch {
    setPdf(null);
    showErrors({ reason: 'Could not reach the app server. Is it still running? Check the terminal where you started it.', errors: [] });
    announce.textContent = 'Compilation failed: server unreachable.';
  } finally {
    setBusy(false);
  }
}

function reset() {
  const changed = editor.value !== STARTER;
  if (changed && !confirm('Replace your current document with the starter example? Your changes will be lost.')) return;
  editor.value = STARTER;
  errorLines = new Set();
  renderGutter();
  saveDraft();
  editor.focus();
  editor.setSelectionRange(0, 0);
  editor.scrollTop = 0;
  updateCursor();
}

// ---------- wire up ----------
const draft = loadDraft();
editor.value = draft && typeof draft.source === 'string' ? draft.source : STARTER;
if (draft && draft.engine) engineSel.value = draft.engine;
renderGutter();
show('empty');

let saveTimer;
editor.addEventListener('input', () => {
  if (errorLines.size) errorLines = new Set();
  renderGutter();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 300);
});
editor.addEventListener('scroll', syncScroll);
for (const evt of ['keyup', 'click', 'select']) editor.addEventListener(evt, updateCursor);
engineSel.addEventListener('change', saveDraft);
compileBtn.addEventListener('click', compile);
resetBtn.addEventListener('click', reset);

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    compile();
  }
});

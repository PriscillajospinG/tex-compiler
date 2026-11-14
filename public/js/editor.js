// Code editor: a native <textarea> (so typing, undo, IME, spellcheck-off and screen readers
// all behave normally) layered over a syntax-highlighted copy of the text.

import { highlightLine, highlightBibLine, highlighterFor } from './highlight.js';

export class CodeEditor {
  /**
   * @param {HTMLElement} root  container with .code-gutter, .code-body > .code-layer, textarea
   */
  constructor(root, { onInput, onCursor } = {}) {
    this.root = root;
    this.textarea = root.querySelector('textarea');
    this.gutter = root.querySelector('.code-gutter-inner');
    this.layer = root.querySelector('.code-layer');
    this.lines = root.querySelector('.code-lines');
    this.activeBand = root.querySelector('.code-active');
    this.onInput = onInput;
    this.onCursor = onCursor;
    this.mode = 'tex';
    this.errorLines = new Set();
    this.currentLine = 1;
    this.lineCount = 0;
    this.frame = 0;

    this.textarea.addEventListener('input', () => {
      this.scheduleRender();
      this.onInput?.(this.textarea.value);
    });
    this.textarea.addEventListener('scroll', () => this.syncScroll());
    for (const evt of ['keyup', 'click', 'select', 'focus', 'input']) {
      this.textarea.addEventListener(evt, () => this.updateCursor());
    }
    document.addEventListener('selectionchange', () => {
      if (document.activeElement === this.textarea) this.updateCursor();
    });
    this.textarea.addEventListener('keydown', (e) => this.handleKeys(e));
  }

  get value() { return this.textarea.value; }

  setValue(text, path) {
    this.mode = highlighterFor(path);
    this.textarea.value = text;
    this.textarea.scrollTop = 0;
    this.textarea.scrollLeft = 0;
    this.textarea.setSelectionRange(0, 0);
    this.render();
    this.syncScroll();
    this.updateCursor();
  }

  setErrorLines(lines) {
    this.errorLines = new Set(lines || []);
    this.render();
  }

  focus() { this.textarea.focus({ preventScroll: true }); }

  lineHeight() {
    return parseFloat(getComputedStyle(this.textarea).lineHeight) || 21;
  }

  scheduleRender() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.render());
  }

  render() {
    const text = this.textarea.value;
    const rows = text.split('\n');
    const state = { math: false };
    let html = '';
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let body;
      if (this.mode === 'tex') body = highlightLine(row, state);
      else if (this.mode === 'bib') body = highlightBibLine(row);
      else body = row.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      html += `<div class="code-line${this.errorLines.has(i + 1) ? ' is-error' : ''}">${body || ' '}</div>`;
    }
    this.lines.innerHTML = html;

    if (rows.length !== this.lineCount || this.gutterErrors !== [...this.errorLines].join()) {
      this.lineCount = rows.length;
      this.gutterErrors = [...this.errorLines].join();
      let g = '';
      for (let i = 1; i <= rows.length; i++) g += `<div class="${this.errorLines.has(i) ? 'is-error' : ''}">${i}</div>`;
      this.gutter.innerHTML = g;
    }
    this.markCurrentLine();
  }

  syncScroll() {
    const { scrollTop, scrollLeft } = this.textarea;
    this.layer.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`;
    this.gutter.style.transform = `translateY(${-scrollTop}px)`;
  }

  cursor() {
    const ta = this.textarea;
    const before = ta.value.slice(0, ta.selectionStart);
    const line = before.split('\n').length;
    const col = before.length - before.lastIndexOf('\n');
    const selected = Math.abs(ta.selectionEnd - ta.selectionStart);
    return { line, col, selected };
  }

  updateCursor() {
    const c = this.cursor();
    if (c.line !== this.currentLine) {
      this.currentLine = c.line;
      this.markCurrentLine();
    }
    this.onCursor?.(c);
  }

  markCurrentLine() {
    const top = (this.currentLine - 1) * this.lineHeight();
    this.activeBand.style.transform = `translateY(${top}px)`;
    const prev = this.gutter.querySelector('.is-current');
    if (prev) prev.classList.remove('is-current');
    const el = this.gutter.children[this.currentLine - 1];
    if (el) el.classList.add('is-current');
  }

  goToLine(n) {
    const rows = this.textarea.value.split('\n');
    const line = Math.min(Math.max(1, n), rows.length);
    let start = 0;
    for (let i = 0; i < line - 1; i++) start += rows[i].length + 1;
    this.focus();
    this.textarea.setSelectionRange(start, start + rows[line - 1].length);
    const lh = this.lineHeight();
    this.textarea.scrollTop = Math.max(0, (line - 1) * lh - this.textarea.clientHeight / 3);
    this.syncScroll();
    this.updateCursor();
  }

  /** Small comforts: Ctrl/Cmd+/ toggles a % comment, Enter keeps indentation. */
  handleKeys(e) {
    const ta = this.textarea;
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      const { value, selectionStart: s, selectionEnd: en } = ta;
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const endIdx = value.indexOf('\n', Math.max(en - (en > s && value[en - 1] === '\n' ? 1 : 0), s));
      const lineEnd = endIdx === -1 ? value.length : endIdx;
      const block = value.slice(lineStart, lineEnd).split('\n');
      const allCommented = block.every((l) => !l.trim() || /^\s*%/.test(l));
      const next = block.map((l) => {
        if (!l.trim()) return l;
        return allCommented ? l.replace(/^(\s*)% ?/, '$1') : l.replace(/^(\s*)/, '$1% ');
      }).join('\n');
      this.replaceRange(lineStart, lineEnd, next, lineStart, lineStart + next.length);
      return;
    }
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing) {
      const { value, selectionStart: s, selectionEnd: en } = ta;
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const indent = /^[\t ]*/.exec(value.slice(lineStart, s))[0];
      if (!indent) return;
      e.preventDefault();
      this.replaceRange(s, en, `\n${indent}`);
    }
  }

  /** Replace text in a way that keeps the browser's undo history. */
  replaceRange(start, end, text, selStart, selEnd) {
    const ta = this.textarea;
    ta.focus();
    ta.setSelectionRange(start, end);
    const ok = document.execCommand && document.execCommand('insertText', false, text);
    if (!ok) {
      ta.setRangeText(text, start, end, 'end');
      ta.dispatchEvent(new Event('input'));
    }
    if (selStart != null) ta.setSelectionRange(selStart, selEnd);
  }
}

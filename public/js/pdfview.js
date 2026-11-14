// PDF preview built on PDF.js: pages on a soft background, fit-to-width zoom,
// page indicator, and — importantly — the scroll position is kept when the PDF
// is recompiled, so auto compile doesn't throw you back to page 1.

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const PAGE_GAP = 16;

export class PdfViewer {
  /**
   * @param {HTMLElement} scroller   scrollable element that will hold the pages
   * @param {object} ui              { pageLabel, zoomLabel, onChange }
   */
  constructor(scroller, ui = {}) {
    this.scroller = scroller;
    this.ui = ui;
    this.lib = window.pdfjsLib || null;
    this.doc = null;
    this.pages = null;      // element holding page placeholders
    this.sizes = [];        // unscaled page sizes [{w, h}]
    this.mode = 'fit';      // 'fit' or a number
    this.scale = 1;
    this.renderTasks = new Map();
    this.observer = null;
    this.loadToken = 0;

    if (this.lib) {
      this.lib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
    }
    this.scroller.addEventListener('scroll', () => this.updatePageLabel(), { passive: true });
    let resizeTimer;
    new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (this.doc && this.mode === 'fit') this.relayout(); }, 120);
    }).observe(this.scroller);
  }

  get available() { return !!this.lib; }
  get pageCount() { return this.doc ? this.doc.numPages : 0; }

  /** Load a new PDF, keeping the reader's position. */
  async show(blob) {
    const token = ++this.loadToken;
    const data = new Uint8Array(await blob.arrayBuffer());
    const doc = await this.lib.getDocument({ data, isEvalSupported: false }).promise;
    if (token !== this.loadToken) { doc.destroy(); return; }

    const sizes = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      sizes.push({ w: vp.width, h: vp.height });
    }
    if (token !== this.loadToken) { doc.destroy(); return; }

    // Remember where the reader was, as a fraction through the document.
    const oldMax = this.scroller.scrollHeight - this.scroller.clientHeight;
    const fraction = this.pages && oldMax > 0 ? this.scroller.scrollTop / oldMax : 0;
    const left = this.scroller.scrollLeft;

    const oldDoc = this.doc;
    this.doc = doc;
    this.sizes = sizes;
    this.computeScale();
    const pages = this.buildPages();

    // Pre-render the pages that will be visible, then swap — no white flash.
    this.scroller.append(pages);
    pages.style.position = 'absolute';
    pages.style.visibility = 'hidden';
    pages.style.top = '0';
    const targetTop = fraction * Math.max(0, pages.offsetHeight - this.scroller.clientHeight);
    await Promise.all(this.visibleIndexes(pages, targetTop).map((i) => this.renderPage(pages, i)));
    if (token !== this.loadToken) { pages.remove(); return; }

    if (this.pages) this.pages.remove();
    pages.style.position = '';
    pages.style.visibility = '';
    pages.style.top = '';
    this.pages = pages;
    this.scroller.scrollTop = targetTop;
    this.scroller.scrollLeft = left;
    this.observe();
    this.updateZoomLabel();
    this.updatePageLabel();
    if (oldDoc) oldDoc.destroy();
  }

  clear() {
    this.loadToken++;
    if (this.observer) this.observer.disconnect();
    if (this.pages) this.pages.remove();
    if (this.doc) this.doc.destroy();
    this.pages = null;
    this.doc = null;
    this.updatePageLabel();
  }

  computeScale() {
    if (this.mode === 'fit') {
      const widest = Math.max(...this.sizes.map((s) => s.w));
      const avail = this.scroller.clientWidth - 2 * PAGE_GAP;
      this.scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, avail / widest));
    } else {
      this.scale = this.mode;
    }
  }

  buildPages() {
    const wrap = document.createElement('div');
    wrap.className = 'pdf-pages';
    this.sizes.forEach((s, i) => {
      const page = document.createElement('div');
      page.className = 'pdf-page';
      page.dataset.index = String(i);
      page.style.width = `${Math.floor(s.w * this.scale)}px`;
      page.style.height = `${Math.floor(s.h * this.scale)}px`;
      page.setAttribute('aria-label', `Page ${i + 1} of ${this.sizes.length}`);
      page.setAttribute('role', 'img');
      wrap.append(page);
    });
    return wrap;
  }

  visibleIndexes(pages, top) {
    const bottom = top + this.scroller.clientHeight;
    const out = [];
    for (const el of pages.children) {
      const t = el.offsetTop;
      const b = t + el.offsetHeight;
      if (b >= top - 200 && t <= bottom + 200) out.push(Number(el.dataset.index));
    }
    return out.length ? out : [0];
  }

  observe() {
    if (this.observer) this.observer.disconnect();
    this.observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) this.renderPage(this.pages, Number(e.target.dataset.index));
      }
    }, { root: this.scroller, rootMargin: '600px 0px' });
    for (const el of this.pages.children) this.observer.observe(el);
  }

  async renderPage(pages, index) {
    const holder = pages.children[index];
    if (!holder || holder.dataset.rendered === String(this.scale)) return;
    holder.dataset.rendered = String(this.scale);
    const page = await this.doc.getPage(index + 1);
    const ratio = Math.min(window.devicePixelRatio || 1, 2.5);
    const vp = page.getViewport({ scale: this.scale * ratio });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    try {
      await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport: vp }).promise;
      holder.replaceChildren(canvas);
    } catch {
      holder.dataset.rendered = '';
    }
  }

  relayout() {
    // A new PDF may still be rendering off-screen; its pages aren't swapped in yet.
    if (!this.pages || this.pages.children.length !== this.sizes.length) return;
    const oldMax = this.scroller.scrollHeight - this.scroller.clientHeight;
    const fraction = oldMax > 0 ? this.scroller.scrollTop / oldMax : 0;
    this.computeScale();
    this.sizes.forEach((s, i) => {
      const el = this.pages.children[i];
      el.style.width = `${Math.floor(s.w * this.scale)}px`;
      el.style.height = `${Math.floor(s.h * this.scale)}px`;
      el.dataset.rendered = '';
    });
    const newMax = this.scroller.scrollHeight - this.scroller.clientHeight;
    this.scroller.scrollTop = fraction * newMax;
    for (const i of this.visibleIndexes(this.pages, this.scroller.scrollTop)) this.renderPage(this.pages, i);
    this.observe();
    this.updateZoomLabel();
  }

  zoomBy(factor) {
    if (!this.doc) return;
    this.mode = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(this.scale * factor * 100) / 100));
    this.relayout();
  }

  fitWidth() {
    if (!this.doc) return;
    this.mode = 'fit';
    this.relayout();
  }

  updateZoomLabel() {
    if (this.ui.zoomLabel) this.ui.zoomLabel.textContent = this.mode === 'fit' ? 'Fit' : `${Math.round(this.scale * 100)}%`;
    this.ui.onChange?.();
  }

  currentPage() {
    if (!this.pages) return 0;
    const mid = this.scroller.scrollTop + this.scroller.clientHeight * 0.35;
    let current = 1;
    for (const el of this.pages.children) {
      if (el.offsetTop <= mid) current = Number(el.dataset.index) + 1;
      else break;
    }
    return current;
  }

  updatePageLabel() {
    if (!this.ui.pageLabel) return;
    this.ui.pageLabel.textContent = this.doc ? `${this.currentPage()} / ${this.pageCount}` : '';
  }
}

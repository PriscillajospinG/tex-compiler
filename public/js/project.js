// Project helpers: file types, uploads, the starter example, and pre-compile checks.

export const STARTER_FILES = {
  'main.tex': String.raw`\documentclass{article}
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

\section{Citations}
Sources live in \texttt{references.bib}. Cite them with
\verb|\cite{...}|, like Knuth's book~\cite{knuth1984}
or Lamport's guide~\cite{lamport1994}.

\bibliographystyle{plain}
\bibliography{references}

\end{document}
`,
  'references.bib': `@book{knuth1984,
  author    = {Donald E. Knuth},
  title     = {The {\\TeX}book},
  publisher = {Addison-Wesley},
  year      = {1984}
}

@book{lamport1994,
  author    = {Leslie Lamport},
  title     = {{\\LaTeX}: A Document Preparation System},
  publisher = {Addison-Wesley},
  edition   = {2nd},
  year      = {1994}
}
`,
};
export const STARTER_MAIN = 'main.tex';

const TEXT_EXT = new Set([
  'tex', 'ltx', 'bib', 'bst', 'sty', 'cls', 'clo', 'cfg', 'def', 'dtx', 'ins', 'bbx', 'cbx', 'lbx',
  'txt', 'md', 'csv', 'tsv', 'dat', 'tikz', 'pgf', 'bbl', 'json', 'xml', 'svg', 'lua', 'py', 'r', 'm', 'gnuplot',
]);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const JUNK = /(^|\/)(\.[^/]*|__MACOSX|node_modules)(\/|$)|\.(aux|log|out|toc|lof|lot|fls|fdb_latexmk|synctex\.gz|synctex|blg|bcf|run\.xml|nav|snm|vrb|xdv|dvi)$/i;

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_PROJECT_BYTES = 25 * 1024 * 1024;

export const ext = (path) => (/\.([^./]+)$/.exec(path) || [])[1]?.toLowerCase() || '';
export const isText = (path) => TEXT_EXT.has(ext(path));
export const isImage = (path) => IMAGE_EXT.has(ext(path));
export const isTex = (path) => ['tex', 'ltx'].includes(ext(path));
export const basename = (path) => path.split('/').pop();
export const dirname = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

export function kindOf(path) {
  const e = ext(path);
  if (e === 'tex' || e === 'ltx') return 'tex';
  if (e === 'bib' || e === 'bst' || e === 'bbl') return 'bib';
  if (IMAGE_EXT.has(e) || e === 'pdf' || e === 'eps') return 'image';
  if (e === 'sty' || e === 'cls') return 'style';
  return 'file';
}

/** Returns an error message, or null if the path is acceptable. */
export function validatePath(path) {
  if (!path) return 'Enter a file name.';
  if (path.startsWith('/') || path.endsWith('/')) return 'File names cannot start or end with "/".';
  if (path.split('/').some((s) => s === '' || s === '.' || s === '..')) return 'Use names like "chapters/intro.tex" (no "." or ".." folders).';
  if (/[\\"*?<>|:]/.test(path)) return 'File names cannot contain \\ " * ? < > | or :';
  if (!/\.[A-Za-z0-9]+$/.test(path)) return 'Add a file extension, for example ".tex" or ".bib".';
  if (path.length > 200) return 'That file name is too long.';
  return null;
}

export function isJunk(path) {
  return JUNK.test(path);
}

/** Pick the most likely main document. */
export function detectMain(files) {
  const tex = [...files.keys()].filter(isTex);
  const hasClass = (p) => /^[^%\n]*\\documentclass/m.test(files.get(p).text || '');
  const byDepth = (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b);
  return tex.filter((p) => /(^|\/)main\.tex$/i.test(p) && hasClass(p)).sort(byDepth)[0]
    || tex.filter(hasClass).sort(byDepth)[0]
    || tex.sort(byDepth)[0]
    || null;
}

/** Read browser File objects into project entries. */
export async function readFiles(list) {
  const added = [];
  const skipped = [];
  for (const { file, path } of list) {
    if (isJunk(path)) { skipped.push({ path, why: 'build or hidden file' }); continue; }
    if (file.size > MAX_FILE_BYTES) { skipped.push({ path, why: 'larger than 10 MB' }); continue; }
    if (isText(path)) added.push({ path, text: await file.text() });
    else added.push({ path, blob: file });
  }
  return { added, skipped };
}

/** For <input webkitdirectory>: strip the shared top folder ("myproject/main.tex" -> "main.tex"). */
export function stripCommonRoot(entries) {
  if (!entries.length) return { entries, root: '' };
  const first = entries[0].path.split('/')[0];
  const shared = entries.every((e) => e.path.includes('/') && e.path.split('/')[0] === first);
  if (!shared) return { entries, root: '' };
  return { root: first, entries: entries.map((e) => ({ ...e, path: e.path.slice(first.length + 1) })) };
}

/** Collect files from a drag-and-drop, including folders. */
export async function filesFromDrop(dataTransfer) {
  const items = [...(dataTransfer.items || [])].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!items.length) {
    return { entries: [...dataTransfer.files].map((file) => ({ file, path: file.name })), folder: null };
  }
  const out = [];
  const walk = async (entry, prefix) => {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ file, path: prefix + entry.name });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      } while (batch.length);
    }
  };
  for (const entry of items) await walk(entry, '');
  const folder = items.length === 1 && items[0].isDirectory ? items[0].name : null;
  return { entries: out, folder };
}

export async function toBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function fileSize(entry) {
  return entry.blob ? entry.blob.size : new Blob([entry.text || '']).size;
}

// ---------- pre-compile checks ----------

function stripComments(text) {
  return text.replace(/(^|[^\\])%.*$/gm, '$1');
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function resolve(baseDir, rel) {
  const parts = (baseDir ? baseDir.split('/') : []).concat(rel.replace(/^\.\//, '').split('/'));
  const out = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
}

/**
 * Look for problems TeX will not always report clearly: missing .bib files,
 * missing images or \input files, and citation keys that are not in any .bib file.
 * Returns [{ severity: 'warning', message, file, line, hint }].
 */
export function checkProject(files, main) {
  const warnings = [];
  if (!main || !files.has(main)) return warnings;
  const baseDir = dirname(main);
  const exists = (rel, exts = ['']) => exts.some((e) => files.has(resolve(baseDir, rel + e)));
  const texFiles = [...files.keys()].filter((p) => isTex(p) && typeof files.get(p).text === 'string');

  const cited = new Map(); // key -> {file, line}
  let usesBibliography = false;
  let hasGraphicsPath = false;
  const bibNamesFound = [];

  for (const path of texFiles) {
    const src = stripComments(files.get(path).text);
    if (/\\graphicspath\s*\{/.test(src)) hasGraphicsPath = true;

    for (const m of src.matchAll(/\\(bibliography|addbibresource)(?:\[[^\]]*\])?\s*\{([^}]*)\}/g)) {
      usesBibliography = true;
      const names = m[2].split(',').map((s) => s.trim()).filter(Boolean);
      for (const name of names) {
        if (name.includes('\\')) continue;
        const withExt = /\.bib$/i.test(name) ? name : `${name}.bib`;
        bibNamesFound.push(withExt);
        if (!exists(withExt)) {
          warnings.push({
            severity: 'warning',
            message: `Bibliography file "${withExt}" is not in the project.`,
            file: path, line: lineOf(src, m.index),
            hint: `Your document loads it with \\${m[1]}{${m[2].trim()}}. Upload "${withExt}" with Upload files, or drag it into the Files list. Without it every citation shows as [?].`,
          });
        }
      }
    }

    if (!hasGraphicsPath) {
      for (const m of src.matchAll(/\\includegraphics\*?\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)) {
        const name = m[1].trim();
        if (name.includes('\\') || name.includes('#')) continue;
        if (!exists(name, ['', '.png', '.pdf', '.jpg', '.jpeg', '.eps', '.PNG', '.JPG'])) {
          warnings.push({
            severity: 'warning', message: `Image "${name}" is not in the project.`,
            file: path, line: lineOf(src, m.index),
            hint: 'Upload the image (keep the same folder name, for example figures/plot.png), or fix the path in \\includegraphics.',
          });
        }
      }
    }

    for (const m of src.matchAll(/\\(input|include|subfile)\s*\{([^}]+)\}/g)) {
      const name = m[2].trim();
      if (name.includes('\\') || name.includes('#')) continue;
      if (!exists(name, ['', '.tex'])) {
        warnings.push({
          severity: 'warning', message: `File "${/\.\w+$/.test(name) ? name : `${name}.tex`}" is not in the project.`,
          file: path, line: lineOf(src, m.index),
          hint: `It is loaded with \\${m[1]}{${name}}. Upload it, or fix the name.`,
        });
      }
    }

    for (const m of src.matchAll(/\\(?:no)?cite[a-zA-Z]*\*?\s*(?:\[[^\]]*\]\s*){0,2}\{([^}]*)\}/g)) {
      for (const key of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
        if (key === '*' || key.includes('\\') || key.includes('#')) continue;
        if (!cited.has(key)) cited.set(key, { file: path, line: lineOf(src, m.index) });
      }
    }
  }

  // Citation keys missing from the .bib files that do exist.
  const bibFiles = bibNamesFound.map((n) => resolve(baseDir, n)).filter((p) => files.has(p));
  if (usesBibliography && bibFiles.length && cited.size) {
    const defined = new Set();
    for (const p of bibFiles) {
      const text = files.get(p).text || '';
      for (const m of text.matchAll(/@(\w+)\s*[{(]\s*([^,\s{}()]+)\s*,/g)) {
        if (!/^(string|comment|preamble)$/i.test(m[1])) defined.add(m[2]);
      }
    }
    const missing = [...cited.keys()].filter((k) => !defined.has(k));
    if (missing.length) {
      const first = cited.get(missing[0]);
      warnings.push({
        severity: 'warning',
        message: `${missing.length} citation${missing.length === 1 ? ' is' : 's are'} not in ${bibFiles.map(basename).join(', ')}: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', …' : ''}`,
        file: first.file, line: first.line,
        hint: 'Check the spelling of these keys, or add entries for them to your .bib file. They will show as [?] in the PDF.',
      });
    }
  }

  return warnings;
}

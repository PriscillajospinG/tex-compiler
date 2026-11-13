'use strict';

// Turns raw TeX / BibTeX / Biber output into a short list of beginner-friendly problems:
//   { severity: 'error' | 'warning', message, file, line, context, hint }

const HINTS = [
  [/Undefined control sequence/i,
    'A command (something starting with \\) is misspelled, or it needs a package you have not loaded with \\usepackage.'],
  [/Missing \$ inserted/i,
    'A math-only symbol (like _, ^ or \\alpha) was used outside math mode. Wrap it in $...$.'],
  [/Bibliography file ".*" was not found/i,
    'The bibliography file named in \\bibliography{...} or \\addbibresource{...} is not in your project. Upload it, or fix the name.'],
  [/not found in the bibliography/i,
    'These citation keys are used in \\cite{...} but are not defined in your .bib file. Check the spelling or add the entries.'],
  [/Bibliography style ".*" was not found/i,
    'The bibliography style in \\bibliographystyle{...} was not found. Check its spelling, or upload the .bst file.'],
  [/File `[^']+' not found/i,
    'A file could not be found. Check the name and folder, and make sure the file is uploaded to the project.'],
  [/Missing \\begin\{document\}/i,
    'Text appears before \\begin{document}, or \\begin{document} is missing.'],
  [/\\begin\{[^}]*\} on input line \d+ ended by \\end\{/i,
    'An environment was closed with the wrong name. Every \\begin{x} needs a matching \\end{x}.'],
  [/Environment \S+ undefined/i,
    'This environment does not exist. Check the spelling, or load the package that defines it.'],
  [/Missing \} inserted|Extra \}|Too many \}'s|Extra alignment tab/i,
    'Braces or table columns do not match up. Check that every { has a matching } and each table row has the right number of &.'],
  [/Runaway argument|Paragraph ended before/i,
    'A closing brace } is probably missing, so the command swallowed too much text.'],
  [/Missing number|Illegal unit/i,
    'A length or number was expected here (for example 2cm or 0.5\\textwidth).'],
  [/I was expecting|Repeated entry|Illegal, another @/i,
    'There is a typing mistake in this .bib entry, such as a missing comma, brace, or a key used twice.'],
  [/Emergency stop|end occurred inside a group|\\end\{document\}/i,
    'TeX reached the end of the file unexpectedly. Check that the document ends with \\end{document} and all braces are closed.'],
];

function hintFor(message) {
  for (const [re, hint] of HINTS) if (re.test(message)) return hint;
  return null;
}

const NOISE = /^(Emergency stop\.?|==> Fatal error occurred, no output PDF file produced!|Job aborted.*)$/;
const FILE_LINE_ERROR = /^(\.{0,2}\/?[^:\s()][^:()]*\.[A-Za-z0-9]+):(\d+): (.*)$/;

/** Map compiler-side file names back to project paths. */
function normalizeFile(file, main) {
  if (!file) return null;
  let f = String(file).trim().replace(/^\.\//, '');
  if (/^(__main_document__|document)\.tex$/.test(f) && main) return main;
  if (f.startsWith('/')) return null; // system file (package, class)
  return f;
}

/** Track which file TeX is reading, using the "(./file.tex ... )" markers in the log. */
function makeFileTracker() {
  const stack = [];
  return {
    feed(line) {
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '(') {
          const m = /^\(([^\s()]+)/.exec(line.slice(i));
          stack.push(m && /[./]/.test(m[1]) ? m[1] : null);
        } else if (ch === ')') {
          stack.pop();
        }
      }
    },
    current() {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i] && /^\.\//.test(stack[i])) return stack[i];
      }
      return null;
    },
  };
}

function findLineRef(lines, from) {
  for (let j = from; j < Math.min(from + 25, lines.length); j++) {
    if (j > from && (lines[j].startsWith('! ') && !NOISE.test(lines[j].slice(2).trim()))) break;
    if (j > from && FILE_LINE_ERROR.test(lines[j]) && !NOISE.test(FILE_LINE_ERROR.exec(lines[j])[3].trim())) break;
    const m = /^l\.(\d+)\s?(.*)$/.exec(lines[j]);
    if (m) return { line: Number(m[1]), context: m[2].trim() || null };
  }
  return null;
}

function continueMessage(lines, i, message) {
  for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
    const next = lines[j];
    if (!next.trim() || /^(See the|Type |l\.\d+|\? )/.test(next) || next.startsWith('! ') || FILE_LINE_ERROR.test(next)) break;
    if (/^[A-Za-z(\\`]/.test(next) && message.length < 200 && !/[.!]$/.test(message)) message += ' ' + next.trim();
    else break;
  }
  return message;
}

function parseTexErrors(lines, main) {
  const out = [];
  const tracker = makeFileTracker();

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    let message = null;
    let file = null;
    let line = null;

    const fle = FILE_LINE_ERROR.exec(raw);
    if (fle) {
      file = fle[1];
      line = Number(fle[2]);
      message = fle[3].trim();
    } else if (raw.startsWith('! ')) {
      message = raw.slice(2).trim();
      file = tracker.current();
    } else {
      tracker.feed(raw);
      continue;
    }

    if (NOISE.test(message)) { out.push({ noise: true, message }); continue; }
    message = continueMessage(lines, i, message);

    const ref = findLineRef(lines, i + 1);
    let context = null;
    if (ref) {
      if (line === null) line = ref.line;
      context = ref.context;
    }
    if (line === null) {
      const m = /on input line (\d+)/.exec(message);
      if (m) line = Number(m[1]);
    }
    out.push({ severity: 'error', message, file: normalizeFile(file, main), line, context });
  }
  return out;
}

function parseBibErrors(lines, main) {
  const out = [];
  const missingKeys = [];

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m;
    if ((m = /^I couldn't open (database|style) file (.+)$/.exec(l))) {
      const name = m[2].trim();
      out.push({
        severity: 'error',
        message: m[1] === 'database' ? `Bibliography file "${name}" was not found.` : `Bibliography style "${name}" was not found.`,
        file: null, line: null, context: null, missingFile: name,
      });
    } else if ((m = /^Warning--I didn't find a database entry for "(.+)"$/.exec(l))
      || (m = /WARN - I didn't find a database entry for '(.+)'/.exec(l))) {
      missingKeys.push(m[1]);
    } else if ((m = /ERROR - Cannot find '([^']+)'/.exec(l))) {
      out.push({ severity: 'error', message: `Bibliography file "${m[1]}" was not found.`, file: null, line: null, context: null, missingFile: m[1] });
    } else if ((m = /^(.*)---line (\d+) of file (.+)$/.exec(l))) {
      const prev = m[1].trim() || (lines[i - 1] || '').trim();
      if (/\.aux$/.test(m[3])) continue; // the "\bibdata" echo that follows "couldn't open"
      out.push({ severity: 'error', message: `BibTeX: ${prev}`, file: normalizeFile(m[3], main), line: Number(m[2]), context: null });
    }
  }

  if (missingKeys.length) {
    const unique = [...new Set(missingKeys)];
    out.push({
      severity: 'warning',
      message: `${unique.length} citation${unique.length === 1 ? '' : 's'} not found in the bibliography: ${unique.slice(0, 12).join(', ')}${unique.length > 12 ? ', …' : ''}`,
      file: null, line: null, context: null,
    });
  }
  return out;
}

/** Find the line in the project that mentions a missing file (e.g. \usepackage{...} or \includegraphics{...}). */
function locateMention(name, files, preferredFile) {
  if (!files) return null;
  const stem = name.replace(/\.(sty|cls|tex|bib|bst|png|jpe?g|pdf|eps)$/i, '').split('/').pop();
  if (!stem) return null;
  const order = Object.keys(files).sort((a, b) => (a === preferredFile ? -1 : b === preferredFile ? 1 : 0));
  for (const path of order) {
    if (!/\.(tex|ltx|sty|cls)$/i.test(path)) continue;
    const idx = String(files[path]).split(/\r?\n/).findIndex((l) => !/^\s*%/.test(l) && l.includes(stem));
    if (idx !== -1) return { file: path, line: idx + 1 };
  }
  return null;
}

/**
 * @param {string} log           raw output
 * @param {object} [opts]
 * @param {string} [opts.main]   path of the main .tex file
 * @param {Object<string,string>|string} [opts.files]  project text files (path -> content), or a single source string
 */
function parseLog(log, opts = {}) {
  if (typeof opts === 'string') opts = { files: { [opts.main || 'main.tex']: opts }, main: 'main.tex' };
  const main = opts.main || 'main.tex';
  const files = typeof opts.files === 'string' ? { [main]: opts.files } : opts.files;
  const lines = String(log || '').split(/\r?\n/);

  let all = [...parseTexErrors(lines, main), ...parseBibErrors(lines, main)];
  const specific = all.filter((e) => !e.noise);
  all = specific.length ? specific : all.map((e) => ({ severity: 'error', message: e.message, file: null, line: null, context: null }));

  for (const e of all) {
    const missing = /File `([^']+)' not found/.exec(e.message);
    const name = (missing && missing[1]) || e.missingFile;
    if (name) {
      const at = locateMention(name, files, e.file);
      if (at) { e.file = at.file; e.line = at.line; e.context = null; }
    }
    delete e.missingFile;
    e.hint = hintFor(e.message);
  }

  const seen = new Set();
  return all.filter((e) => {
    const key = `${e.message}|${e.file}|${e.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 25);
}

module.exports = { parseLog, hintFor };

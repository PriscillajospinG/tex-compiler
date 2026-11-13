'use strict';

// Turns a raw TeX log into a short list of beginner-friendly errors.
// TeX reports errors as a line starting with "! " followed (a few lines later)
// by "l.<number> <text>" showing where in the source it stopped.

const HINTS = [
  [/Undefined control sequence/i,
    'A command (something starting with \\) is misspelled, or it needs a package you have not loaded with \\usepackage.'],
  [/Missing \$ inserted/i,
    'A math-only symbol (like _, ^ or \\alpha) was used outside math mode. Wrap it in $...$.'],
  [/File `[^']+' not found/i,
    'A package or file could not be found. Check the spelling of the name in \\usepackage or \\input.'],
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
  [/Emergency stop|end occurred inside a group|\\end\{document\}/i,
    'TeX reached the end of the file unexpectedly. Check that the document ends with \\end{document} and all braces are closed.'],
];

function hintFor(message) {
  for (const [re, hint] of HINTS) if (re.test(message)) return hint;
  return null;
}

const NOISE = /^(Emergency stop\.|==> Fatal error occurred, no output PDF file produced!)$/;

function parseLog(log, source) {
  const lines = String(log || '').split(/\r?\n/);
  const errors = [];

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('! ')) continue;

    let message = lines[i].slice(2).trim();
    // LaTeX errors sometimes wrap onto the next line(s) until a blank line or help text.
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const next = lines[j];
      if (!next.trim() || /^(See the|Type |l\.\d+|\? )/.test(next) || next.startsWith('! ')) break;
      if (/^[A-Za-z(\\`]/.test(next) && message.length < 200 && !/[.!]$/.test(message)) message += ' ' + next.trim();
      else break;
    }

    let line = null;
    let context = null;
    for (let j = i + 1; j < Math.min(i + 25, lines.length); j++) {
      // Keep looking past generic follow-ups like "! Emergency stop.", but not past a new real error.
      if (lines[j].startsWith('! ') && !NOISE.test(lines[j].slice(2).trim())) break;
      const m = /^l\.(\d+)\s?(.*)$/.exec(lines[j]);
      if (m) {
        line = Number(m[1]);
        context = m[2].trim() || null;
        break;
      }
    }
    if (line === null) {
      const m = /on input line (\d+)/.exec(message);
      if (m) line = Number(m[1]);
    }

    // For a missing file, point at the line that actually names it (e.g. \usepackage{...}).
    const missing = /File `([^']+)' not found/.exec(message);
    if (missing && source) {
      const stem = missing[1].replace(/\.(sty|cls|tex)$/, '');
      const idx = String(source).split(/\r?\n/).findIndex((l) => !/^\s*%/.test(l) && l.includes(stem));
      if (idx !== -1) { line = idx + 1; context = null; }
    }

    errors.push({ message, line, context, hint: hintFor(message) });
  }

  // Drop generic follow-up messages when a more specific error exists, and duplicates.
  const specific = errors.filter((e) => !NOISE.test(e.message));
  const result = specific.length ? specific : errors;
  const seen = new Set();
  return result.filter((e) => {
    const key = e.message + '|' + e.line;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
}

module.exports = { parseLog, hintFor };

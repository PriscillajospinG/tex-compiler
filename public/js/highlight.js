// A small, fast LaTeX highlighter. It works line by line and carries math-mode state
// across lines, so it can re-render on every keystroke without noticeable delay.

const SECTIONING = new Set([
  'part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph',
  'title', 'author', 'date', 'maketitle', 'documentclass', 'usepackage', 'tableofcontents',
]);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Highlight one line.
 * @param {string} line
 * @param {{math: false | '$' | '$$' | '\\(' | '\\['}} state  mutated to carry math mode to the next line
 * @returns {string} HTML
 */
export function highlightLine(line, state) {
  let out = '';
  let i = 0;
  let plain = '';
  const flush = () => {
    if (plain) {
      out += state.math ? `<span class="t-math">${esc(plain)}</span>` : esc(plain);
      plain = '';
    }
  };
  const emit = (cls, text) => { flush(); out += `<span class="${cls}">${esc(text)}</span>`; };

  while (i < line.length) {
    const ch = line[i];

    if (ch === '%') { // comment to end of line
      emit('t-comment', line.slice(i));
      break;
    }

    if (ch === '\\') {
      const next = line[i + 1];
      if (next === undefined) { plain += ch; i++; continue; }

      // math delimiters \( \) \[ \]
      if (next === '(' || next === '[') {
        emit('t-mathdelim', ch + next);
        state.math = `\\${next}`;
        i += 2; continue;
      }
      if (next === ')' || next === ']') {
        emit('t-mathdelim', ch + next);
        state.math = false;
        i += 2; continue;
      }

      const m = /^\\([A-Za-z@]+\*?)/.exec(line.slice(i));
      if (m) {
        const name = m[1].replace(/\*$/, '');
        // \begin{env} / \end{env}
        if (name === 'begin' || name === 'end') {
          const env = /^\s*\{([^}]*)\}/.exec(line.slice(i + m[0].length));
          emit('t-keyword', m[0]);
          i += m[0].length;
          if (env) {
            emit('t-brace', '{');
            emit('t-env', env[1]);
            emit('t-brace', '}');
            i += env[0].length;
            if (/^(equation|align|gather|multline|displaymath|math|eqnarray|flalign)\*?$/.test(env[1])) {
              state.math = name === 'begin' ? `env:${env[1]}` : false;
            }
          }
          continue;
        }
        emit(SECTIONING.has(name) ? 't-section' : 't-command', m[0]);
        i += m[0].length;
        continue;
      }
      // escaped single character such as \% \{ \\ \$
      emit(next === '\\' ? 't-special' : 't-escape', ch + next);
      i += 2;
      continue;
    }

    if (ch === '$') {
      const dbl = line[i + 1] === '$';
      const delim = dbl ? '$$' : '$';
      emit('t-mathdelim', delim);
      state.math = state.math === delim ? false : (state.math ? state.math : delim);
      i += delim.length;
      continue;
    }

    if (ch === '{' || ch === '}' || ch === '[' || ch === ']') {
      emit('t-brace', ch);
      i++;
      continue;
    }

    if (ch === '&' || ch === '~') {
      emit('t-special', ch);
      i++;
      continue;
    }

    plain += ch;
    i++;
  }
  flush();
  return out;
}

/** Highlight .bib content: entry types, keys, field names. */
export function highlightBibLine(line) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('%')) return `<span class="t-comment">${esc(line)}</span>`;
  let m = /^(\s*)(@\w+)(\s*[{(]\s*)([^,\s]*)(.*)$/.exec(line);
  if (m) {
    return `${esc(m[1])}<span class="t-keyword">${esc(m[2])}</span><span class="t-brace">${esc(m[3])}</span><span class="t-env">${esc(m[4])}</span>${esc(m[5])}`;
  }
  m = /^(\s*)([A-Za-z][\w-]*)(\s*=)(.*)$/.exec(line);
  if (m) return `${esc(m[1])}<span class="t-command">${esc(m[2])}</span>${esc(m[3])}${highlightLine(m[4], { math: false })}`;
  return highlightLine(line, { math: false });
}

export function highlighterFor(path) {
  if (/\.(tex|ltx|sty|cls|bbl|tikz|def|cfg|clo|dtx)$/i.test(path || '')) return 'tex';
  if (/\.bib$/i.test(path || '')) return 'bib';
  return 'plain';
}

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLog } = require('../lib/parse-log');

test('undefined control sequence reports line, context and hint', () => {
  const log = [
    'LaTeX Font Info:    ... okay on input line 2.',
    '! Undefined control sequence.',
    'l.3 Hi \\foo',
    '           ',
    '? ',
    '! Emergency stop.',
    'l.3 ',
    '!  ==> Fatal error occurred, no output PDF file produced!',
  ].join('\n');
  const errors = parseLog(log);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, 'Undefined control sequence.');
  assert.equal(errors[0].line, 3);
  assert.equal(errors[0].context, 'Hi \\foo');
  assert.match(errors[0].hint, /misspelled/);
});

test('missing package error', () => {
  const log = [
    "! LaTeX Error: File `notapackage.sty' not found.",
    '',
    "Type X to quit or <RETURN> to proceed,",
    'or enter new name. (Default extension: sty)',
    '',
    'Enter file name: ',
    '! Emergency stop.',
    '<read *> ',
    '         ',
    'l.2 \\usepackage',
    '               {notapackage}^^M',
  ].join('\n');
  const errors = parseLog(log);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, "LaTeX Error: File `notapackage.sty' not found.");
  assert.equal(errors[0].line, 2);
  assert.match(errors[0].hint, /package/);
});

test('mismatched environment uses "on input line"', () => {
  const log = [
    '! LaTeX Error: \\begin{itemize} on input line 5 ended by \\end{document}.',
    '',
    'See the LaTeX manual or LaTeX Companion for explanation.',
    'l.9 \\end{document}',
  ].join('\n');
  const [e] = parseLog(log);
  assert.equal(e.line, 9);
  assert.match(e.hint, /matching/);
});

test('empty log gives no errors', () => {
  assert.deepEqual(parseLog(''), []);
});

test('missing file is located in the source when the log points elsewhere', () => {
  const log = "! LaTeX Error: File `nopkgxyz.sty' not found.\n\n! Emergency stop.\n<read *> \nl.3 \\begin\n";
  const source = '\\documentclass{article}\n\\usepackage{nopkgxyz}\n\\begin{document}\nHi\n\\end{document}\n';
  const [e] = parseLog(log, source);
  assert.equal(e.line, 2);
});

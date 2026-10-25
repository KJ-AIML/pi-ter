import test from 'node:test';
import assert from 'node:assert/strict';
import { splitSentences, splitLine, styleReply, formatHeadings } from '../extensions/sentences.ts';
import { lineParts, rawSubjectOf, subjectOf, clip } from '../extensions/tool-lines.ts';

test('splits prose into one sentence per line', () => {
  assert.equal(splitLine('First one. Second one! Third?'), 'First one.  \nSecond one!  \nThird?');
});
test('keeps abbreviations, initials, lowercase continuations, code, links, urls', () => {
  assert.equal(splitLine('Use e.g. Python or J. Smith, v2. then go.'), 'Use e.g. Python or J. Smith, v2. then go.');
  assert.equal(splitLine('Run `a. B` now. See [x. Y](http://a.b/c. D) ok.'), 'Run `a. B` now.  \nSee [x. Y](http://a.b/c. D) ok.');
});
test('leaves code fences, headings, lists, tables, quotes untouched', () => {
  const md = '# Title. Sub\n\n```js\nfoo(). Bar()\n```\n\n- one. Two\n| a. B |\n> q. R\n\nHello. World';
  assert.equal(splitSentences(md), md.replace('Hello. World', 'Hello.  \nWorld'));
});
test('tool line subject', () => {
  assert.equal(subjectOf({ command: 'ls   -la\n/tmp' }), 'ls -la /tmp');
  assert.equal(subjectOf({ nothing: 1 }), '{"nothing":1}');
  assert.equal(clip('abcdef', 4), 'abc…');
  const p = lineParts('read', { path: '/Users/me/x.ts' }, true);
  assert.deepEqual(p, { tool: 'read', subject: '~/x.ts', meta: 'error' });
  assert.equal(rawSubjectOf({ path: '/Users/me/x.ts' }), '/Users/me/x.ts');
  assert.equal(rawSubjectOf({ command: 'echo a\necho b' }), 'echo a\necho b');
  assert.equal(rawSubjectOf({ nothing: 1 }), '{"nothing":1}');
});

test('h1 becomes an inline-code banner, other headings stay', () => {
  assert.equal(styleReply('# Title\n\n## Sub\n\nHello. World'), '`# Title `\n\n## Sub\n\nHello.  \nWorld');
});

test('keeps fenced code blocks for highlighted rendering', () => {
  const md = 'Run this.\n\n```bash\ncd repo\npnpm test\n```\n\nDone.';
  const out = styleReply(md);
  assert.match(out, /```bash\ncd repo\npnpm test\n```/);
  assert.match(out, /Run this\./);
  assert.match(out, /Done\./);
});

test('headings inside code blocks are not turned into banners', () => {
  const md = '# Title\n\n```sh\n# a comment\n```';
  const out = formatHeadings(md);
  assert.equal(out, '`# Title `\n\n```sh\n# a comment\n```');
});


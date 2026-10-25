import test from 'node:test';
import assert from 'node:assert/strict';
import { Markdown, stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui';
import { installCodeCopy, setCodeCopyTheme } from '../extensions/code-copy.ts';

const id = (text: string) => text;
const theme = {
  heading: id, link: id, linkUrl: id, code: id, codeBlock: id, codeBlockBorder: id,
  quote: id, quoteBorder: id, hr: id, listBullet: id, bold: id, italic: id,
  strikethrough: id, underline: id,
};

test('code blocks show a clickable copy label with the block source', async () => {
  setCodeCopyTheme(() => undefined);
  const copied: string[] = [];
  installCodeCopy(async text => { copied.push(text); });
  const markdown = new Markdown('```bash\npwd\n```', 0, 0, theme);
  const lines = markdown.render(40);
  assert.ok(lines.some(line => line.includes('bash') && line.includes('[copy]')));
  assert.ok(lines.every(line => !line.includes('```')));
  const rerendered = markdown.render(40);
  assert.ok(rerendered.some(line => line.includes('[copy]')));
  const hits = (markdown as any).__piterCopyHits;
  assert.equal(hits.length, 1);
  assert.equal(hits[0].text, 'pwd');
  assert.equal((markdown as any).handleMouse({ type: 'click', button: 'left', y: 0, x: 0 }), undefined);
  assert.deepEqual(
    (markdown as any).handleMouse({ type: 'click', button: 'left', y: hits[0].y, x: hits[0].start }),
    { handled: true },
  );
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(copied, ['pwd']);
  const flashed = markdown.render(40);
  assert.ok(flashed.some(line => line.includes('[copied]')));
  assert.equal((markdown as any).__piterCopyHits.length, 1);

  const background = new Markdown('```bash\npwd\n```', 0, 0, theme, { bgColor: text => `\x1b[44m${text}\x1b[49m` });
  const backgroundLines = background.render(24);
  const footer = backgroundLines.find(line => line.includes('[copy]'));
  assert.ok(footer);
  assert.ok(visibleWidth(footer) <= 24);
});

test('code blocks use the theme panel and right-align the copy label', () => {
  const bg = (_color: string, text: string) => `\x1b[48;5;236m${text}\x1b[49m`;
  const fg = (_color: string, text: string) => text;
  setCodeCopyTheme(() => ({ bg, fg }));
  const markdown = new Markdown('```bash\npwd\n```', 0, 0, theme);
  const lines = markdown.render(40);

  const header = lines.find(line => stripTerminalSequences(line).includes('[copy]'));
  assert.ok(header);
  assert.ok(header.startsWith('\x1b[48;5;236m'));
  assert.ok(header.endsWith('\x1b[49m'));
  const headerPlain = stripTerminalSequences(header);
  assert.equal(headerPlain.length, 40);
  assert.ok(headerPlain.startsWith('  bash'));
  assert.ok(headerPlain.trimEnd().endsWith('[copy]'));
  assert.ok(headerPlain.indexOf('[copy]') > '  bash'.length + 4);

  const code = lines.find(line => stripTerminalSequences(line).includes('pwd'));
  assert.ok(code?.startsWith('\x1b[48;5;236m'));
  setCodeCopyTheme(() => undefined);
});

/**
 * One sentence per line in assistant prose, ported from Tickloop/claude-mods `glamour-dark`.
 * Operates on markdown text: only plain paragraph lines change; code, tables, headings,
 * lists, quotes, inline code and links are left alone. Uses a markdown hard break so wrapping is unaffected.
 */
const ABBREVIATION = /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|cf|approx|al|Mr|Mrs|Ms|Dr|St|No|Fig)\.$/i;
const INITIAL = /(?:^|\s)\p{Lu}\.$/u;
const SENTENCE_END = /[.!?]["'”’)\]]*$/;
const PROTECTED = /(`[^`]*`|\[[^\]]*\]\([^)]*\)|https?:\/\/\S+|\*\*[^*]+\*\*)/;
const SKIP_LINE = /^\s*(#{1,6}\s|[-*+]\s|\d{1,9}[.)]\s|>|\||<|    |\t)/;
const BREAK = '  \n';

const endsSentence = (before: string) => SENTENCE_END.test(before) && !ABBREVIATION.test(before) && !INITIAL.test(before);

export function splitLine(line: string): string {
  if (SKIP_LINE.test(line) || line.trim() === '') return line;
  const parts = line.split(PROTECTED);
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i % 2 === 1) { out += part; continue; } // protected span
    let start = 0;
    for (const gap of part.matchAll(/\s+/g)) {
      const at = gap.index ?? 0, end = at + gap[0].length;
      if (end >= part.length) continue;
      // Next sentence must start with a non-lowercase letter/digit/symbol.
      if (/\p{Ll}/u.test(part[end])) continue;
      const before = (out + part.slice(0, at)).trimEnd();
      if (!endsSentence(before)) continue;
      out += part.slice(start, at) + BREAK;
      start = end;
    }
    out += part.slice(start);
  }
  return out;
}

export function styleReply(markdown: string): string {
  return splitSentences(markdown).replace(/^(# .+)$/gm, (_, h) => '`' + h + ' `');
}

export function splitSentences(markdown: string): string {
  let fence: string | undefined;
  return markdown.split('\n').map(line => {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (m) { fence = fence === undefined ? m[1][0] : fence === m[1][0] ? undefined : fence; return line; }
    return fence !== undefined ? line : splitLine(line);
  }).join('\n');
}

import { basename } from 'node:path';
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';

export const accents = ['#c995f5', '#67dce5', '#92e6b3', '#f4a6ce', '#edcf83'];
export const paint = (hex: string, text: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `\x1b[38;2;${n >> 16};${(n >> 8) & 255};${n & 255}m${text}\x1b[0m`;
};
export const fit = (text: string, width: number) => {
  const clipped = truncateToWidth(text, Math.max(0, width));
  return clipped + ' '.repeat(Math.max(0, width - visibleWidth(clipped)));
};
export const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');
export type Resources = Record<'Skills' | 'Extensions' | 'Prompts' | 'Context', string[]>;
export const emptyResources = (): Resources => ({ Skills: [], Extensions: [], Prompts: [], Context: [] });

// Spaced pixels retain the wordmark without turning it into a solid slab.
const glyphs = [
  ['110', '101', '110', '100', '100'],
  ['111', '010', '010', '010', '111'],
  ['111', '010', '010', '010', '010'],
  ['111', '100', '110', '100', '111'],
  ['110', '101', '110', '101', '101'],
];
const logo = Array.from({ length: 5 }, (_, row) => glyphs.map(g => [...g[row]].map(c => c === '1' ? '▪' : ' ').join(' ')).join('  '));

// Display-only grouping by name; unknown skills remain visible in Other.
export function groupSkills(skills: string[]): { label: string; items: string[] }[] {
  const rules: [string, RegExp][] = [
    ['Review', /review|audit|test|debug|verif|valid|quality/i],
    ['Infrastructure', /deploy|docker|cloud|infra|supabase|postgres|database|worker|hosting|render|terraform|kubernetes/i],
    ['Design', /design|image|visual|figma|frontend|animation|video/i],
    ['Development', /develop|code|coding|implement|build|git|plan|brainstorm|worktree|skill|harness|piter|refactor/i],
    ['Other', /.*/],
  ];
  const groups = rules.map(([label]) => ({ label, items: [] as string[] }));
  for (const skill of skills) groups[rules.findIndex(([, pattern]) => pattern.test(skill))].items.push(skill);
  return groups.filter(g => g.items.length).sort((a, b) => ['Development', 'Review', 'Infrastructure', 'Design', 'Other'].indexOf(a.label) - ['Development', 'Review', 'Infrastructure', 'Design', 'Other'].indexOf(b.label));
}

export function workspaceLines(width: number, height: number, cwd: string, resources: Resources, accent: string, version: string, expanded = true): string[] {
  const name = basename(cwd) || cwd;
  const muted = (s: string) => paint('#9297a6', s);
  const title = (s: string) => paint(accent, s);
  const header = [
    ` ${paint('#37d5d1', 'pi-ter')}  ${muted(`v${version}`)}  ·  ${paint('#eee780', `${resources.Skills.length} skills`)}  ·  ${paint('#ed91cd', `${resources.Extensions.length} extensions`)}  ·  ${paint('#63bafa', `${resources.Prompts.length} prompts`)}`,
    ` ${muted('Type your prompt or')} / for commands  ·  ${paint('#ffb15b', '/fire')}  ·  Ctrl+O for tools`,
  ];
  if (!expanded || height < 13) return header.map(s => fit(s, width));
  const left = [title(`WORKSPACE / ${name.toUpperCase()}`), '', ...logo.map(title), '', title(name), cwd, muted(`Context  ${resources.Context.join(' · ') || 'None loaded'}`)];
  const right: string[] = [];
  const leftWidth = Math.min(48, Math.floor(width * .36));
  const rightWidth = width >= 92 ? width - leftWidth - 6 : width - 2;
  const heading = (label: keyof Resources, color: string) =>
    fit(paint(color, `▾  ${label}`), Math.max(0, rightWidth - String(resources[label].length).length - 1)) + ` ${resources[label].length}`;
  const bodyHeight = Math.max(0, height - 5);
  const contentBudget = bodyHeight - (width < 92 ? 3 : 0);
  const groups = groupSkills(resources.Skills);
  // Reserve every resource heading before spending spare rows on examples.
  const detailed = contentBudget >= 12 + Math.max(1, groups.length);
  right.push(heading('Skills', '#eee780'));
  for (const group of groups) {
    right.push(`   ${paint('#d1d5df', group.label)} ${muted(String(group.items.length))}${detailed ? muted(`  ${group.items.join(' · ')}`) : ''}`);
  }
  if (!groups.length) right.push(muted('   None loaded'));
  for (const [label, color] of [['Extensions', '#cf94f3'], ['Prompts', '#63bafa'], ['Context', '#e2e4eb']] as const) {
    if (detailed) right.push('');
    right.push(heading(label, color));
    if (detailed) right.push(muted(`   ${resources[label].join(' · ') || 'None loaded'}`));
  }
  // Very short windows show totals; the resource picker still exposes all names.
  if (right.length > contentBudget) {
    right.splice(0, right.length, ...(['Skills', 'Extensions', 'Prompts', 'Context'] as const).map(label => heading(label, '#d1d5df')));
  }
  const contentHeight = width >= 92 ? Math.max(left.length, right.length) : right.length + 3;
  const topPad = Math.min(3, Math.max(0, Math.floor((bodyHeight - contentHeight) / 3)));
  const lines = [...header, ''];
  for (let row = 0; row < bodyHeight; row++) {
    const i = row - topPad;
    if (width >= 92) {
      const divider = i >= 0 && i < contentHeight ? title('│') : ' ';
      lines.push(`  ${fit(left[i] || '', leftWidth)} ${divider}  ${fit(right[i] || '', rightWidth)}`);
    } else {
      const compact = [title(`WORKSPACE / ${name}`), muted(cwd), '', ...right];
      lines.push(`  ${compact[i] || ''}`);
    }
  }
  lines.push(` ${muted('/workspace to browse all loaded resources')}`, '');
  return lines.slice(0, height).map(s => fit(s, width));
}

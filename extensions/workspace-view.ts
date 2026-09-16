import { wordmark } from './wordmark.ts';
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
  const layoutWidth = Math.min(width, 148);
  const inset = Math.max(0, Math.floor((width-layoutWidth)/2));
  const leftWidth = Math.min(48, Math.floor(layoutWidth * .36));
  const logo = wordmark(leftWidth, accent);
  const left = [muted('YOUR WORKSPACE'), title(`WORKSPACE / ${name.toUpperCase()}`), '', ...logo, '', title(name), muted(cwd.replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, '~')), muted(`${resources.Context.length} context file${resources.Context.length===1?'':'s'} loaded`)];
  const right: string[] = [];
  const rightWidth = width >= 92 ? layoutWidth - leftWidth - 8 : width - 4;
  const heading = (label: keyof Resources, color: string) =>
    paint(color, label) + muted(`  /  ${resources[label].length}`);
  const bodyHeight = Math.max(0, height - 5);
  const contentBudget = bodyHeight - (width < 92 ? 3 : 0);
  const groups = groupSkills(resources.Skills);
  // Reserve every resource heading before spending spare rows on examples.
  const detailed = contentBudget >= 12 + Math.max(1, groups.length);
  const preview = (items:string[], count=3) => items.slice(0,count).join(' · ') + (items.length>count ? `  +${items.length-count} more` : '');
  right.push(heading('Skills', '#eee780'));
  for (const group of groups) {
    right.push(`  ${paint('#d1d5df', fit(group.label, 15))} ${title(String(group.items.length).padStart(2))}${detailed ? muted(`   ${preview(group.items,2)}`) : ''}`);
  }
  if (!groups.length) right.push(muted('   None loaded'));
  for (const [label, color] of [['Extensions', '#cf94f3'], ['Prompts', '#63bafa'], ['Context', '#e2e4eb']] as const) {
    if (detailed) right.push('');
    right.push(heading(label, color));
    if (detailed) right.push(muted(`   ${preview(resources[label].map(item=>label==='Extensions'?item.replace(/^@[^/]+\//,'').replace(/:(src|dist)$/,''):item),label==='Context'?1:3) || 'None loaded'}`));
  }
  // Very short windows show totals; the resource picker still exposes all names.
  if (right.length > contentBudget) {
    right.splice(0, right.length, ...(['Skills', 'Extensions', 'Prompts', 'Context'] as const).map(label => heading(label, '#d1d5df')));
  }
  const contentHeight = width >= 92 ? Math.max(left.length, right.length) : right.length + 3;
  const topPad = Math.min(6, Math.max(0, Math.floor((bodyHeight - contentHeight) / 3)));
  const lines = [...header, ''];
  for (let row = 0; row < bodyHeight; row++) {
    const i = row - topPad;
    if (width >= 92) {
      const divider = i >= 0 && i < contentHeight ? paint('#303743','│') : ' ';
      lines.push(`${' '.repeat(inset)}  ${fit(left[i] || '', leftWidth)}   ${divider}  ${fit(right[i] || '', rightWidth)}`);
    } else {
      const compact = [title(`WORKSPACE / ${name}`), muted(cwd), '', ...right];
      lines.push(`  ${compact[i] || ''}`);
    }
  }
  lines.push(` ${muted('/workspace  Browse resources     /tasks  View background work')}`, '');
  return lines.slice(0, height).map(s => fit(s, width));
}

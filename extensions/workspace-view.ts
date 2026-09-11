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

const logo = [
  '█████  ██ ███████ ███████ ██████ ',
  '██  ██ ██   ██    ██      ██  ██',
  '█████  ██   ██    █████   █████ ',
  '██     ██   ██    ██      ██  ██',
  '██     ██   ██    ███████ ██  ██',
];

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
  const section = (label: keyof Resources, color: string, rows: number) => {
    const items = resources[label];
    right.push(fit(paint(color, `${label === 'Skills' ? '▾' : '▸'}  ${label}`), Math.max(0, rightWidth - String(items.length).length - 1)) + ` ${items.length}`);
    for (let i = 0; i < Math.min(items.length, rows); i++) right.push(`   ${muted(items[i])}`);
    if (!items.length) right.push(muted('   None loaded'));
    if (items.length > rows) right.push(muted(`   +${items.length - rows} more · /workspace ${label.toLowerCase()}`));
    right.push('');
  };
  section('Skills', '#eee780', height >= 28 ? 3 : 1);
  section('Extensions', '#cf94f3', 1);
  section('Prompts', '#63bafa', 1);
  section('Context', '#e2e4eb', 1);
  const bodyHeight = Math.max(0, height - 5);
  const lines = [...header, ''];
  if (width >= 92) {
    for (let i = 0; i < bodyHeight; i++) {
      lines.push(`  ${fit(left[i] || '', leftWidth)} ${title('│')}  ${fit(right[i] || '', width - leftWidth - 6)}`);
    }
  } else {
    const compact = [title(`WORKSPACE / ${name}`), muted(cwd), '', ...right];
    for (let i = 0; i < bodyHeight; i++) lines.push(`  ${compact[i] || ''}`);
  }
  const harness = resources.Extensions.some(s => /heli-harness/i.test(s));
  lines.push(harness ? ` ${paint('#9ded85', '●')} ${muted('Heli-Harness active')}` : ` ${muted('/workspace to browse loaded resources')}`, '');
  return lines.slice(0, height).map(s => fit(s, width));
}

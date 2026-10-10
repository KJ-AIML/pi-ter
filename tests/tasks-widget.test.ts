import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleWidth } from '@earendil-works/pi-tui';
import { renderTaskWidget, KEEP_FINISHED_MS, MAX_ROWS } from '../extensions/tasks/widget.ts';
import type { TaskRecord } from '../extensions/tasks/types.ts';

const now = 1_000_000;
const paint = (_c: string, t: string) => t;
const task = (id: string, extra: Partial<TaskRecord> = {}): TaskRecord => ({ id, kind: 'terminal', title: id, cwd: '/', command: id, status: 'running', startedAt: now - 72_000, latest: '', logPath: '', logs: [], dropped: 0, diskTruncated: false, ...extra });

test('renders like the Todos panel: heading count, tree rows and status icons', () => {
  const { lines, rows } = renderTaskWidget([
    task('Heli recon', { kind: 'agent' }),
    task('npm test', { status: 'completed', startedAt: now - 9_000, endedAt: now - 1_000, exitCode: 0 }),
    task('npm run build', { status: 'failed', startedAt: now - 5_000, endedAt: now - 2_000, exitCode: 1 }),
  ], 80, now, paint);
  assert.equal(lines[0], '● Tasks (1/3)');
  assert.match(lines[1], /^├─ \S Agent Heli recon 1m12s$/);
  assert.equal(lines[2], '├─ ✓ Run   npm test 8s');
  assert.equal(lines[3], '└─ ✗ Run   npm run build 3s · exit 1');
  assert.equal(lines.at(-1), '', 'trailing spacer like Todos');
  assert.deepEqual(rows.slice(0, 4), [undefined, 'Heli recon', 'npm test', 'npm run build'], 'click rows map to task ids');
});

test('hidden when there is nothing to show; finished tasks expire', () => {
  assert.deepEqual(renderTaskWidget([], 80, now, paint).lines, []);
  const old = task('old', { status: 'completed', endedAt: now - KEEP_FINISHED_MS - 1 });
  assert.deepEqual(renderTaskWidget([old], 80, now, paint).lines, []);
  const idle = renderTaskWidget([task('s', { status: 'stopped', endedAt: now })], 80, now, paint).lines;
  assert.equal(idle[0], '○ Tasks (0/1)', 'dim heading when nothing runs'); assert.match(idle[1], /└─ ■ Run   s/);
});

test('overflow and collapse use a └─ summary row, and lines never exceed the width', () => {
  const many = Array.from({ length: MAX_ROWS + 3 }, (_, i) => task(`job-${i} ${'x'.repeat(80)}`));
  const { lines, rows } = renderTaskWidget(many, 40, now, paint);
  assert.equal(lines.at(-2), '└─ +3 more · F6 to open'); assert.equal(rows.at(-2), undefined);
  assert.ok(lines.every(l => visibleWidth(l) <= 40));
  const c = renderTaskWidget(many, 80, now, paint, true).lines;
  assert.deepEqual(c, ['● Tasks (0/9)', '└─ 9 running · F6 to open', '']);
});

export type TaskKind = 'terminal' | 'agent';
export type TaskStatus = 'starting' | 'running' | 'stopping' | 'completed' | 'failed' | 'stopped' | 'timed_out';
export type LogStream = 'stdout' | 'stderr' | 'agent' | 'tool' | 'system';
export interface LogEntry { seq: number; time: number; stream: LogStream; text: string }
export interface TaskRecord {
  id: string; kind: TaskKind; title: string; cwd: string; command: string; model?: string;
  status: TaskStatus; startedAt: number; endedAt?: number; exitCode?: number | null;
  pid?: number; latest: string; logPath: string; logs: LogEntry[]; dropped: number;
  diskTruncated: boolean; result?: string; error?: string;
}
export const activeTask = (task: TaskRecord): boolean => ['starting', 'running', 'stopping'].includes(task.status);
export interface TaskSource {
  list(): TaskRecord[];
  get(id: string): TaskRecord | undefined;
  stop(id: string): Promise<TaskRecord>;
  subscribe(listener: () => void): () => void;
}

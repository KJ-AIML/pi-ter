export type TaskKind = 'terminal' | 'agent';
export type TaskStatus = 'starting' | 'running' | 'stopping' | 'completed' | 'failed' | 'stopped' | 'timed_out';
export type LogStream = 'stdout' | 'stderr' | 'agent' | 'tool' | 'system';
export interface LogEntry { seq: number; time: number; stream: LogStream; text: string }
/** Provider-reported usage summed over a subagent's assistant messages. */
export interface TaskUsage { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost: number; turns: number }
/** Live counters for a running agent: assistant turns started, tool calls started, tokens and cost so far. */
export interface TaskProgress { turns: number; tools: number; tokens: number; cost: number }
/** What a finished agent needs to be continued: its private session folder and the options it ran with. */
export interface AgentSessionInfo { sessionDir: string; options: Record<string, unknown> }
export type AgentMessageMode = 'steer' | 'followUp';
export interface TaskRecord {
  id: string; kind: TaskKind; title: string; cwd: string; command: string; model?: string;
  status: TaskStatus; startedAt: number; endedAt?: number; exitCode?: number | null;
  pid?: number; latest: string; logPath: string; logs: LogEntry[]; dropped: number;
  diskTruncated: boolean; result?: string; error?: string;
  resultPath?: string; usage?: TaskUsage; progress?: TaskProgress;
  agent?: AgentSessionInfo;
}
export const activeTask = (task: TaskRecord): boolean => ['starting', 'running', 'stopping'].includes(task.status);
export interface TaskSource {
  list(): TaskRecord[];
  get(id: string): TaskRecord | undefined;
  stop(id: string): Promise<TaskRecord>;
  subscribe(listener: () => void): () => void;
}

// The one IPC contract. Main registers a handler per channel, preload exposes one function per
// channel, and window.api's type is derived from this file, so the three cannot drift apart.
import type { BoardData, Card, CreateIssue, IssueDetail, IssueIndexEntry, LabelInfo, MoveIssue, UpdateIssue, UpsertLabel } from './board';
import type { MetricsOverview, TaskDiff, TaskMetrics } from './metrics';
import type { AppConfig, GeneralSettings, Price, Project } from './schemas';
import type { LaunchResult, Notice, RunInfo, SessionsSummary } from './sessions';
import type { FileContent, FileNode, PipelineAction, TaskDetail, TaskProgress, TemplateError, TemplateInfo } from './tasks';
import type { AppInfo, ConfigState, PreflightResult, RepoInfo } from './types';

export interface IpcContract {
  'board:list': { req: { projectSlug: string }; res: BoardData };
  'issues:get': { req: { id: number }; res: IssueDetail };
  'issues:index': { req: void; res: IssueIndexEntry[] };
  'issues:create': { req: CreateIssue; res: Card };
  'issues:update': { req: UpdateIssue; res: Card };
  'issues:move': { req: MoveIssue; res: void };
  'issues:archive': { req: { id: number; archived: boolean }; res: void };
  'issues:attach': { req: { issueId: number; paths: string[] }; res: void };
  'issues:detach': { req: { attachmentId: number }; res: void };
  'issues:revealAttachments': { req: { id: number }; res: void };
  'labels:upsert': { req: UpsertLabel; res: LabelInfo };
  'labels:delete': { req: { id: number }; res: void };
  'comments:add': { req: { issueId: number; body: string }; res: void };
  'dialog:pickFiles': { req: { title?: string }; res: string[] };
  'templates:list': { req: void; res: { templates: TemplateInfo[]; errors: TemplateError[] } };
  'tasks:create': { req: { issueId: number; template: string }; res: TaskDetail };
  'tasks:get': { req: { id: number }; res: TaskDetail };
  'tasks:abandon': { req: { id: number; force?: boolean }; res: void };
  'tasks:files': { req: { id: number }; res: FileNode[] };
  'tasks:readFile': { req: { id: number; path: string }; res: FileContent };
  'tasks:writeFile': { req: { id: number; path: string; text: string }; res: { mtime: number } };
  'tasks:addResources': { req: { id: number; paths: string[] }; res: string[] };
  'tasks:removeResource': { req: { id: number; path: string }; res: void };
  'tasks:refreshIssue': { req: { id: number }; res: void };
  'tasks:reveal': { req: { id: number; what: 'folder' | 'worktree' | 'file'; path?: string }; res: void };
  'sessions:start': { req: { taskId: number }; res: LaunchResult };
  'sessions:launch': { req: { stageId: number }; res: LaunchResult };
  'sessions:stop': { req: { stageId: number }; res: void };
  'sessions:attach': { req: { runId: number }; res: { data: string; live: boolean } };
  'sessions:runs': { req: { taskId: number }; res: RunInfo[] };
  'sessions:summary': { req: void; res: SessionsSummary };
  'pipeline:act': { req: { taskId: number; action: PipelineAction }; res: LaunchResult };
  'review:diff': { req: { taskId: number; sha?: string }; res: TaskDiff };
  'ship:pr': { req: { taskId: number }; res: string };
  'ship:savePr': { req: { taskId: number; text: string }; res: void };
  'ship:push': { req: { taskId: number; force: boolean }; res: { ok: boolean; output: string } };
  'tasks:finish': { req: { id: number; force?: boolean }; res: void };
  'metrics:task': { req: { taskId: number }; res: TaskMetrics };
  'metrics:overview': { req: void; res: MetricsOverview };
  'pty:input': { req: { runId: number; data: string }; res: void };
  'pty:resize': { req: { runId: number; cols: number; rows: number }; res: void };
  'app:info': { req: void; res: AppInfo };
  'config:get': { req: void; res: ConfigState };
  'config:setGeneral': { req: GeneralSettings; res: AppConfig };
  'config:setPriceTable': { req: Record<string, Price>; res: AppConfig };
  'projects:upsert': { req: Project; res: AppConfig };
  'projects:remove': { req: { slug: string }; res: AppConfig };
  'preflight:run': { req: { claudeBinary?: string }; res: PreflightResult };
  'repo:inspect': { req: { path: string }; res: RepoInfo };
  'dialog:pickFolder': { req: { title?: string; defaultPath?: string }; res: string | null };
  'shell:openPath': { req: { path: string }; res: void };
}

export type Channel = keyof IpcContract;
export type Req<C extends Channel> = IpcContract[C]['req'];
export type Res<C extends Channel> = IpcContract[C]['res'];

/** Main → renderer push events. */
export interface IpcEvents {
  'theme:changed': { resolved: 'light' | 'dark' };
  /** config.json was saved (from the window or the CLI). */
  'config:changed': AppConfig;
  /** Any change to a project's issues, labels, comments or attachments (including the renderer's own). */
  'board:changed': { projectSlug: string; issueId?: number };
  /** A task's row, stages or folder changed. */
  'task:changed': { taskId: number; issueId: number; projectSlug: string };
  /** One creation step started, finished or failed. */
  'task:progress': TaskProgress;
  /** Ctrl+W, caught in main so it closes a task tab instead of the window. */
  'shortcut:closeTab': Record<string, never>;
  /** Output from the setup commands, as it arrives. */
  'task:log': { issueId: number; taskId: number; chunk: string };
  /** PTY output for one run, batched every 16 ms. */
  'pty:data': { runId: number; data: string };
  'pty:exit': { runId: number; exitCode: number };
  /** Live/queued sessions changed: the Running view, sidebar count and status bar refresh. */
  'sessions:changed': SessionsSummary;
  /** A toast from main: fence blocks, a stage ready for me, a trust-prompt exit. */
  notice: Notice;
  /** An OS notification was clicked: focus that task. */
  'notice:open': { taskId: number };
}

// Runtime list of channels for preload. `satisfies` makes the compiler reject a missing or extra name.
const channelMap = {
  'board:list': true,
  'issues:get': true,
  'issues:index': true,
  'issues:create': true,
  'issues:update': true,
  'issues:move': true,
  'issues:archive': true,
  'issues:attach': true,
  'issues:detach': true,
  'issues:revealAttachments': true,
  'labels:upsert': true,
  'labels:delete': true,
  'comments:add': true,
  'dialog:pickFiles': true,
  'templates:list': true,
  'tasks:create': true,
  'tasks:get': true,
  'tasks:abandon': true,
  'tasks:files': true,
  'tasks:readFile': true,
  'tasks:writeFile': true,
  'tasks:addResources': true,
  'tasks:removeResource': true,
  'tasks:refreshIssue': true,
  'tasks:reveal': true,
  'sessions:start': true,
  'sessions:launch': true,
  'sessions:stop': true,
  'sessions:attach': true,
  'sessions:runs': true,
  'sessions:summary': true,
  'pipeline:act': true,
  'review:diff': true,
  'ship:pr': true,
  'ship:savePr': true,
  'ship:push': true,
  'tasks:finish': true,
  'metrics:task': true,
  'metrics:overview': true,
  'pty:input': true,
  'pty:resize': true,
  'app:info': true,
  'config:get': true,
  'config:setGeneral': true,
  'config:setPriceTable': true,
  'projects:upsert': true,
  'projects:remove': true,
  'preflight:run': true,
  'repo:inspect': true,
  'dialog:pickFolder': true,
  'shell:openPath': true,
} as const satisfies Record<Channel, true>;
export const CHANNELS = Object.keys(channelMap) as Channel[];

type Call<C extends Channel> = Req<C> extends void ? () => Promise<Res<C>> : (req: Req<C>) => Promise<Res<C>>;

export interface Api {
  invoke: { [C in Channel]: Call<C> };
  on<E extends keyof IpcEvents>(event: E, cb: (payload: IpcEvents[E]) => void): () => void;
  /** Absolute path of a dropped file (Electron removed File.path; this wraps webUtils.getPathForFile). */
  pathForFile(file: File): string;
}

/** Errors from main arrive as Error with this prefix stripped to a clean message. */
export const IPC_ERROR_PREFIX = 'YANTRA:';

// The one IPC contract. Main registers a handler per channel, preload exposes one function per
// channel, and window.api's type is derived from this file, so the three cannot drift apart.
import type { BoardData, Card, CreateIssue, IssueDetail, IssueIndexEntry, LabelInfo, MoveIssue, UpdateIssue, UpsertLabel } from './board';
import type { AppConfig, GeneralSettings, Price, Project } from './schemas';
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
  /** Any change to a project's issues, labels, comments or attachments (including the renderer's own). */
  'board:changed': { projectSlug: string; issueId?: number };
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

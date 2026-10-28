// The one IPC contract. Main registers a handler per channel, preload exposes one function per
// channel, and window.api's type is derived from this file, so the three cannot drift apart.
import type { AppConfig, GeneralSettings, Price, Project } from './schemas';
import type { AppInfo, ConfigState, PreflightResult, RepoInfo } from './types';

export interface IpcContract {
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
}

// Runtime list of channels for preload. `satisfies` makes the compiler reject a missing or extra name.
const channelMap = {
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
}

/** Errors from main arrive as Error with this prefix stripped to a clean message. */
export const IPC_ERROR_PREFIX = 'YANTRA:';

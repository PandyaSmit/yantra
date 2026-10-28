import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, type Api, type IpcEvents } from '@shared/ipc';

const invoke = Object.fromEntries(
  CHANNELS.map((channel) => [channel, (req?: unknown) => ipcRenderer.invoke(channel, req)]),
) as Api['invoke'];

const api: Api = {
  invoke,
  on(event, cb) {
    const listener = (_e: Electron.IpcRendererEvent, payload: IpcEvents[typeof event]) => cb(payload);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
};

contextBridge.exposeInMainWorld('api', api);

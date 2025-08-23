import { contextBridge, ipcRenderer } from 'electron';

console.log('[preload] loaded (IPC-only)');

contextBridge.exposeInMainWorld('api', {
  onHotkey: (callback: () => void) => {
    const channel = 'hotkey';
    const listener = () => callback();
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  captureScreen: async () => {
    const res = await ipcRenderer.invoke('capture');
    if (res?.ok && res.dataUrl) return res.dataUrl as string;
    throw new Error(res?.error || 'Capture failed');
  },
});

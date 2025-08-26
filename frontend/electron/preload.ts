import { contextBridge, ipcRenderer } from 'electron';

console.log('[preload] loaded (IPC-only)');

contextBridge.exposeInMainWorld('api', {
  onHotkey: (callback: () => void) => {
    const channel = 'hotkey';
    const listener = () => callback();
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onSelectHotkey: (callback: () => void) => {
    const channel = 'hotkey-select';
    const listener = () => callback();
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  captureScreen: async () => {
    const res = await ipcRenderer.invoke('capture');
    if (res?.ok && res.dataUrl) return res.dataUrl as string;
    throw new Error(res?.error || 'Capture failed');
  },
  captureRegion: async () => {
    const res = await ipcRenderer.invoke('captureRegion');
    if (res?.ok && res.dataUrl) return res.dataUrl as string;
    throw new Error(res?.error || 'Region capture failed');
  },
  sanitizeDataUrl: async (dataUrl: string) => {
    const res = await ipcRenderer.invoke('sanitizeDataUrl', dataUrl);
    if (res?.ok && res.dataUrl) return res.dataUrl as string;
    throw new Error(res?.error || 'Sanitize failed');
  },
  copyImage: async (dataUrl: string) => {
    const res = await ipcRenderer.invoke('copyImage', dataUrl);
    if (!res?.ok) throw new Error(res?.error || 'Failed to copy image to clipboard');
  },
  saveImage: async (dataUrl: string): Promise<string | null> => {
    const res = await ipcRenderer.invoke('saveImage', dataUrl);
    if (res?.ok && res.path) return res.path as string;
    if (res?.canceled) return null;
    throw new Error(res?.error || 'Failed to save image');
  },
  saveImageZip: async (dataUrl: string): Promise<string | null> => {
    const res = await ipcRenderer.invoke('saveImageZip', dataUrl);
    if (res?.ok && res.path) return res.path as string;
    if (res?.canceled) return null;
    throw new Error(res?.error || 'Failed to save ZIP');
  },
  displayed: (meta?: any) => {
    ipcRenderer.send('displayed', meta);
  },
  getHotkeySettings: async () => {
    return await ipcRenderer.invoke('getHotkeySettings');
  },
  setHotkeySettings: async (settings: any) => {
    const res = await ipcRenderer.invoke('setHotkeySettings', settings);
    if (!res?.ok) throw new Error(res?.error || 'Failed to update settings');
  },
});

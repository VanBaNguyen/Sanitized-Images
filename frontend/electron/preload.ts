import { contextBridge, ipcRenderer, clipboard, nativeImage } from 'electron';

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
  copyImage: async (dataUrl: string) => {
    try {
      const img = nativeImage.createFromDataURL(dataUrl);
      clipboard.writeImage(img);
    } catch (e: any) {
      throw new Error(e?.message || 'Failed to copy image to clipboard');
    }
  },
});

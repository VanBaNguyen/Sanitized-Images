import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron';
import * as path from 'path';
import screenshot from 'screenshot-desktop';
import { execFile } from 'child_process';
import { tmpdir } from 'os';
import { mkdtemp, readFile, unlink } from 'fs/promises';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#0b1220',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
    },
    show: false,
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/renderer/index.html'));
  }

  mainWindow.on('ready-to-show', () => mainWindow?.show());

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerShortcuts() {
  // Cmd/Ctrl + 4
  const ok1 = globalShortcut.register('CommandOrControl+4', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('hotkey');
    }
  });

  // Also allow Control+4 explicitly (on mac, CommandOrControl maps to Command)
  const ok2 = globalShortcut.register('Control+4', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('hotkey');
    }
  });

  if (!ok1) console.warn('Failed to register CommandOrControl+4');
  if (!ok2) console.warn('Failed to register Control+4');

  // Cmd/Ctrl + 3 (region selection)
  const ok3 = globalShortcut.register('CommandOrControl+3', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('hotkey-select');
    }
  });
  const ok4 = globalShortcut.register('Control+3', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('hotkey-select');
    }
  });

  if (!ok3) console.warn('Failed to register CommandOrControl+3');
  if (!ok4) console.warn('Failed to register Control+3');
}

function registerIpc() {
  ipcMain.handle('capture', async () => {
    try {
      const img = await screenshot({ format: 'png' });
      const dataUrl = `data:image/png;base64,${img.toString('base64')}`;
      return { ok: true, dataUrl };
    } catch (err: any) {
      console.error('screenshot failed', err);
      return { ok: false, error: err?.message || 'screenshot failed' };
    }
  });

  ipcMain.handle('captureRegion', async () => {
    if (process.platform !== 'darwin') {
      return { ok: false, error: 'Region capture not implemented on this platform yet' };
    }
    try {
      const dir = await mkdtemp(path.join(tmpdir(), 'pshot-'));
      const file = path.join(dir, 'region.png');
      const args = ['-i', '-r', '-x', '-t', 'png', file];

      await new Promise<void>((resolve, reject) => {
        const child = execFile('screencapture', args, (err) => {
          if (err) return reject(err);
          resolve();
        });
        // In case process cannot spawn
        child.on('error', (e) => reject(e));
      });

      const buf = await readFile(file);
      // Best effort clean-up
      await unlink(file).catch(() => {});
      const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
      return { ok: true, dataUrl };
    } catch (err: any) {
      // User may cancel selection -> screencapture returns non-zero; surface a friendly message
      const msg = err?.message || String(err);
      if (/canceled|cancelled|65|255/i.test(msg)) {
        return { ok: false, error: 'Selection canceled' };
      }
      console.error('region capture failed', err);
      return { ok: false, error: msg };
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  registerShortcuts();
  registerIpc();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // On macOS, it's common for applications to stay open until the user quits explicitly
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

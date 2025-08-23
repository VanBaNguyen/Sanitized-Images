import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron';
import * as path from 'path';
import screenshot from 'screenshot-desktop';

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

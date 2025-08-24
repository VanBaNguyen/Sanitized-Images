import { app, BrowserWindow, globalShortcut, ipcMain, clipboard, nativeImage } from 'electron';
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
  // IPC handlers are registered in registerIpc()
}

function registerShortcuts() {
  // Cmd/Ctrl + 4 (region selection)
  const ok1 = globalShortcut.register('CommandOrControl+4', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('hotkey-select');
    }
  });

  // Also allow Control+4 explicitly (on mac, CommandOrControl maps to Command)
  const ok2 = globalShortcut.register('Control+4', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('hotkey-select');
    }
  });

  if (!ok1) console.warn('Failed to register CommandOrControl+4');
  if (!ok2) console.warn('Failed to register Control+4');

  // Cmd/Ctrl + 3 (full screen)
  const ok3 = globalShortcut.register('CommandOrControl+3', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('hotkey');
    }
  });
  const ok4 = globalShortcut.register('Control+3', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('hotkey');
    }
  });

  if (!ok3) console.warn('Failed to register CommandOrControl+3');
  if (!ok4) console.warn('Failed to register Control+3');
}

function registerIpc() {
  ipcMain.handle('capture', async () => {
    const t0 = Date.now();
    console.log('[main] capture: start');
    try {
      const img = await screenshot({ format: 'png' });
      const dataUrl = `data:image/png;base64,${img.toString('base64')}`;
      console.log('[main] capture: success', { bytes: img.length, dt_ms: Date.now() - t0 });
      return { ok: true, dataUrl };
    } catch (err: any) {
      console.error('[main] capture: failed', err);
      return { ok: false, error: err?.message || 'screenshot failed' };
    }
  });

  ipcMain.handle('captureRegion', async () => {
    if (process.platform !== 'darwin') {
      return { ok: false, error: 'Region capture not implemented on this platform yet' };
    }
    try {
      const t0 = Date.now();
      console.log('[main] captureRegion: start');
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
      console.log('[main] captureRegion: success', { bytes: buf.length, dt_ms: Date.now() - t0 });
      return { ok: true, dataUrl };
    } catch (err: any) {
      // User may cancel selection -> screencapture returns non-zero; surface a friendly message
      const msg = err?.message || String(err);
      if (/canceled|cancelled|65|255/i.test(msg)) {
        console.log('[main] captureRegion: canceled by user');
        return { ok: false, error: 'Selection canceled' };
      }
      console.error('[main] captureRegion: failed', err);
      return { ok: false, error: msg };
    }
  });

  ipcMain.handle('sanitizeDataUrl', async (_evt, dataUrl: string) => {
    try {
      const t0 = Date.now();
      console.log('[main] sanitize: start', { input_len: dataUrl?.length ?? 0 });
      const scriptPath = path.resolve(__dirname, '../../backend/image_sanitizer.py');
      const args = [scriptPath, '--output-format', 'PNG', '--mode', 'data-url'];
      const sanitized: string = await new Promise((resolve, reject) => {
        const child = execFile('python3', args, { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            const msg = stderr?.toString() || err.message;
            return reject(new Error(msg));
          }
          resolve(stdout?.toString() ?? '');
        });
        child.on('error', (e) => reject(e));
        // feed data URL via stdin
        child.stdin?.write(dataUrl);
        child.stdin?.end();
      });
      if (!sanitized) return { ok: false, error: 'Sanitizer returned empty output' };
      // Basic validation
      if (!sanitized.startsWith('data:image/')) return { ok: false, error: 'Invalid sanitizer output' };
      console.log('[main] sanitize: success', { output_len: sanitized.length, dt_ms: Date.now() - t0 });
      return { ok: true, dataUrl: sanitized };
    } catch (err: any) {
      console.error('[main] sanitize: failed', err);
      return { ok: false, error: err?.message || 'sanitize failed' };
    }
  });

  // Copy to clipboard (logged in main so it shows in terminal)
  ipcMain.handle('copyImage', async (_evt, dataUrl: string) => {
    try {
      const img = nativeImage.createFromDataURL(dataUrl);
      const { width, height } = img.getSize();
      clipboard.writeImage(img);
      console.log('[main] clipboard: wrote image', { width, height });
      return { ok: true };
    } catch (err: any) {
      console.error('[main] clipboard: failed', err);
      return { ok: false, error: err?.message || 'Failed to copy image to clipboard' };
    }
  });

  // Renderer display notification
  ipcMain.on('displayed', (_evt, meta?: any) => {
    try {
      console.log('[main] display: showing image', meta || {});
    } catch {
      console.log('[main] display: shown');
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

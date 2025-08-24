import { app, BrowserWindow, globalShortcut, ipcMain, clipboard, nativeImage, dialog } from 'electron';
import * as path from 'path';
import screenshot from 'screenshot-desktop';
import { execFile } from 'child_process';
import { tmpdir } from 'os';
import { mkdtemp, readFile, unlink, writeFile, utimes, chmod } from 'fs/promises';
import { createWriteStream } from 'fs';
import * as yazl from 'yazl';
import { randomBytes } from 'crypto';

let mainWindow: BrowserWindow | null = null;

async function sanitizeInMain(dataUrl: string): Promise<string> {
  const scriptPath = path.resolve(__dirname, '../../backend/image_sanitizer.py');
  const args = [scriptPath, '--output-format', 'PNG', '--mode', 'data-url'];
  const out: string = await new Promise((resolve, reject) => {
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
  if (!out) throw new Error('Sanitizer returned empty output');
  if (!out.startsWith('data:image/')) throw new Error('Invalid sanitizer output');
  return out;
}

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
      // Ensure sanitized before copying; if it fails, abort
      const sanitized = await sanitizeInMain(dataUrl);
      const img = nativeImage.createFromDataURL(sanitized);
      const { width, height } = img.getSize();
      clipboard.writeImage(img);
      console.log('[main] clipboard: wrote image', { width, height, sanitized: true });
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

  // Save image to disk
  ipcMain.handle('saveImage', async (_evt, dataUrl: string) => {
    try {
      console.log('[main] save: start');
      if (!dataUrl?.startsWith('data:image/')) {
        return { ok: false, error: 'Invalid image data' };
      }
      // Sanitize first to guarantee clean bytes and determine final mime; if it fails, abort
      const sanitized = await sanitizeInMain(dataUrl);
      const m = /^data:(?<mime>[^;]+);base64,(?<data>.+)$/.exec(sanitized);
      if (!m || !m.groups) return { ok: false, error: 'Malformed data URL' };
      const mime = (m.groups.mime as string).toLowerCase();
      const b64 = m.groups.data as string;
      const buf = Buffer.from(b64, 'base64');
      const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : (mime.includes('png') ? 'png' : 'png');
      const rand = randomBytes(4).toString('hex');
      const defaultName = `img_${rand}.${ext}`;
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Save screenshot',
        defaultPath: defaultName,
        filters: [
          { name: 'PNG', extensions: ['png'] },
          { name: 'JPEG', extensions: ['jpg', 'jpeg'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (canceled || !filePath) {
        console.log('[main] save: canceled');
        return { ok: false, canceled: true };
      }
      await writeFile(filePath, buf);
      // Normalize file metadata (times/permissions) similar to backend behavior
      try {
        const epoch = new Date('2000-01-01T00:00:00Z');
        await utimes(filePath, epoch, epoch);
      } catch {}
      try {
        await chmod(filePath, 0o644);
      } catch {}
      console.log('[main] save: success', { path: filePath, bytes: buf.length, randomized: defaultName });
      return { ok: true, path: filePath };
    } catch (err: any) {
      console.error('[main] save: failed', err);
      return { ok: false, error: err?.message || 'Failed to save image' };
    }
  });

  // Save image as ZIP to disk (with sanitized content and fixed timestamps)
  ipcMain.handle('saveImageZip', async (_evt, dataUrl: string) => {
    try {
      console.log('[main] saveZip: start');
      if (!dataUrl?.startsWith('data:image/')) {
        return { ok: false, error: 'Invalid image data' };
      }
      // Sanitize first to guarantee clean bytes; if it fails, abort
      const sanitized = await sanitizeInMain(dataUrl);
      const m = /^data:(?<mime>[^;]+);base64,(?<data>.+)$/.exec(sanitized);
      if (!m || !m.groups) return { ok: false, error: 'Malformed data URL' };
      const mime = (m.groups.mime as string).toLowerCase();
      const b64 = m.groups.data as string;
      const buf = Buffer.from(b64, 'base64');
      const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : (mime.includes('png') ? 'png' : 'png');
      const rand = randomBytes(4).toString('hex');
      const innerName = `img_${rand}.${ext}`;
      const defaultZip = `img_${rand}.zip`;

      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Save screenshot as ZIP',
        defaultPath: defaultZip,
        filters: [
          { name: 'ZIP', extensions: ['zip'] },
        ],
      });
      if (canceled || !filePath) {
        console.log('[main] saveZip: canceled');
        return { ok: false, canceled: true };
      }

      // Create ZIP and stream to disk
      await new Promise<void>((resolve, reject) => {
        const zip = new yazl.ZipFile();
        const ws = createWriteStream(filePath);
        ws.on('close', () => resolve());
        ws.on('error', (e) => reject(e));
        zip.outputStream.on('error', (e) => reject(e));
        zip.outputStream.pipe(ws);
        const epoch = new Date('2000-01-01T00:00:00Z');
        zip.addBuffer(buf, innerName, { mtime: epoch });
        zip.end();
      });

      // Normalize outer ZIP file times/permissions
      try {
        const epoch = new Date('2000-01-01T00:00:00Z');
        await utimes(filePath, epoch, epoch);
      } catch {}
      try {
        await chmod(filePath, 0o644);
      } catch {}
      console.log('[main] saveZip: success', { path: filePath, inner: innerName, bytes: buf.length });
      return { ok: true, path: filePath };
    } catch (err: any) {
      console.error('[main] saveZip: failed', err);
      return { ok: false, error: err?.message || 'Failed to save ZIP' };
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

# Electron Screenshot Hotkey

Electron + React + TypeScript + TailwindCSS app that captures a screenshot when you press Cmd/Ctrl + 4 and shows it in the window.

## Dev Setup

1. Install dependencies:
   
   ```bash
   npm install
   ```

2. Start in development:
   
   ```bash
   npm run dev
   ```

   This runs Vite (renderer), TypeScript in watch mode for Electron (main/preload), and launches Electron. The window loads the Vite dev server.

## Usage

- Press Cmd or Ctrl + 4 to trigger a capture. The app window will focus and show the latest screenshot.
- You can also click "Capture now" in the UI.
- On macOS, the first capture will prompt for Screen Recording permission in System Settings → Privacy & Security → Screen Recording. After granting, you may need to restart the app.

## Build

```bash
npm run build
```

This builds the renderer into `dist/renderer` and the main/preload into `dist-electron`. Packaging into a distributable installer is not included here; if you need it, we can add electron-builder or Electron Forge.

# Private Screenshots & Image 

TLDR: Tired of how screenshots work on MacOS OR hate metadata in images? Use this app to capture screenshots and sanitize them.

Privacy-first screenshot and image sanitizer. Capture via hotkeys or upload, then copy or save sanitized images.

Metadata is a privacy issue. It can hold a lot of information about the image, such as the time it was taken, the location it was taken, and even the device it was taken on. Let's change that.

## Features
- Full screen: Cmd/Ctrl+3. Region select: Cmd/Ctrl+4 (macOS only).
- Upload an image; sanitized via `backend/image_sanitizer.py`.
- Copy to clipboard, Save file, or Save as ZIP.

## Requirements
- Node 18+, Python 3.
- macOS for region selection.

## Dev quick start
```bash
cd frontend
npm install
npm run dev
```

Open the app and use the toolbar or hotkeys. On macOS, grant Screen Recording permission on first use.

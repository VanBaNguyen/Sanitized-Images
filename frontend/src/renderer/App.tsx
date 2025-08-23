import { useEffect, useState } from 'react';

function App() {
  const [img, setImg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  const doCapture = async () => {
    setError(null);
    try {
      const dataUrl = await window.api.captureScreen();
      setImg(dataUrl);
      // Auto-copy
      try {
        await window.api.copyImage(dataUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch (e) {
        // Non-fatal: keep image shown
        console.warn('Clipboard copy failed', e);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Failed to capture screen');
    }
  };

  const doCaptureRegion = async () => {
    setError(null);
    try {
      const dataUrl = await window.api.captureRegion();
      setImg(dataUrl);
      // Auto-copy
      try {
        await window.api.copyImage(dataUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch (e) {
        console.warn('Clipboard copy failed', e);
      }
    } catch (e: any) {
      const msg = e?.message ?? 'Failed to capture region';
      // If user canceled the selection, do not treat as an error
      if (/canceled|cancelled/i.test(String(msg))) return;
      setError(msg);
    }
  };

  const copyCurrent = async () => {
    if (!img) return;
    try {
      await window.api.copyImage(img);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to copy image');
    }
  };

  useEffect(() => {
    const off = window.api.onHotkey(() => {
      void doCapture();
    });
    return () => {
      off?.();
    };
  }, []);

  useEffect(() => {
    const off = window.api.onSelectHotkey(() => {
      void doCaptureRegion();
    });
    return () => {
      off?.();
    };
  }, []);

  return (
    <div className="min-h-full w-full p-6 flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Screenshot Hotkeys</h1>
        <div className="text-sm text-slate-400">
          <span className="mr-3">Full screen: <kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700">Cmd</kbd>/<kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700">Ctrl</kbd> + <kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700">3</kbd></span>
          <span>Region: <kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700">Cmd</kbd>/<kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700">Ctrl</kbd> + <kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700">4</kbd></span>
        </div>
      </header>

      <div className="flex gap-2">
        <button
          onClick={doCapture}
          className="px-3 py-2 rounded bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 transition text-white text-sm"
        >
          Capture now
        </button>
        <button
          onClick={doCaptureRegion}
          className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 transition text-white text-sm"
        >
          Capture region
        </button>
        <button
          onClick={copyCurrent}
          disabled={!img}
          className={`px-3 py-2 rounded text-white text-sm transition ${img ? 'bg-slate-700 hover:bg-slate-600 active:bg-slate-800' : 'bg-slate-800 opacity-50 cursor-not-allowed'}`}
        >
          Copy
        </button>
        {copied && (
          <span className="text-emerald-400 text-sm">Copied</span>
        )}
        <span className="text-slate-400 text-sm">First time on macOS, you'll need to grant Screen Recording permission.</span>
      </div>

      {error && (
        <div className="text-red-400 text-sm">{error}</div>
      )}

      <div className="flex-1 overflow-auto rounded border border-slate-800 bg-slate-950 p-2">
        {img ? (
          <img
            src={img}
            alt="Latest screenshot"
            className="max-w-full h-auto block mx-auto"
          />
        ) : (
          <div className="h-full w-full grid place-items-center text-slate-500">
            No screenshot yet. Press Cmd/Ctrl + 3 (full) or Cmd/Ctrl + 4 (region), or use the buttons above.
          </div>
        )}
      </div>
    </div>
  );
}

export default App;

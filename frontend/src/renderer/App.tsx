import { useEffect, useRef, useState } from 'react';

function App() {
  const [img, setImg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [savingZip, setSavingZip] = useState<boolean>(false);
  const [saved, setSaved] = useState<boolean>(false);
  const [uploading, setUploading] = useState<boolean>(false);
  const [settings, setSettings] = useState<HotkeySettings>({
    region: { modifiers: { shift: false, alt: false, command: false } },
    full: { modifiers: { shift: false, alt: false, command: false } },
  });
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const doCapture = async () => {
    setError(null);
    try {
      const dataUrl = await window.api.captureScreen();
      let sanitized = dataUrl;
      try {
        sanitized = await window.api.sanitizeDataUrl(dataUrl);
      } catch (e: any) {
        console.warn('Sanitize failed, falling back to original', e);
        setError(e?.message ?? 'Sanitize failed; using original image');
      }
      setImg(sanitized);
      // Auto-copy
      try {
        await window.api.copyImage(sanitized);
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
      let sanitized = dataUrl;
      try {
        sanitized = await window.api.sanitizeDataUrl(dataUrl);
      } catch (e: any) {
        console.warn('Sanitize failed, falling back to original', e);
        setError(e?.message ?? 'Sanitize failed; using original image');
      }
      setImg(sanitized);
      // Auto-copy
      try {
        await window.api.copyImage(sanitized);
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

  const saveCurrent = async () => {
    if (!img || saving) return;
    setError(null);
    setSaving(true);
    try {
      const path = await window.api.saveImage(img);
      if (path) {
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save image');
    } finally {
      setSaving(false);
    }
  };

  const saveZipCurrent = async () => {
    if (!img || savingZip) return;
    setError(null);
    setSavingZip(true);
    try {
      const path = await window.api.saveImageZip(img);
      if (path) {
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save ZIP');
    } finally {
      setSavingZip(false);
    }
  };

  const handleUploadClick = () => {
    setError(null);
    // Reset the input so selecting the same file again still triggers onChange
    if (fileInputRef.current) fileInputRef.current.value = '';
    fileInputRef.current?.click();
  };

  const handleFileSelected: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });
      let sanitized = dataUrl;
      try {
        sanitized = await window.api.sanitizeDataUrl(dataUrl);
      } catch (e: any) {
        console.warn('Sanitize failed, falling back to original', e);
        setError(e?.message ?? 'Sanitize failed; using original image');
      }
      setImg(sanitized);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load image');
    } finally {
      setUploading(false);
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

  // Load settings on mount
  useEffect(() => {
    (async () => {
      try {
        const s = await window.api.getHotkeySettings();
        setSettings(s);
      } catch (e) {
        console.warn('Failed to load hotkey settings', e);
      }
    })();
  }, []);

  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);
  const labelForMods = (mods: HotkeyModifiers, baseKey: string) => {
    const keys: string[] = ['Ctrl'];
    if (isMac && mods.command) keys.push('Cmd');
    if (mods.shift) keys.push('Shift');
    if (mods.alt) keys.push(isMac ? 'Option' : 'Alt');
    keys.push(baseKey);
    return keys.map(k => (
      `<kbd class=\"px-1 py-0.5 rounded bg-slate-800 border border-slate-700\">${k}</kbd>`
    )).join(' + ');
  };

  const updateModifier = (target: 'full' | 'region', key: keyof HotkeyModifiers, val: boolean) => {
    const next: HotkeySettings = {
      full: { modifiers: { ...settings.full.modifiers, ...(target === 'full' ? { [key]: val } : {}) } as HotkeyModifiers },
      region: { modifiers: { ...settings.region.modifiers, ...(target === 'region' ? { [key]: val } : {}) } as HotkeyModifiers },
    };
    setSettings(next);
    // Persist and re-register shortcuts
    void window.api.setHotkeySettings(next).catch((e) => {
      console.warn('Failed to save hotkey settings', e);
    });
  };

  return (
    <div className="min-h-full w-full p-6 flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Screenshot Hotkeys</h1>
        <div className="flex items-center gap-4">
          <div className="text-sm text-slate-400">
            <span className="mr-3">Full screen: <span dangerouslySetInnerHTML={{ __html: labelForMods(settings.full.modifiers, '3') }} /></span>
            <span>Region: <span dangerouslySetInnerHTML={{ __html: labelForMods(settings.region.modifiers, '4') }} /></span>
          </div>
          <button
            onClick={() => setShowSettings(v => !v)}
            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs"
          >
            {showSettings ? 'Close Settings' : 'Settings'}
          </button>
        </div>
      </header>

      {showSettings && (
        <div className="rounded border border-slate-800 bg-slate-950 p-4 text-sm text-slate-200">
          <div className="font-semibold mb-2">Configure additional modifiers (always with Ctrl)</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="font-medium">Full screen (key 3)</div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={settings.full.modifiers.shift} onChange={e => updateModifier('full', 'shift', e.target.checked)} />
                Shift
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={settings.full.modifiers.alt} onChange={e => updateModifier('full', 'alt', e.target.checked)} />
                {isMac ? 'Option' : 'Alt'}
              </label>
              <label className={`flex items-center gap-2 ${!isMac ? 'opacity-50' : ''}`}> 
                <input type="checkbox" disabled={!isMac} checked={settings.full.modifiers.command} onChange={e => updateModifier('full', 'command', e.target.checked)} />
                Command (macOS)
              </label>
            </div>
            <div className="space-y-2">
              <div className="font-medium">Region (key 4)</div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={settings.region.modifiers.shift} onChange={e => updateModifier('region', 'shift', e.target.checked)} />
                Shift
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={settings.region.modifiers.alt} onChange={e => updateModifier('region', 'alt', e.target.checked)} />
                {isMac ? 'Option' : 'Alt'}
              </label>
              <label className={`flex items-center gap-2 ${!isMac ? 'opacity-50' : ''}`}> 
                <input type="checkbox" disabled={!isMac} checked={settings.region.modifiers.command} onChange={e => updateModifier('region', 'command', e.target.checked)} />
                Command (macOS)
              </label>
            </div>
          </div>
          <div className="mt-3 text-slate-400">Changes apply immediately.</div>
        </div>
      )}

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
          onClick={handleUploadClick}
          className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 active:bg-blue-700 transition text-white text-sm"
        >
          {uploading ? 'Uploading…' : 'Upload image'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/webp"
          className="hidden"
          onChange={handleFileSelected}
        />
        <button
          onClick={copyCurrent}
          disabled={!img}
          className={`px-3 py-2 rounded text-white text-sm transition ${img ? 'bg-slate-700 hover:bg-slate-600 active:bg-slate-800' : 'bg-slate-800 opacity-50 cursor-not-allowed'}`}
        >
          Copy
        </button>
        <button
          onClick={saveCurrent}
          disabled={!img || saving}
          className={`px-3 py-2 rounded text-white text-sm transition ${img && !saving ? 'bg-slate-700 hover:bg-slate-600 active:bg-slate-800' : 'bg-slate-800 opacity-50 cursor-not-allowed'}`}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={saveZipCurrent}
          disabled={!img || savingZip}
          className={`px-3 py-2 rounded text-white text-sm transition ${img && !savingZip ? 'bg-slate-700 hover:bg-slate-600 active:bg-slate-800' : 'bg-slate-800 opacity-50 cursor-not-allowed'}`}
        >
          {savingZip ? 'Saving ZIP…' : 'Save ZIP'}
        </button>
        {copied && (
          <span className="text-emerald-400 text-sm">Copied</span>
        )}
        {saved && (
          <span className="text-emerald-400 text-sm">Saved</span>
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
            onLoad={(e) => {
              const t = e.currentTarget;
              window.api.displayed?.({ width: t.naturalWidth, height: t.naturalHeight });
            }}
          />
        ) : (
          <div className="h-full w-full grid place-items-center text-slate-500">
            <div className="text-center">
              <div>No screenshot yet.</div>
              <div className="mt-1">Press <span dangerouslySetInnerHTML={{ __html: labelForMods(settings.full.modifiers, '3') }} /> (full)</div>
              <div>or <span dangerouslySetInnerHTML={{ __html: labelForMods(settings.region.modifiers, '4') }} /> (region)</div>
              <div className="mt-1">Or use the buttons above.</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;

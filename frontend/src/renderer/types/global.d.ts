export {};

declare global {
  type HotkeyModifiers = {
    shift: boolean;
    alt: boolean;
    command: boolean;
  };

  type HotkeySettings = {
    region: { modifiers: HotkeyModifiers };
    full: { modifiers: HotkeyModifiers };
    toggle: { accelerator: string };
  };

  interface Window {
    api: {
      onHotkey: (cb: () => void) => () => void;
      onSelectHotkey: (cb: () => void) => () => void;
      captureScreen: () => Promise<string>;
      captureRegion: () => Promise<string>;
      sanitizeDataUrl: (dataUrl: string) => Promise<string>;
      copyImage: (dataUrl: string) => Promise<void>;
      saveImage: (dataUrl: string) => Promise<string | null>;
      saveImageZip: (dataUrl: string) => Promise<string | null>;
      displayed: (meta?: any) => void;
      getHotkeySettings: () => Promise<HotkeySettings>;
      setHotkeySettings: (s: HotkeySettings) => Promise<boolean>;
      toggleWindow: () => Promise<boolean>;
      getWindowVisibility: () => Promise<boolean>;
      suspendToggleShortcut: () => Promise<void>;
      resumeToggleShortcut: () => Promise<boolean>;
    };
  }
}

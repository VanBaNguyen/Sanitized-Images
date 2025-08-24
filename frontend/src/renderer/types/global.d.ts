export {};

declare global {
  interface Window {
    api: {
      onHotkey: (cb: () => void) => () => void;
      onSelectHotkey: (cb: () => void) => () => void;
      captureScreen: () => Promise<string>;
      captureRegion: () => Promise<string>;
      sanitizeDataUrl: (dataUrl: string) => Promise<string>;
      copyImage: (dataUrl: string) => Promise<void>;
      saveImage: (dataUrl: string) => Promise<string | null>;
      displayed: (meta?: any) => void;
    };
  }
}

export {};

declare global {
  interface Window {
    api: {
      onHotkey: (cb: () => void) => () => void;
      onSelectHotkey: (cb: () => void) => () => void;
      captureScreen: () => Promise<string>;
      captureRegion: () => Promise<string>;
      copyImage: (dataUrl: string) => Promise<void>;
    };
  }
}

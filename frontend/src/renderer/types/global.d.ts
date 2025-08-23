export {};

declare global {
  interface Window {
    api: {
      onHotkey: (cb: () => void) => () => void;
      captureScreen: () => Promise<string>;
    };
  }
}

declare module 'yazl' {
  import { Readable } from 'stream';

  export interface ZipFileOptions {
    forceZip64?: boolean;
  }

  export interface AddOptions {
    mtime?: Date;
    mode?: number;
    compress?: boolean;
    fileSize?: number;
  }

  export class ZipFile {
    constructor(options?: ZipFileOptions);
    outputStream: Readable;
    addBuffer(buffer: Buffer, metadataPath: string, options?: AddOptions): void;
    end(): void;
  }
}

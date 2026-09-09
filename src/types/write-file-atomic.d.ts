declare module 'write-file-atomic' {
  interface WriteFileAtomicOptions {
    encoding?: BufferEncoding;
    fsync?: boolean;
    mode?: number;
    chown?: { uid: number; gid: number };
    tmpfileCreated?: (tmpfile: string) => void | Promise<void>;
  }

  const writeFileAtomic: (filename: string, data: string | NodeJS.ArrayBufferView, options?: WriteFileAtomicOptions) => Promise<void>;
  export = writeFileAtomic;
}

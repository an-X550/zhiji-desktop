import crypto from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import writeFileAtomic from 'write-file-atomic';

export type AtomicReplace = (target: string, content: string, options?: { encoding?: BufferEncoding; fsync?: boolean }) => Promise<void>;
export type AtomicWritePhase = 'validated' | 'published';

export interface AtomicWriteOptions {
  /** 仅用于故障注入测试；生产路径始终使用 write-file-atomic。 */
  replace?: AtomicReplace;
  /** 仅用于子进程故障测试；生产调用不传入此回调。 */
  onPhase?: (phase: AtomicWritePhase) => void | Promise<void>;
}

export async function atomicWriteUtf8(
  target: string,
  content: string,
  validate: (value: string) => void,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const temp = `${target}.${crypto.randomUUID()}.validate.tmp`;
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await writeFile(temp, content, 'utf8');
    const reread = await readFile(temp, 'utf8');
    validate(reread);
    await options.onPhase?.('validated');
    await (options.replace ?? writeFileAtomic)(target, reread, { encoding: 'utf8', fsync: true });
    await options.onPhase?.('published');
  } finally {
    await rm(temp, { force: true });
  }
}

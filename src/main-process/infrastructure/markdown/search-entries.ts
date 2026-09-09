import { readFile, stat } from 'node:fs/promises';
import { appError } from '../../../shared/errors/app-error';

export type SearchFileMetadata = {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
};

export type SearchEntry<T> = {
  key: string;
  metadata: SearchFileMetadata;
  /** 元数据未变化时省略，调用方应复用上一次的解析结果。 */
  value?: T;
};

export async function readSearchFile(target: string): Promise<{ content: string; metadata: SearchFileMetadata }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await getSearchFileMetadata(target);
    const content = await readFile(target, 'utf8');
    const after = await getSearchFileMetadata(target);
    if (sameSearchFileMetadata(before, after)) return { content, metadata: after };
  }
  throw appError({ code: 'FILE_CONFLICT', path: target });
}

export async function getSearchFileMetadata(target: string): Promise<SearchFileMetadata> {
  const file = await stat(target);
  return { size: file.size, mtimeMs: file.mtimeMs, ctimeMs: file.ctimeMs };
}

export function sameSearchFileMetadata(left: SearchFileMetadata, right: SearchFileMetadata): boolean {
  return left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

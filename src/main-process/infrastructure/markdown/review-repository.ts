import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { ReviewSchema, type Review } from '../../../shared/schemas/domain';
import { appError } from '../../../shared/errors/app-error';
import { atomicWriteUtf8 } from './atomic-write';
import { resolveInsideRoot } from './path-policy';
import { getSearchFileMetadata, readSearchFile, sameSearchFileMetadata, type SearchEntry, type SearchFileMetadata } from './search-entries';

function serialize(review: Review) { const { body, ...data } = review; return matter.stringify(body, data); }
function parse(value: string): Review { const { data, content } = matter(value); return ReviewSchema.parse({ ...data, body: content.trim() }); }

export class MarkdownReviewRepository {
  private writeQueue: Promise<unknown> = Promise.resolve();
  constructor(private readonly root: string, private readonly trashItem?: (target: string) => Promise<void>) {}

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(task, task);
    this.writeQueue = next.catch(() => undefined);
    return next;
  }

  private async entries(): Promise<Array<{ review: Review; filePath: string }>> {
    const output: Array<{ review: Review; filePath: string }> = [];
    const root = await resolveInsideRoot(this.root, 'reviews');
    const walk = async (folder: string): Promise<void> => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const target = await resolveInsideRoot(folder, entry.name);
        if (entry.isDirectory()) await walk(target);
        else if (entry.isFile() && entry.name.endsWith('.md')) output.push({ filePath: target, review: parse(await readFile(target, 'utf8')) });
      }
    };
    try { await walk(root); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return output;
  }

  private static compareNewest(left: { review: Review; filePath: string }, right: { review: Review; filePath: string }): number {
    return left.review.createdAt.localeCompare(right.review.createdAt)
      || left.review.id.localeCompare(right.review.id)
      || left.filePath.localeCompare(right.filePath);
  }

  async save(input: Review) {
    return this.enqueue(async () => {
      const review = ReviewSchema.parse(input);
      const target = await resolveInsideRoot(this.root, 'reviews', review.type, review.periodStart.slice(0, 4), `${review.periodStart}-${review.id}.md`);
      await atomicWriteUtf8(target, serialize(review), (value) => parse(value));
      return review;
    });
  }
  async list(): Promise<Review[]> {
    const entries = await this.entries();
    const daily = new Map<string, { review: Review; filePath: string }>();
    const output: Review[] = [];
    for (const entry of entries) {
      if (entry.review.type !== 'daily') { output.push(entry.review); continue; }
      const key = `${entry.review.periodStart}\u0000${entry.review.periodEnd}`;
      const previous = daily.get(key);
      if (!previous || MarkdownReviewRepository.compareNewest(previous, entry) < 0) daily.set(key, entry);
    }
    output.push(...[...daily.values()].map((entry) => entry.review));
    return output.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  /**
   * 写入每日反馈时按日期做 upsert：已有结果沿用 id 与文件位置，
   * 只有成功发布新正文后才尝试把旧重复文件移入回收站。
   */
  async saveDaily(input: Review): Promise<{ review: Review; warning?: string }> {
    return this.enqueue(async () => {
      const incoming = ReviewSchema.parse(input);
      if (incoming.type !== 'daily') throw appError({ code: 'INVALID_INPUT', message: '每日反馈只能写入 daily 记录。' });
      const entries = await this.entries();
      const sameDate = entries.filter((entry) => entry.review.type === 'daily' && entry.review.periodStart === incoming.periodStart && entry.review.periodEnd === incoming.periodEnd);
      const existing = sameDate.slice().sort(MarkdownReviewRepository.compareNewest).at(-1);
      const review: Review = existing
        ? ReviewSchema.parse({ ...incoming, id: existing.review.id })
        : incoming;
      const target = existing?.filePath ?? await resolveInsideRoot(this.root, 'reviews', 'daily', review.periodStart.slice(0, 4), `${review.periodStart}-${review.id}.md`);
      await atomicWriteUtf8(target, serialize(review), (value) => parse(value));

      const stale = sameDate.filter((entry) => entry.filePath !== target);
      const cleanupFailures: string[] = [];
      for (const entry of stale) {
        if (!this.trashItem) { cleanupFailures.push(entry.filePath); continue; }
        try { await this.trashItem(entry.filePath); } catch { cleanupFailures.push(entry.filePath); }
      }
      return cleanupFailures.length
        ? { review, warning: `反馈已保存，但 ${cleanupFailures.length} 份旧重复文件未能移入回收站。` }
        : { review };
    });
  }

  async searchEntries(previous: ReadonlyMap<string, SearchFileMetadata> = new Map()): Promise<SearchEntry<Review>[]> {
    const output: SearchEntry<Review>[] = [];
    const root = await resolveInsideRoot(this.root, 'reviews');
    const walk = async (folder: string): Promise<void> => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const target = await resolveInsideRoot(folder, entry.name);
        if (entry.isDirectory()) await walk(target);
        else if (entry.isFile() && entry.name.endsWith('.md')) {
          const key = path.relative(this.root, target);
          const metadata = await getSearchFileMetadata(target);
          const old = previous.get(key);
          if (old && sameSearchFileMetadata(old, metadata)) output.push({ key, metadata });
          else {
            const stable = await readSearchFile(target);
            output.push({ key, metadata: stable.metadata, value: parse(stable.content) });
          }
        }
      }
    };
    try { await walk(root); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return output;
  }
  async get(id: string): Promise<Review> {
    const result = (await this.list()).find((review) => review.id === id);
    if (!result) throw appError({ code: 'NOT_FOUND', entity: id });
    return result;
  }
  async delete(id: string): Promise<void> {
    return this.enqueue(async () => {
      const match = (await this.entries()).filter((entry) => entry.review.id === id).sort(MarkdownReviewRepository.compareNewest).at(-1);
      if (!match) throw appError({ code: 'NOT_FOUND', entity: id });
      if (!this.trashItem) throw appError({ code: 'UNKNOWN', message: '系统回收站当前不可用。' });
      await this.trashItem(match.filePath);
    });
  }
}

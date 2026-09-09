import { access, readFile, readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { JournalSchema, type Journal } from '../../../shared/schemas/domain';
import { appError } from '../../../shared/errors/app-error';
import { atomicWriteUtf8 } from './atomic-write';
import { resolveInsideRoot } from './path-policy';
import { getSearchFileMetadata, readSearchFile, sameSearchFileMetadata, type SearchEntry, type SearchFileMetadata } from './search-entries';

function serialize(journal: Journal): string {
  const { body, schemaVersion, createdAt, updatedAt, projectIds, ...rest } = journal;
  return matter.stringify(body, {
    schema_version: schemaVersion,
    ...rest,
    created_at: createdAt,
    updated_at: updatedAt,
    project_ids: projectIds,
  });
}

export function parseJournalMarkdown(markdown: string): Journal {
  const parsed = matter(markdown);
  return JournalSchema.parse({
    schemaVersion: parsed.data.schema_version,
    id: parsed.data.id,
    date: parsed.data.date,
    createdAt: parsed.data.created_at,
    updatedAt: parsed.data.updated_at,
    projectIds: parsed.data.project_ids ?? [],
    body: parsed.content.trim(),
  });
}

export class MarkdownJournalRepository {
  private writeQueue: Promise<unknown> = Promise.resolve();
  constructor(private readonly root: string, private readonly trashItem?: (target: string) => Promise<void>) {}

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(task, task);
    this.writeQueue = next.catch(() => undefined);
    return next;
  }

  private async entries(): Promise<Array<{ journal: Journal; filePath: string }>> {
    const entries: Array<{ journal: Journal; filePath: string }> = [];
    const ids = new Set<string>();
    const journalsRoot = await resolveInsideRoot(this.root, 'journals');
    try {
      for (const year of await readdir(journalsRoot)) {
        const yearRoot = await resolveInsideRoot(journalsRoot, year);
        for (const file of await readdir(yearRoot)) {
          if (!file.endsWith('.md')) continue;
          const filePath = await resolveInsideRoot(yearRoot, file);
          const journal = parseJournalMarkdown(await readFile(filePath, 'utf8'));
          if (ids.has(journal.id)) throw appError({ code: 'FILE_CONFLICT', path: filePath });
          ids.add(journal.id);
          entries.push({ journal, filePath });
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return entries;
  }

  async searchEntries(previous: ReadonlyMap<string, SearchFileMetadata> = new Map()): Promise<SearchEntry<Journal>[]> {
    const output: SearchEntry<Journal>[] = [];
    const journalsRoot = await resolveInsideRoot(this.root, 'journals');
    try {
      for (const yearEntry of await readdir(journalsRoot, { withFileTypes: true })) {
        if (!yearEntry.isDirectory()) continue;
        const yearRoot = await resolveInsideRoot(journalsRoot, yearEntry.name);
        for (const fileEntry of await readdir(yearRoot, { withFileTypes: true })) {
          if (!fileEntry.isFile() || !fileEntry.name.endsWith('.md')) continue;
          const filePath = await resolveInsideRoot(yearRoot, fileEntry.name);
          const key = path.relative(this.root, filePath);
          const metadata = await getSearchFileMetadata(filePath);
          const old = previous.get(key);
          if (old && sameSearchFileMetadata(old, metadata)) output.push({ key, metadata });
          else {
            const stable = await readSearchFile(filePath);
            output.push({ key, metadata: stable.metadata, value: parseJournalMarkdown(stable.content) });
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return output;
  }

  async create(input: Journal): Promise<Journal> {
    return this.enqueue(async () => {
      const journal = JournalSchema.parse(input);
      const existing = (await this.entries()).find((entry) => entry.journal.id === journal.id);
      const target = await resolveInsideRoot(this.root, 'journals', journal.date.slice(0, 4), `${journal.date}--${journal.id}.md`);
      if (existing) throw appError({ code: 'FILE_CONFLICT', path: existing.filePath });
      await atomicWriteUtf8(target, serialize(journal), (value) => parseJournalMarkdown(value));
      return journal;
    });
  }

  async update(input: Journal, expectedUpdatedAt: string): Promise<Journal> {
    return this.enqueue(() => this.updateUnlocked(input, expectedUpdatedAt));
  }

  private async updateUnlocked(input: Journal, expectedUpdatedAt: string): Promise<Journal> {
    const journal = JournalSchema.parse(input);
    const existing = (await this.entries()).find((entry) => entry.journal.id === journal.id);
    if (!existing) throw appError({ code: 'NOT_FOUND', entity: journal.id });
    if (existing.journal.updatedAt !== expectedUpdatedAt) {
      throw appError({ code: 'FILE_CONFLICT', path: existing.filePath });
    }
    // 日期是 frontmatter 的业务字段；更新时保持既有文件定位，避免 rename + .moving 的双文件窗口。
    await atomicWriteUtf8(existing.filePath, serialize(journal), (value) => parseJournalMarkdown(value));
    return journal;
  }

  async get(id: string): Promise<Journal> {
    if (!/^journal_[a-z0-9]+$/.test(id)) {
      throw appError({ code: 'INVALID_INPUT', message: '日志 id 不合法。' });
    }
    const match = (await this.entries()).find((entry) => entry.journal.id === id);
    if (match) return match.journal;
    throw appError({ code: 'NOT_FOUND', entity: id });
  }

  async list(): Promise<Journal[]> {
    return (await this.entries()).map((entry) => entry.journal)
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  }

  async delete(id: string): Promise<void> {
    return this.enqueue(async () => {
      const match = (await this.entries()).find((entry) => entry.journal.id === id);
      if (!match) throw appError({ code: 'NOT_FOUND', entity: id });
      if (!this.trashItem) throw appError({ code: 'UNKNOWN', message: '系统回收站当前不可用。' });
      await this.trashItem(match.filePath);
    });
  }
}

export interface JournalResidueRecovery {
  recovered: string[];
  conflicts: string[];
  ambiguous: string[];
  failed: string[];
}

/**
 * 只处理旧日志写入实现留下的、可明确归属的 .bak/.moving；不猜测 mtime，
 * 也不自动晋升 .tmp。歧义材料全部保留，供用户人工处理。
 */
export async function recoverJournalResidues(root: string): Promise<JournalResidueRecovery> {
  const result: JournalResidueRecovery = { recovered: [], conflicts: [], ambiguous: [], failed: [] };
  const journalsRoot = await resolveInsideRoot(root, 'journals');
  const candidates = new Map<string, string[]>();
  const walk = async (folder: string): Promise<void> => {
    let entries;
    try { entries = await readdir(folder, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const target = await resolveInsideRoot(folder, entry.name);
      if (entry.isDirectory()) { await walk(target); continue; }
      if (!entry.isFile()) continue;
      const base = entry.name.endsWith('.moving')
        ? entry.name.slice(0, -'.moving'.length)
        : entry.name.match(/^(.*\.md)\.[a-z0-9-]+\.bak$/i)?.[1];
      if (!base) continue;
      const formal = path.join(folder, base);
      candidates.set(formal, [...(candidates.get(formal) ?? []), target]);
    }
  };
  await walk(journalsRoot);

  for (const [formal, files] of candidates) {
    const relative = path.relative(root, formal);
    try {
      await access(formal);
      result.conflicts.push(relative);
      continue;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { result.failed.push(relative); continue; } }
    if (files.length !== 1) { result.ambiguous.push(relative); continue; }
    try {
      parseJournalMarkdown(await readFile(files[0], 'utf8'));
      await rename(files[0], formal);
      result.recovered.push(relative);
    } catch { result.failed.push(relative); }
  }
  return result;
}

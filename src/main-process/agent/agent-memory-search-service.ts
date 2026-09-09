import MiniSearch from 'minisearch';
import type { Journal, Review, VerifiedPatternSnapshot } from '../../shared/schemas/domain';
import { appError } from '../../shared/errors/app-error';
import type { VerifiedPatternService } from '../application/verified-patterns';
import type { MarkdownJournalRepository } from '../infrastructure/markdown/journal-repository';
import type { MarkdownReviewRepository } from '../infrastructure/markdown/review-repository';
import type { SearchEntry, SearchFileMetadata } from '../infrastructure/markdown/search-entries';

const DEFAULT_LIMIT = 8;
const MAX_EXCERPT = 800;
const MAX_ALTERNATES = 3;
const CJK_RUN = /[\u3400-\u9fff\uf900-\ufaff]+/gu;
const CJK_TERM = /^[\u3400-\u9fff\uf900-\ufaff]+$/u;
const LATIN_OR_NUMBER = /[a-z0-9]+/gi;
const STOP_WORDS = new Set([
  '我', '你', '他', '她', '它', '的', '了', '过', '吗', '呢', '啊', '吧', '把', '被', '跟', '和', '与', '以及',
  '是', '不', '有', '没', '也', '都', '还', '在', '是否', '是不是', '有没有', '能不能', '可以', '会不会',
  '以前', '之前', '最近', '一直', '总是', '经常', '反复', '曾经', '现在', '当时', '当初', '什么', '怎么', '如何',
]);

export type AgentMemorySearchHit = {
  id: string;
  kind: 'journal' | 'review' | 'pattern';
  date: string | null;
  excerpt: string;
};

type MemoryRecord = {
  id: string;
  kind: AgentMemorySearchHit['kind'];
  date: string | null;
  text: string;
  searchable: string;
};

type SearchInput = { query: string; limit?: number; alternates?: string[] };

type RankedHit = {
  record: MemoryRecord;
  score: number;
  terms: string[];
};

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/\s+/g, ' ').trim();
}

function normalizeAlternates(alternates: string[] | undefined): string[] {
  return [...new Set((alternates ?? []).map(normalize).filter(Boolean))].slice(0, MAX_ALTERNATES);
}

function addCjkBigrams(value: string, tokens: string[]): void {
  for (const match of value.matchAll(CJK_RUN)) {
    const chars = Array.from(match[0]);
    for (let index = 0; index < chars.length - 1; index += 1) tokens.push(chars.slice(index, index + 2).join(''));
  }
}

function tokenizeForSearch(value: string): string[] {
  const normalized = normalize(value);
  const tokens: string[] = [];
  const Segmenter = (Intl as typeof Intl & { Segmenter?: new (locale: string, options: { granularity: 'word' }) => { segment(input: string): Iterable<{ segment: string; isWordLike?: boolean }> } }).Segmenter;
  if (Segmenter) {
    const segmenter = new Segmenter('zh-CN', { granularity: 'word' });
    for (const part of segmenter.segment(normalized)) {
      if (part.isWordLike === false) continue;
      const token = part.segment.trim();
      if (token) tokens.push(token);
    }
  } else {
    tokens.push(...(normalized.match(/[a-z0-9]+|[\u3400-\u9fff\uf900-\ufaff]+/gi) ?? []));
  }
  for (const match of normalized.matchAll(LATIN_OR_NUMBER)) tokens.push(match[0]);
  addCjkBigrams(normalized, tokens);

  return [...new Set(tokens.map((token) => token.trim()).filter((token) => {
    if (!token || STOP_WORDS.has(token)) return false;
    if (CJK_TERM.test(token) && Array.from(token).length < 2) return false;
    return true;
  }))];
}

function compact(value: string): string {
  return normalize(value).replace(/[\p{P}\p{S}\s]+/gu, '');
}

function phraseBoost(query: string, searchable: string): number {
  const phrase = compact(query);
  return phrase.length >= 2 && compact(searchable).includes(phrase) ? 0.5 : 0;
}

function excerptAround(text: string, terms: string[]): string {
  const lowerText = text.toLocaleLowerCase('zh-CN');
  const position = terms
    .map((term) => lowerText.indexOf(term.toLocaleLowerCase('zh-CN')))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0] ?? 0;
  const start = Math.max(0, position - 180);
  const end = Math.min(text.length, start + MAX_EXCERPT);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

function buildIndex(records: MemoryRecord[]): MiniSearch {
  const index = new MiniSearch({
    fields: ['searchable'],
    storeFields: ['kind', 'date', 'text'],
    tokenize: tokenizeForSearch,
  });
  index.addAll(records);
  return index;
}

type IncrementalSource<T> = {
  list(): Promise<T[]>;
  searchEntries?: (previous: ReadonlyMap<string, SearchFileMetadata>) => Promise<SearchEntry<T>[]>;
};

type CachedSourceValue<T> = { metadata?: SearchFileMetadata; value: T };

function journalRecord(item: Journal): MemoryRecord {
  return { id: item.id, kind: 'journal', date: item.date, text: item.body, searchable: normalize([item.body, item.date, ...item.projectIds].join('\n')) };
}

function reviewRecord(item: Review): MemoryRecord {
  return { id: item.id, kind: 'review', date: item.periodEnd, text: item.body, searchable: normalize([item.body, item.type, item.periodStart, item.periodEnd, item.projectId ?? ''].join('\n')) };
}

function patternRecords(snapshot: VerifiedPatternSnapshot): MemoryRecord[] {
  return snapshot.patterns.map((item) => ({
    id: item.id,
    kind: 'pattern' as const,
    date: item.createdAt.slice(0, 10),
    text: `${item.statement}\n${item.evidenceSummary}`,
    searchable: normalize([item.statement, item.evidenceSummary, ...item.sourceReviewIds].join('\n')),
  }));
}

function assertUniqueRecordIds(records: MemoryRecord[]): void {
  const sources = new Map<string, MemoryRecord['kind']>();
  for (const record of records) {
    const previous = sources.get(record.id);
    if (previous) {
      throw appError({ code: 'FILE_CONFLICT', path: `memory/${previous}/${record.kind}/${record.id}` });
    }
    sources.set(record.id, record.kind);
  }
}

/**
 * Read-only local lexical recall over the existing authoritative data.
 * The MiniSearch index is incremental and disposable: files are revalidated by
 * cheap metadata on every query, while parsed values and index terms stay in memory.
 * It is never persisted and is discarded on restart/data-root changes.
 */
export class AgentMemorySearchService {
  private readonly journalFiles = new Map<string, CachedSourceValue<Journal>>();
  private readonly reviewFiles = new Map<string, CachedSourceValue<Review>>();
  private readonly sourceRecords = new Map<'journals' | 'reviews' | 'patterns', Map<string, MemoryRecord>>();
  private readonly recordsById = new Map<string, MemoryRecord>();
  private index: MiniSearch | undefined;
  private patternSignature = '';
  private refreshPromise: Promise<void> | undefined;

  constructor(
    private readonly journals: IncrementalSource<Journal> & Pick<MarkdownJournalRepository, 'list'>,
    private readonly reviews: IncrementalSource<Review> & Pick<MarkdownReviewRepository, 'list'>,
    private readonly verifiedPatterns: Pick<VerifiedPatternService, 'list'>,
  ) {}

  /** 应用内写入、恢复或数据根切换后可主动丢弃缓存；下一次查询会重新校验权威材料。 */
  invalidate(): void {
    this.index = undefined;
    this.journalFiles.clear();
    this.reviewFiles.clear();
    this.sourceRecords.clear();
    this.recordsById.clear();
    this.patternSignature = '';
  }

  /** 仅测试和故障恢复使用；不把索引写入备份或用户数据目录。 */
  rebuild(): void { this.invalidate(); }

  async search(input: SearchInput): Promise<{ hits: AgentMemorySearchHit[] }> {
    const query = normalize(input.query);
    const queries = [query, ...normalizeAlternates(input.alternates)];
    const searchableQueries = [...new Set(queries)].filter((value) => tokenizeForSearch(value).length > 0);
    if (!searchableQueries.length) return { hits: [] };

    await this.refreshIndex();
    const index = this.index;
    if (!index) return { hits: [] };
    const rankedById = new Map<string, RankedHit>();

    for (const searchQuery of searchableQueries) {
      for (const result of index.search(searchQuery, { combineWith: 'OR' })) {
        const record = this.recordsById.get(String(result.id));
        if (!record) continue;
        const ranked: RankedHit = { record, score: result.score + phraseBoost(searchQuery, record.searchable), terms: result.terms };
        const previous = rankedById.get(record.id);
        if (!previous || ranked.score > previous.score) rankedById.set(record.id, ranked);
      }
    }

    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), DEFAULT_LIMIT);
    return {
      hits: [...rankedById.values()]
        .sort((left, right) => right.score - left.score || (right.record.date ?? '').localeCompare(left.record.date ?? '') || left.record.id.localeCompare(right.record.id))
        .slice(0, limit)
        .map(({ record, terms }) => ({ id: record.id, kind: record.kind, date: record.date, excerpt: excerptAround(record.text, terms) })),
    };
  }

  private async refreshIndex(): Promise<void> {
    this.refreshPromise ??= this.refreshIndexUnlocked().finally(() => { this.refreshPromise = undefined; });
    return this.refreshPromise;
  }

  private async refreshIndexUnlocked(): Promise<void> {
    const [journals, reviews, patterns] = await Promise.all([
      this.refreshSource(this.journals, this.journalFiles),
      this.refreshSource(this.reviews, this.reviewFiles),
      this.verifiedPatterns.list(),
    ]);
    const journalRecords = journals.map(journalRecord);
    const reviewRecords = reviews.map(reviewRecord);
    const nextPatternRecords = patternRecords(patterns);
    assertUniqueRecordIds([...journalRecords, ...reviewRecords, ...nextPatternRecords]);
    const nextSources = new Map<'journals' | 'reviews' | 'patterns', Map<string, MemoryRecord>>([
      ['journals', new Map(journalRecords.map((item) => [item.id, item]))],
      ['reviews', new Map(reviewRecords.map((item) => [item.id, item]))],
    ]);
    const nextPatternSignature = JSON.stringify(nextPatternRecords);
    if (this.patternSignature !== nextPatternSignature) {
      nextSources.set('patterns', new Map(nextPatternRecords.map((item) => [item.id, item])));
      this.patternSignature = nextPatternSignature;
    } else {
      nextSources.set('patterns', this.sourceRecords.get('patterns') ?? new Map());
    }

    if (!this.index) {
      this.sourceRecords.clear();
      for (const [source, records] of nextSources) this.sourceRecords.set(source, records);
      const records = [...nextSources.values()].flatMap((items) => [...items.values()]);
      this.index = buildIndex(records);
      this.recordsById.clear();
      for (const record of records) this.recordsById.set(record.id, record);
      return;
    }
    for (const source of ['journals', 'reviews', 'patterns'] as const) this.applySource(source, nextSources.get(source) ?? new Map());
  }

  private async refreshSource<T>(source: IncrementalSource<T>, cache: Map<string, CachedSourceValue<T>>): Promise<T[]> {
    if (!source.searchEntries) {
      const values = await source.list();
      cache.clear();
      for (const value of values) cache.set(String((value as { id: string }).id), { value });
      return values;
    }
    const previous = new Map([...cache].flatMap(([key, item]) => item.metadata ? [[key, item.metadata] as const] : []));
    const entries = await source.searchEntries(previous);
    const seen = new Set<string>();
    for (const entry of entries) {
      seen.add(entry.key);
      const old = cache.get(entry.key);
      if (entry.value !== undefined) cache.set(entry.key, { metadata: entry.metadata, value: entry.value });
      else if (old) cache.set(entry.key, { metadata: entry.metadata, value: old.value });
      else throw new Error(`检索缓存缺少变化文件：${entry.key}`);
    }
    for (const key of cache.keys()) if (!seen.has(key)) cache.delete(key);
    return [...cache.values()].map((entry) => entry.value);
  }

  private applySource(source: 'journals' | 'reviews' | 'patterns', next: Map<string, MemoryRecord>): void {
    const previous = this.sourceRecords.get(source) ?? new Map<string, MemoryRecord>();
    for (const id of previous.keys()) if (!next.has(id)) this.removeRecord(id);
    for (const [id, record] of next) {
      const old = previous.get(id);
      if (!old || JSON.stringify(old) !== JSON.stringify(record)) {
        if (old) this.removeRecord(id);
        this.index?.add(record);
        this.recordsById.set(id, record);
      }
    }
    this.sourceRecords.set(source, next);
  }

  private removeRecord(id: string): void {
    this.index?.discard(id);
    this.recordsById.delete(id);
  }
}

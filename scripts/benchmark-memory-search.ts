import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { AgentMemorySearchService } from '../src/main-process/agent/agent-memory-search-service';
import type { Journal } from '../src/shared/schemas/domain';

const REPETITIONS = 5;
const sizes = [100, 1000, 5000];

type ReadCounter = { parsedValues: number; listedValues: number };

function makeJournals(count: number): Journal[] {
  return Array.from({ length: count }, (_, index) => {
    const date = `2026-08-${String((index % 28) + 1).padStart(2, '0')}`;
    return {
      schemaVersion: 1,
      id: `journal_benchmark${index}`,
      date,
      createdAt: `${date}T08:00:00.000Z`,
      updatedAt: `${date}T08:00:00.000Z`,
      projectIds: [],
      body: `第 ${index} 条合成日志：把行动拆分成小步骤后继续验证，记录进展和结果。`,
    };
  });
}

function makePatterns() {
  return { schemaVersion: 1 as const, updatedAt: '2026-08-31T00:00:00.000Z', patterns: [] };
}

function makeColdSources(journals: Journal[], counter: ReadCounter) {
  return {
    journals: { list: async () => { counter.listedValues += journals.length; return journals; } },
    reviews: { list: async () => [] },
    patterns: { list: async () => makePatterns() },
  };
}

function makeIncrementalSources(journals: Journal[], counter: ReadCounter) {
  const entries = journals.map((value, index) => ({
    key: `journals/2026/benchmark${index}.md`,
    metadata: { size: value.body.length, mtimeMs: index, ctimeMs: index },
    value,
  }));
  return {
    journals: {
      list: async () => journals,
      searchEntries: async (previous: ReadonlyMap<string, { size: number; mtimeMs: number; ctimeMs: number }>) => entries.map(({ value, key, metadata }) => {
        if (previous.get(key)?.size === metadata.size && previous.get(key)?.mtimeMs === metadata.mtimeMs && previous.get(key)?.ctimeMs === metadata.ctimeMs) return { key, metadata };
        counter.parsedValues += 1;
        return { key, metadata, value };
      }),
    },
    reviews: { list: async () => [] },
    patterns: { list: async () => makePatterns() },
  };
}

async function runCold(journals: Journal[], counter: ReadCounter): Promise<number> {
  const started = performance.now();
  for (let index = 0; index < REPETITIONS; index += 1) {
    const sources = makeColdSources(journals, counter);
    await new AgentMemorySearchService(sources.journals, sources.reviews, sources.patterns).search({ query: '行动拆分', limit: 3 });
  }
  return performance.now() - started;
}

async function runHot(journals: Journal[], counter: ReadCounter): Promise<{ elapsedMs: number; heapDeltaMb: number; eventLoopMaxMs: number }> {
  const sources = makeIncrementalSources(journals, counter);
  const service = new AgentMemorySearchService(sources.journals, sources.reviews, sources.patterns);
  const monitor = monitorEventLoopDelay({ resolution: 10 });
  const heapBefore = process.memoryUsage().heapUsed;
  monitor.enable();
  const started = performance.now();
  for (let index = 0; index < REPETITIONS; index += 1) {
    await service.search({ query: '行动拆分', limit: 3 });
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const elapsedMs = performance.now() - started;
  monitor.disable();
  return {
    elapsedMs,
    heapDeltaMb: (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024,
    eventLoopMaxMs: Number.isFinite(monitor.max) ? monitor.max / 1_000_000 : 0,
  };
}

for (const size of sizes) {
  const journals = makeJournals(size);
  const coldCounter = { parsedValues: 0, listedValues: 0 };
  const hotCounter = { parsedValues: 0, listedValues: 0 };
  const coldMs = await runCold(journals, coldCounter);
  const hot = await runHot(journals, hotCounter);
  console.log(JSON.stringify({ size, repetitions: REPETITIONS, coldMs: Number(coldMs.toFixed(2)), hotMs: Number(hot.elapsedMs.toFixed(2)), coldParsedValues: coldCounter.listedValues, hotParsedValues: hotCounter.parsedValues, hotHeapDeltaMb: Number(hot.heapDeltaMb.toFixed(2)), hotEventLoopMaxMs: Number(hot.eventLoopMaxMs.toFixed(2)) }));
}

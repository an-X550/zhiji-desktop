import { writeFile } from 'node:fs/promises';
import { atomicWriteUtf8, type AtomicWritePhase } from '../../src/main-process/infrastructure/markdown/atomic-write';

const [target, marker, exitPhase] = process.argv.slice(2) as [string, string, AtomicWritePhase];

await atomicWriteUtf8(target, 'new', () => undefined, {
  onPhase: async (phase) => {
    if (phase !== exitPhase) return;
    await writeFile(marker, phase, 'utf8');
    process.exit(17);
  },
});

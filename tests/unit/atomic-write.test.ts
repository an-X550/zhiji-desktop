import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { atomicWriteUtf8 } from '../../src/main-process/infrastructure/markdown/atomic-write';

describe('atomicWriteUtf8', () => {
  async function runCrashChild(target: string, marker: string, phase: 'validated' | 'published'): Promise<number | null> {
    const runner = path.join(process.cwd(), 'node_modules', 'vite-node', 'vite-node.mjs');
    const fixture = path.join(process.cwd(), 'tests', 'fixtures', 'atomic-write-crash.ts');
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [runner, fixture, target, marker, phase], { cwd: process.cwd(), stdio: 'ignore' });
      child.once('error', reject);
      child.once('close', resolve);
    });
  }

  it('validates before publishing and keeps the old file on validation failure', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'zhiji-atomic-'));
    try {
      const target = path.join(root, 'nested', 'value.json');
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, 'old', 'utf8');

      await expect(atomicWriteUtf8(target, 'new', () => { throw new Error('invalid'); })).rejects.toThrow('invalid');
      await expect(readFile(target, 'utf8')).resolves.toBe('old');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('publishes the validated content without leaving a backup window', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'zhiji-atomic-'));
    try {
      const target = path.join(root, 'value.txt');
      await writeFile(target, 'old', 'utf8');
      await atomicWriteUtf8(target, 'new', (value) => expect(value).toBe('new'));
      await expect(readFile(target, 'utf8')).resolves.toBe('new');
      await expect((await import('node:fs/promises')).readdir(root)).resolves.toEqual(['value.txt']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('keeps the old target when the replacement operation fails', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'zhiji-atomic-'));
    try {
      const target = path.join(root, 'value.txt');
      await writeFile(target, 'old', 'utf8');
      await expect(atomicWriteUtf8(target, 'new', () => undefined, { replace: async () => { throw new Error('replace failed'); } })).rejects.toThrow('replace failed');
      await expect(readFile(target, 'utf8')).resolves.toBe('old');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.each(['validated', 'published'] as const)('survives a deterministic child-process exit at the %s phase', async (phase) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'zhiji-atomic-crash-'));
    try {
      const target = path.join(root, 'value.txt');
      const marker = path.join(root, 'phase.txt');
      await writeFile(target, 'old', 'utf8');

      await expect(runCrashChild(target, marker, phase)).resolves.toBe(17);
      await expect(readFile(marker, 'utf8')).resolves.toBe(phase);
      await expect(readFile(target, 'utf8')).resolves.toBe(phase === 'validated' ? 'old' : 'new');
      await expect(readdir(root)).resolves.toEqual(expect.arrayContaining(['value.txt', 'phase.txt']));
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataRootHolder } from '../../src/main-process/infrastructure/data-directory/data-root-holder';
import { MaintenanceCoordinator } from '../../src/main-process/infrastructure/lifecycle/maintenance-coordinator';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('DataRootHolder', () => {
  it('waits for active writes, verifies the copy, then keeps the process read-only', async () => {
    const source = await mkdtemp(path.join(os.tmpdir(), 'zhiji-root-source-'));
    const target = await mkdtemp(path.join(os.tmpdir(), 'zhiji-root-target-'));
    roots.push(source, target);
    await mkdir(path.join(source, 'journals', '2026'), { recursive: true });
    await writeFile(path.join(source, 'journals', '2026', 'entry.md'), '权威内容', 'utf8');
    const config = { patch: vi.fn(async () => ({ schemaVersion: 1 as const, dataRoot: target })) };
    const maintenance = new MaintenanceCoordinator();
    const release = { resolve: undefined as (() => void) | undefined };
    const active = maintenance.runWrite(() => new Promise<void>((resolve) => { release.resolve = resolve; }));
    const holder = new DataRootHolder(config as never, source, maintenance);
    const change = holder.changeLocation(target, { move: true });
    await Promise.resolve();
    expect(config.patch).not.toHaveBeenCalled();
    release.resolve?.();
    await active;
    await expect(change).resolves.toMatchObject({ moved: true, from: source, to: target });
    await expect(readFile(path.join(target, 'journals', '2026', 'entry.md'), 'utf8')).resolves.toBe('权威内容');
    expect(new DataRootHolder(config as never, target).get()).toBe(path.resolve(target));
    expect(config.patch).toHaveBeenCalledWith({ dataRoot: path.resolve(target) });
    await expect(maintenance.runWrite(async () => undefined)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('rejects a target that overlaps the current root and leaves configuration unchanged', async () => {
    const source = await mkdtemp(path.join(os.tmpdir(), 'zhiji-root-source-'));
    roots.push(source);
    const target = path.join(source, 'nested');
    await mkdir(target, { recursive: true });
    const config = { patch: vi.fn(async () => ({ schemaVersion: 1 as const, dataRoot: target })) };
    const holder = new DataRootHolder(config as never, source);
    await expect(holder.changeLocation(target, { move: true })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(config.patch).not.toHaveBeenCalled();
  });

  it('rejects a junction target even when the linked directory is writable', async () => {
    const source = await mkdtemp(path.join(os.tmpdir(), 'zhiji-root-source-'));
    const linked = await mkdtemp(path.join(os.tmpdir(), 'zhiji-root-linked-'));
    const parent = await mkdtemp(path.join(os.tmpdir(), 'zhiji-root-junction-parent-'));
    const target = path.join(parent, 'target');
    roots.push(source, linked, parent);
    await symlink(linked, target, 'junction');
    const config = { patch: vi.fn(async () => ({ schemaVersion: 1 as const, dataRoot: target })) };
    const holder = new DataRootHolder(config as never, source);

    await expect(holder.changeLocation(target, { move: true })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(config.patch).not.toHaveBeenCalled();
  });

  it('releases maintenance and keeps the old root when copying fails', async () => {
    const source = await mkdtemp(path.join(os.tmpdir(), 'zhiji-root-source-'));
    const target = await mkdtemp(path.join(os.tmpdir(), 'zhiji-root-target-'));
    roots.push(source, target);
    const config = { patch: vi.fn(async () => ({ schemaVersion: 1 as const, dataRoot: target })) };
    const maintenance = new MaintenanceCoordinator();
    const holder = new DataRootHolder(config as never, source, maintenance, {
      copyDirectoryContents: vi.fn(async () => { throw new Error('copy failed'); }),
    });

    await expect(holder.changeLocation(target, { move: true })).rejects.toMatchObject({ code: 'UNKNOWN', message: expect.stringContaining('copy failed') });
    expect(holder.get()).toBe(source);
    expect(config.patch).not.toHaveBeenCalled();
    await expect(maintenance.runWrite(async () => 'write-after-copy-failure')).resolves.toBe('write-after-copy-failure');
  });

  it('rejects a new write while the migration copy is in progress', async () => {
    const source = await mkdtemp(path.join(os.tmpdir(), 'zhiji-root-source-'));
    const target = await mkdtemp(path.join(os.tmpdir(), 'zhiji-root-target-'));
    roots.push(source, target);
    let signalCopyStarted!: () => void;
    let releaseCopy!: () => void;
    const copyStarted = new Promise<void>((resolve) => { signalCopyStarted = resolve; });
    const config = { patch: vi.fn(async () => ({ schemaVersion: 1 as const, dataRoot: target })) };
    const maintenance = new MaintenanceCoordinator();
    const holder = new DataRootHolder(config as never, source, maintenance, {
      copyDirectoryContents: async () => {
        signalCopyStarted();
        await new Promise<void>((resolve) => { releaseCopy = resolve; });
      },
    });

    const migration = holder.changeLocation(target, { move: true });
    await copyStarted;
    await expect(maintenance.runWrite(async () => 'should-not-run')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    releaseCopy();
    await expect(migration).resolves.toMatchObject({ moved: true });
  });

  it('releases maintenance and keeps the old root when configuration update fails', async () => {
    const source = await mkdtemp(path.join(os.tmpdir(), 'zhiji-root-source-'));
    const target = await mkdtemp(path.join(os.tmpdir(), 'zhiji-root-target-'));
    roots.push(source, target);
    await mkdir(path.join(source, 'journals'), { recursive: true });
    await writeFile(path.join(source, 'journals', 'entry.md'), '旧数据', 'utf8');
    const config = { patch: vi.fn(async () => { throw new Error('config write failed'); }) };
    const maintenance = new MaintenanceCoordinator();
    const holder = new DataRootHolder(config as never, source, maintenance);

    await expect(holder.changeLocation(target, { move: true })).rejects.toThrow('config write failed');
    expect(holder.get()).toBe(source);
    await expect(readFile(path.join(source, 'journals', 'entry.md'), 'utf8')).resolves.toBe('旧数据');
    expect(config.patch).toHaveBeenCalledWith({ dataRoot: path.resolve(target) });
    await expect(maintenance.runWrite(async () => 'write-after-config-failure')).resolves.toBe('write-after-config-failure');
  });
});

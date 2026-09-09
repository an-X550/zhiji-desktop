import { describe, expect, it, vi } from 'vitest';
import { MaintenanceCoordinator } from '../../src/main-process/infrastructure/lifecycle/maintenance-coordinator';

describe('MaintenanceCoordinator', () => {
  it('drains active writes before pausing the lifecycle', async () => {
    const coordinator = new MaintenanceCoordinator();
    const release = { resolve: undefined as (() => void) | undefined };
    const active = coordinator.runWrite(() => new Promise<void>((resolve) => { release.resolve = resolve; }));
    const lifecycle = { pauseForMaintenance: vi.fn(async () => undefined), resumeAfterMaintenance: vi.fn(async () => undefined) };
    coordinator.setLifecycle(lifecycle);
    const maintenance = coordinator.runMaintenance(async () => 'done');
    await Promise.resolve();
    expect(lifecycle.pauseForMaintenance).not.toHaveBeenCalled();
    release.resolve?.();
    await active;
    await expect(maintenance).resolves.toBe('done');
    expect(lifecycle.pauseForMaintenance).toHaveBeenCalledOnce();
    expect(lifecycle.resumeAfterMaintenance).toHaveBeenCalledOnce();
  });

  it('keeps the process read-only after a successful data-root change', async () => {
    const coordinator = new MaintenanceCoordinator();
    const lifecycle = { pauseForMaintenance: vi.fn(async () => undefined), resumeAfterMaintenance: vi.fn(async () => undefined) };
    coordinator.setLifecycle(lifecycle);
    await expect(coordinator.runMaintenance(async () => 'changed', { keepReadOnly: true })).resolves.toBe('changed');
    await expect(coordinator.runWrite(async () => undefined)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(lifecycle.resumeAfterMaintenance).not.toHaveBeenCalled();
    expect(coordinator.isReadOnly).toBe(true);
  });

  it('releases maintenance after a failed operation', async () => {
    const coordinator = new MaintenanceCoordinator();
    const lifecycle = { pauseForMaintenance: vi.fn(async () => undefined), resumeAfterMaintenance: vi.fn(async () => undefined) };
    coordinator.setLifecycle(lifecycle);
    await expect(coordinator.runMaintenance(async () => { throw new Error('copy failed'); })).rejects.toThrow('copy failed');
    await expect(coordinator.runWrite(async () => 'writes work')).resolves.toBe('writes work');
    expect(lifecycle.resumeAfterMaintenance).toHaveBeenCalledOnce();
  });
});

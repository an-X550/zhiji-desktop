import { appError } from '../../../shared/errors/app-error';

export interface MaintenanceLifecycle {
  /** 同步入场检查；忙碌时不进入 draining，以保留正常取消能力。 */
  assertCanMaintain?(): void;
  /** 必须等待 runtime.shutdown 的 command.completed，再返回。 */
  pauseForMaintenance(): Promise<void>;
  /** 仅在维护操作失败或不改变数据根时调用。 */
  resumeAfterMaintenance(): Promise<void>;
}

type MaintenanceMode = 'idle' | 'draining' | 'readonly';

/**
 * 维护操作与普通写入之间的进程内协调器。
 * 原子文件替换只保证单个文件，不能替代这里的业务级“先停写、再复制/恢复”。
 */
export class MaintenanceCoordinator {
  private activeWrites = 0;
  private mode: MaintenanceMode = 'idle';
  private lifecycle: MaintenanceLifecycle | undefined;
  private readonly idleWaiters = new Set<() => void>();

  setLifecycle(lifecycle: MaintenanceLifecycle): void {
    this.lifecycle = lifecycle;
  }

  get isReadOnly(): boolean { return this.mode === 'readonly'; }
  get isMaintaining(): boolean { return this.mode !== 'idle'; }
  get activeOperationCount(): number { return this.activeWrites; }

  async runWrite<T>(task: () => Promise<T>): Promise<T> {
    if (this.mode !== 'idle') throw appError({ code: 'INVALID_INPUT', message: '数据维护进行中，请完成或取消当前操作后重试。' });
    this.activeWrites += 1;
    try { return await task(); }
    finally {
      this.activeWrites -= 1;
      if (this.activeWrites === 0) this.flushIdleWaiters();
    }
  }

  async runRead<T>(task: () => Promise<T>, snapshot: () => T | Promise<T>): Promise<T> {
    if (this.mode !== 'idle') return snapshot();
    this.activeWrites += 1;
    try { return await task(); }
    finally {
      this.activeWrites -= 1;
      if (this.activeWrites === 0) this.flushIdleWaiters();
    }
  }

  async runMaintenance<T>(task: () => Promise<T>, options: { keepReadOnly?: boolean } = {}): Promise<T> {
    if (this.mode !== 'idle') throw appError({ code: 'INVALID_INPUT', message: '已有数据维护操作正在进行。' });
    this.lifecycle?.assertCanMaintain?.();
    this.mode = 'draining';
    let paused = false;
    try {
      await this.waitForWrites();
      await this.lifecycle?.pauseForMaintenance();
      paused = Boolean(this.lifecycle);
      const result = await task();
      if (options.keepReadOnly) {
        this.mode = 'readonly';
        return result;
      }
      return result;
    } finally {
      if (this.mode !== 'readonly') {
        if (paused) {
          try { await this.lifecycle?.resumeAfterMaintenance(); }
          catch (error) {
            // 无法确认 Utility 已恢复时宁可保持只读，避免失败后继续写旧目录。
            this.mode = 'readonly';
            console.error('知己维护后无法恢复 Agent，应用保持只读：', error instanceof Error ? error.message : 'unknown error');
          }
        }
        if (this.mode !== 'readonly') {
          this.mode = 'idle';
          this.flushIdleWaiters();
        }
      }
    }
  }

  private waitForWrites(): Promise<void> {
    if (this.activeWrites === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  private flushIdleWaiters(): void {
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
}

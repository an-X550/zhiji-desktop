import path from 'node:path';
import { MessageChannelMain, utilityProcess, type MessagePortMain, type UtilityProcess } from 'electron';
import { AgentUtilityEventSchema, type AgentRuntimeResponse, type AgentUtilityCommand, type AgentUtilityEvent } from '../../shared/schemas/agent-protocol';
import type { AgentRuntimePort } from './agent-facade';

type RuntimeInstance = {
  child: UtilityProcess;
  port: MessagePortMain;
  exited: boolean;
  error?: Error;
  exitWaiters: Set<() => void>;
};
type PendingCommand = { resolve(): void; reject(error: Error): void; instance: RuntimeInstance };
export interface ElectronAgentRuntimeOptions {
  utilityEntry?: string;
  sessionRoot?: string;
  /** spawn/ready 全过程的等待上限，生产默认 10 秒。 */
  startupTimeoutMs?: number;
  /** 仅用于严格维护停机的 shutdown 确认等待，生产默认 10 秒。 */
  shutdownTimeoutMs?: number;
  /** 仅用于严格维护停机的真实 exit 等待，生产默认 10 秒。 */
  exitTimeoutMs?: number;
}

/** Electron-only owner for the Utility Process and its one structured MessagePort. */
export class ElectronAgentRuntime implements AgentRuntimePort {
  private child: UtilityProcess | undefined;
  private port: MessagePortMain | undefined;
  private startup: Promise<void> | undefined;
  private readonly eventListeners = new Set<(event: AgentUtilityEvent) => void>();
  private readonly exitListeners = new Set<() => void>();
  private readonly pending = new Map<string, PendingCommand>();
  private stopping = false;
  private ready = false;
  private resolveStartup: (() => void) | undefined;
  private rejectStartup: ((error: Error) => void) | undefined;
  private startupDiagnostics = '';

  private readonly options: ElectronAgentRuntimeOptions;
  private instance: RuntimeInstance | undefined;
  private stopInFlight: Promise<void> | undefined;

  constructor(options: ElectronAgentRuntimeOptions | string = {}) {
    this.options = typeof options === 'string' ? { utilityEntry: options } : options;
  }

  async start(): Promise<void> {
    if (this.stopping) throw new Error('知己 Agent 正在停止，请稍后重试或重启应用。');
    if (this.instance && !this.instance.exited && !this.startup && !this.ready) {
      throw this.instance.error ?? new Error('知己 Agent 正在启动，请稍后重试。');
    }
    if (this.instance && !this.instance.exited && this.ready) return;
    this.startup ??= this.launch();
    try { await this.startup; }
    catch (error) { this.startup = undefined; throw error; }
  }

  async request(command: Exclude<AgentUtilityCommand, { type: 'model.delta' | 'model.reasoning-delta' | 'model.completed' | 'model.failed' | 'model.cancelled' }>): Promise<void> {
    await this.start();
    const instance = this.instance;
    if (!instance || instance.exited || !this.port) throw new Error('知己 Agent 未启动。');
    return this.postCommand(command, instance);
  }

  send(command: AgentRuntimeResponse): void {
    if (this.stopping) return;
    this.port?.postMessage(command);
  }

  onEvent(listener: (event: AgentUtilityEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onExit(listener: () => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  async stop(): Promise<void> {
    try { await this.stopInternal(false); }
    catch { /* 普通应用退出保留尽力清理语义；维护停机使用严格方法。 */ }
  }

  async stopForMaintenance(): Promise<void> {
    await this.stopInternal(true);
  }

  private launch(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = utilityProcess.fork(this.options.utilityEntry ?? path.join(__dirname, 'utility.js'), [], { stdio: 'pipe' });
      const channel = new MessageChannelMain();
      const instance: RuntimeInstance = { child, port: channel.port1, exited: false, exitWaiters: new Set() };
      this.instance = instance;
      this.child = child;
      this.port = channel.port1;
      this.startupDiagnostics = '';
      this.stopping = false;
      this.ready = false;
      const startupTimer = setTimeout(() => {
        this.handleChildError(instance, new Error('知己 Agent 启动超时，请重启应用后重试。'));
      }, Math.max(1, this.options.startupTimeoutMs ?? 10_000));
      this.resolveStartup = () => { clearTimeout(startupTimer); resolve(); };
      this.rejectStartup = (error) => { clearTimeout(startupTimer); reject(error); };
      child.stderr?.on('data', (chunk) => this.appendStartupDiagnostics(chunk));
      // Drain stdout as well: a piped child stream can otherwise block startup
      // after enough diagnostic output, while stderr remains the user-facing
      // failure source.
      child.stdout?.on('data', () => undefined);
      channel.port1.on('message', (event) => this.handleMessage(event.data, instance));
      channel.port1.start();
      child.once('spawn', () => child.postMessage({ type: 'agent-port', ...(this.options.sessionRoot ? { sessionRoot: this.options.sessionRoot } : {}) }, [channel.port2]));
      child.on('exit', () => this.handleExit(instance));
      child.on('error', (error) => this.handleChildError(instance, error));
    });
  }

  private handleMessage(raw: unknown, instance: RuntimeInstance): void {
    if (this.instance !== instance || instance.exited) return;
    const parsed = AgentUtilityEventSchema.safeParse(raw);
    if (!parsed.success) return;
    const event = parsed.data;
    if (event.type === 'runtime.ready') {
      // 启动已失败的实例必须等真实 exit，迟到 ready 不得使其重新可用。
      if (instance.error) return;
      this.ready = true; this.resolveStartup?.(); this.resolveStartup = undefined; this.rejectStartup = undefined; return;
    }
    if (event.type === 'command.completed') {
      const pending = this.pending.get(event.requestId);
      if (pending?.instance === instance) { pending.resolve(); this.pending.delete(event.requestId); }
      return;
    }
    if (event.type === 'command.failed') {
      const pending = this.pending.get(event.requestId);
      if (pending?.instance === instance) { pending.reject(new Error(event.message)); this.pending.delete(event.requestId); }
      return;
    }
    if (event.type === 'runtime.error' && !this.ready) { this.rejectStartup?.(new Error(event.message)); this.resolveStartup = undefined; this.rejectStartup = undefined; return; }
    for (const listener of this.eventListeners) listener(event);
  }

  private handleExit(instance: RuntimeInstance): void {
    if (instance.exited) return;
    instance.exited = true;
    for (const resolve of instance.exitWaiters) resolve();
    instance.exitWaiters.clear();
    if (this.instance !== instance) return;
    const detail = this.startupDiagnostics.trim();
    const error = new Error(detail ? `知己 Agent 运行已停止：${detail}` : '知己 Agent 运行已停止。');
    if (!this.ready) this.rejectStartup?.(error);
    this.resolveStartup = undefined;
    this.rejectStartup = undefined;
    this.ready = false;
    for (const [requestId, pending] of this.pending) {
      if (pending.instance !== instance) continue;
      pending.reject(error);
      this.pending.delete(requestId);
    }
    const notify = !this.stopping;
    this.child = undefined;
    instance.port.close();
    this.port = undefined;
    this.instance = undefined;
    this.startup = undefined;
    if (notify) for (const listener of this.exitListeners) listener();
  }

  private handleChildError(instance: RuntimeInstance, raw: unknown): void {
    if (this.instance !== instance || instance.exited) return;
    const error = raw instanceof Error ? raw : new Error(String(raw));
    instance.error = error;
    if (!this.ready) {
      this.rejectStartup?.(error);
      this.resolveStartup = undefined;
      this.rejectStartup = undefined;
    }
    for (const [requestId, pending] of this.pending) {
      if (pending.instance !== instance) continue;
      pending.reject(error);
      this.pending.delete(requestId);
    }
  }

  private postCommand(command: Exclude<AgentUtilityCommand, { type: 'model.delta' | 'model.reasoning-delta' | 'model.completed' | 'model.failed' | 'model.cancelled' }>, instance: RuntimeInstance): Promise<void> {
    if (this.instance !== instance || instance.exited) return Promise.reject(new Error('知己 Agent 已退出。'));
    return new Promise<void>((resolve, reject) => {
      this.pending.set(command.requestId, { resolve, reject, instance });
      try { instance.port.postMessage(command); }
      catch (error) {
        this.pending.delete(command.requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private stopInternal(strict: boolean): Promise<void> {
    if (this.stopInFlight) return this.stopInFlight;
    const instance = this.instance;
    if (!instance || instance.exited) return Promise.resolve();
    this.stopping = true;
    const inFlight = this.performStop(instance).catch((error) => {
      if (strict) throw error;
      this.detachAfterBestEffort(instance);
    }).finally(() => {
      if (this.stopInFlight === inFlight) this.stopInFlight = undefined;
      if (this.instance !== instance || instance.exited) this.stopping = false;
    });
    this.stopInFlight = inFlight;
    return inFlight;
  }

  private async performStop(instance: RuntimeInstance): Promise<void> {
    const exitWaiter = this.createExitWaiter(instance);
    try {
      const startup = this.startup;
      if (startup) await startup;
      if (this.instance !== instance || instance.exited) throw new Error('知己 Agent 在维护停机前已异常退出。');
      if (!this.ready || this.port !== instance.port) throw new Error('无法确认知己 Agent 已启动，维护未开始。');

      const requestId = crypto.randomUUID();
      const completion = this.postCommand({ type: 'runtime.shutdown', requestId }, instance);
      try { await this.withTimeout(completion, this.options.shutdownTimeoutMs ?? 10_000, '等待知己 Agent 完成安全停机超时。'); }
      catch (error) {
        this.pending.delete(requestId);
        throw error;
      }

      exitWaiter.arm();
      if (instance.exited) return;
      const pid = instance.child.pid;
      const killed = pid !== undefined ? instance.child.kill() : false;
      if (!instance.exited) {
        if (!killed) await exitWaiter.promise;
        else await exitWaiter.promise;
      }
      if (!instance.exited) throw new Error('知己 Agent 未报告真实 exit，维护未开始。');
    } finally {
      exitWaiter.cancel();
    }
  }

  private createExitWaiter(instance: RuntimeInstance): { promise: Promise<void>; arm(): void; cancel(): void } {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let resolveExit!: () => void;
    let rejectExit!: (error: Error) => void;
    const onExit = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolveExit();
    };
    const promise = new Promise<void>((resolve, reject) => { resolveExit = resolve; rejectExit = reject; });
    if (instance.exited) onExit();
    else instance.exitWaiters.add(onExit);
    return {
      promise,
      arm: () => {
        if (settled || timer) return;
        timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          instance.exitWaiters.delete(onExit);
          rejectExit(new Error('等待知己 Agent exit 超时，维护未开始。'));
        }, Math.max(1, this.options.exitTimeoutMs ?? 10_000));
      },
      cancel: () => {
        if (timer) clearTimeout(timer);
        instance.exitWaiters.delete(onExit);
      },
    };
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), Math.max(1, timeoutMs)); }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private detachAfterBestEffort(instance: RuntimeInstance): void {
    if (this.instance !== instance) return;
    instance.port.close();
    this.child = undefined;
    this.port = undefined;
    this.instance = undefined;
    this.startup = undefined;
    this.ready = false;
    this.stopping = false;
  }

  private appendStartupDiagnostics(chunk: unknown): void {
    const text = String(chunk).replace(/\s+/g, ' ').trim();
    if (!text) return;
    this.startupDiagnostics = `${this.startupDiagnostics} ${text}`
      .replace(/(authorization|bearer|api[-_ ]?key)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
      .trim()
      .slice(-2_000);
  }
}

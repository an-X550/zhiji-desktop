import { EventEmitter } from 'node:events';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MaintenanceCoordinator } from '../../src/main-process/infrastructure/lifecycle/maintenance-coordinator';
import { AgentFacade } from '../../src/main-process/agent/agent-facade';

class FakePort extends EventEmitter {
  readonly posted: unknown[] = [];
  closed = false;
  postMessage(message: unknown): void { this.posted.push(message); }
  start(): void { return undefined; }
  close(): void { this.closed = true; }
}

class FakeChild extends EventEmitter {
  pid: number | undefined = 123;
  killResult = false;
  exitOnKill = false;
  killCalls = 0;
  kill(): boolean {
    this.killCalls += 1;
    if (this.exitOnKill) queueMicrotask(() => this.emit('exit', 0));
    return this.killResult;
  }
  postMessage(): void { return undefined; }
  readonly stderr = new EventEmitter();
  readonly stdout = new EventEmitter();
}

class FakeMessageChannelMain {
  readonly port1 = new FakePort();
  readonly port2 = new FakePort();
}

const children: FakeChild[] = [];
const channels: FakeMessageChannelMain[] = [];
const fork = () => {
  const child = new FakeChild();
  children.push(child);
  return child;
};
class MessageChannelMain extends FakeMessageChannelMain {
  constructor() {
    super();
    channels.push(this);
  }
}
vi.doMock('electron', () => ({ MessageChannelMain, utilityProcess: { fork } }));

let ElectronAgentRuntime: typeof import('../../src/main-process/agent/electron-agent-runtime').ElectronAgentRuntime;
beforeAll(async () => {
  ElectronAgentRuntime = (await import('../../src/main-process/agent/electron-agent-runtime')).ElectronAgentRuntime;
});

afterEach(() => {
  for (const child of children) child.emit('exit', 1);
  children.length = 0;
  channels.length = 0;
  vi.useRealTimers();
});

async function startRuntime(options: { shutdownTimeoutMs?: number; exitTimeoutMs?: number } = {}): Promise<{ runtime: InstanceType<typeof ElectronAgentRuntime>; child: FakeChild; port: FakePort }> {
  const runtime = new ElectronAgentRuntime({ utilityEntry: 'utility.js', ...options });
  const starting = runtime.start();
  const child = children.at(-1);
  const channel = channels.at(-1);
  if (!child || !channel) throw new Error('fake utility 未创建');
  child.emit('spawn');
  channel.port1.emit('message', { data: { type: 'runtime.ready' } });
  await starting;
  return { runtime, child, port: channel.port1 };
}

describe('ElectronAgentRuntime maintenance shutdown', () => {
  it('releases a list and maintenance drain when startup never becomes ready', async () => {
    vi.useFakeTimers();
    const runtime = new ElectronAgentRuntime({ startupTimeoutMs: 20 });
    const maintenance = new MaintenanceCoordinator();
    const facade = new AgentFacade(runtime, {} as never, undefined, {}, maintenance);
    maintenance.setLifecycle(facade);
    const listing = facade.list().catch((error: Error) => error);
    const child = children.at(-1);
    const channel = channels.at(-1);
    if (!child || !channel) throw new Error('fake utility 未创建');
    const port = channel.port1;
    const copy = vi.fn(async () => undefined);
    const maintaining = maintenance.runMaintenance(copy).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(100);
    expect(await listing).toBeInstanceOf(Error);
    expect(await maintaining).toBeInstanceOf(Error);
    expect(maintenance.activeOperationCount).toBe(0);
    expect(maintenance.isMaintaining).toBe(false);
    expect(copy).not.toHaveBeenCalled();
    port.emit('message', { data: { type: 'runtime.ready' } });
    await expect(facade.list()).rejects.toThrow();
    expect(children).toHaveLength(1);
    child.emit('exit', 1);
  });

  it('bounds startup and maintenance waiting, ignores late ready and prevents duplicate launch', async () => {
    vi.useFakeTimers();
    const runtime = new ElectronAgentRuntime({ startupTimeoutMs: 20, shutdownTimeoutMs: 20, exitTimeoutMs: 20 });
    let startupError: Error | undefined;
    let stopError: Error | undefined;
    const starting = runtime.start().catch((error) => { startupError = error; });
    const child = children.at(-1);
    const channel = channels.at(-1);
    if (!child || !channel) throw new Error('fake utility 未创建');
    const port = channel.port1;
    const stopping = runtime.stopForMaintenance().catch((error) => { stopError = error; });
    try {
      await vi.advanceTimersByTimeAsync(100);
      expect(startupError?.message).toContain('启动超时');
      expect(stopError?.message).toContain('启动超时');
      port.emit('message', { data: { type: 'runtime.ready' } });
      await expect(runtime.start()).rejects.toThrow();
      expect(children).toHaveLength(1);
      expect(port.posted).toHaveLength(0);
    } finally {
      child.emit('exit', 1);
      await Promise.all([starting, stopping]);
    }
  });

  it('succeeds only after shutdown acknowledgement and a real exit', async () => {
    const { runtime, child, port } = await startRuntime();
    child.killResult = true;
    child.exitOnKill = true;
    const pending = runtime.stopForMaintenance();
    const shutdown = await vi.waitFor(() => {
      const command = port.posted.find((item): item is { type: 'runtime.shutdown'; requestId: string } => typeof item === 'object' && item !== null && (item as { type?: unknown }).type === 'runtime.shutdown');
      if (!command) throw new Error('尚未发送 shutdown');
      return command;
    });
    port.emit('message', { data: { type: 'command.completed', requestId: shutdown.requestId } });
    await expect(pending).resolves.toBeUndefined();
    expect(child.killCalls).toBe(1);
  });

  it('rejects maintenance when shutdown fails instead of allowing copy to run', async () => {
    const { runtime, child, port } = await startRuntime();
    const maintenance = new MaintenanceCoordinator();
    const copy = vi.fn(async () => undefined);
    const patchConfig = vi.fn(async () => undefined);
    maintenance.setLifecycle({
      pauseForMaintenance: () => runtime.stopForMaintenance(),
      resumeAfterMaintenance: vi.fn(async () => undefined),
    });

    const pending = maintenance.runMaintenance(async () => { await copy(); await patchConfig(); });
    const shutdown = await vi.waitFor(() => {
      const command = port.posted.find((item): item is { type: 'runtime.shutdown'; requestId: string } => typeof item === 'object' && item !== null && (item as { type?: unknown }).type === 'runtime.shutdown');
      if (!command) throw new Error('尚未发送 shutdown');
      return command;
    });
    port.emit('message', { data: { type: 'command.failed', requestId: shutdown.requestId, message: 'dispose failed' } });

    await expect(pending).rejects.toThrow('dispose failed');
    expect(copy).not.toHaveBeenCalled();
    expect(patchConfig).not.toHaveBeenCalled();
    expect(child.killCalls).toBe(0);
  });

  it('rejects when shutdown acknowledgement times out and keeps the instance tracked', async () => {
    const { runtime, child } = await startRuntime({ shutdownTimeoutMs: 10, exitTimeoutMs: 10 });
    await expect(runtime.stopForMaintenance()).rejects.toThrow('等待知己 Agent 完成安全停机超时');
    expect(child.killCalls).toBe(0);
    await expect(runtime.start()).rejects.toThrow('正在停止');
    child.emit('exit', 1);
  });

  it('rejects when kill returns false and no exit event arrives', async () => {
    const { runtime, child, port } = await startRuntime({ exitTimeoutMs: 10 });
    const pending = runtime.stopForMaintenance();
    const shutdown = await vi.waitFor(() => {
      const command = port.posted.find((item): item is { type: 'runtime.shutdown'; requestId: string } => typeof item === 'object' && item !== null && (item as { type?: unknown }).type === 'runtime.shutdown');
      if (!command) throw new Error('尚未发送 shutdown');
      return command;
    });
    port.emit('message', { data: { type: 'command.completed', requestId: shutdown.requestId } });
    await expect(pending).rejects.toThrow('等待知己 Agent exit 超时');
    expect(child.killCalls).toBe(1);
    child.emit('exit', 1);
  });

  it('does not treat an error as exit, but handles a later exit once', async () => {
    const { runtime, child, port } = await startRuntime();
    const onExit = vi.fn();
    runtime.onExit(onExit);
    child.emit('error', new Error('短暂错误'));
    const request = runtime.request({ type: 'session.list', requestId: crypto.randomUUID() });
    const command = await vi.waitFor(() => {
      const found = port.posted.find((item): item is { type: 'session.list'; requestId: string } => typeof item === 'object' && item !== null && (item as { type?: unknown }).type === 'session.list');
      if (!found) throw new Error('尚未发送 list');
      return found;
    });
    port.emit('message', { data: { type: 'command.completed', requestId: command.requestId } });
    await expect(request).resolves.toBeUndefined();
    expect(onExit).not.toHaveBeenCalled();
    child.emit('exit', 1);
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('reuses one in-flight shutdown when stop is called concurrently', async () => {
    const { runtime, child, port } = await startRuntime();
    child.killResult = true;
    child.exitOnKill = true;
    const first = runtime.stopForMaintenance();
    const second = runtime.stopForMaintenance();
    const shutdown = await vi.waitFor(() => {
      const commands = port.posted.filter((item): item is { type: 'runtime.shutdown'; requestId: string } => typeof item === 'object' && item !== null && (item as { type?: unknown }).type === 'runtime.shutdown');
      if (commands.length !== 1) throw new Error('shutdown 尚未合并');
      return commands[0];
    });
    port.emit('message', { data: { type: 'command.completed', requestId: shutdown.requestId } });
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(child.killCalls).toBe(1);
  });

  it('does not mistake a not-yet-spawned process for a stopped process', async () => {
    const runtime = new ElectronAgentRuntime({ utilityEntry: 'utility.js', shutdownTimeoutMs: 10, exitTimeoutMs: 10 });
    const starting = runtime.start();
    const child = children.at(-1);
    if (!child) throw new Error('fake utility 未创建');
    const stopping = runtime.stopForMaintenance();
    child.emit('exit', 1);
    await expect(starting).rejects.toThrow('运行已停止');
    await expect(stopping).rejects.toThrow();
    expect(child.killCalls).toBe(0);
  });

  it('ignores a late exit event from an old instance after a new instance starts', async () => {
    const first = await startRuntime({ shutdownTimeoutMs: 10 });
    const oldChild = first.child;
    const failedStop = first.runtime.stop();
    const shutdown = await vi.waitFor(() => {
      const command = first.port.posted.find((item): item is { type: 'runtime.shutdown'; requestId: string } => typeof item === 'object' && item !== null && (item as { type?: unknown }).type === 'runtime.shutdown');
      if (!command) throw new Error('尚未发送 shutdown');
      return command;
    });
    first.port.emit('message', { data: { type: 'command.failed', requestId: shutdown.requestId, message: '旧实例停机失败' } });
    await failedStop;

    const second = await startRuntime();
    oldChild.emit('exit', 1);
    const request = second.runtime.request({ type: 'session.list', requestId: crypto.randomUUID() });
    const command = await vi.waitFor(() => {
      const found = second.port.posted.find((item): item is { type: 'session.list'; requestId: string } => typeof item === 'object' && item !== null && (item as { type?: unknown }).type === 'session.list');
      if (!found) throw new Error('新实例未收到 list');
      return found;
    });
    second.port.emit('message', { data: { type: 'command.completed', requestId: command.requestId } });
    await expect(request).resolves.toBeUndefined();
    second.child.emit('exit', 0);
  });
});

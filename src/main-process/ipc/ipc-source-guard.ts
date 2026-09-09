import { type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appError } from '../../shared/errors/app-error';

export type ApplicationPagePolicy = (url: string) => boolean;

export class IpcSourceGuard {
  private readonly registered = new Set<number>();

  constructor(private readonly isAllowedPage: ApplicationPagePolicy) {}

  registerWindow(window: BrowserWindow): void {
    const id = window.webContents.id;
    this.registered.add(id);
    window.webContents.once('destroyed', () => this.registered.delete(id));
  }

  assert(event: IpcMainInvokeEvent): void {
    const sender = event.sender;
    if (sender.isDestroyed() || !this.registered.has(sender.id)) throw appError({ code: 'INVALID_INPUT', message: 'IPC 来源不是知己应用窗口。' });
    if (event.senderFrame !== sender.mainFrame) throw appError({ code: 'INVALID_INPUT', message: 'IPC 不接受子 frame 调用。' });
    if (!this.isAllowedPage(sender.getURL())) throw appError({ code: 'INVALID_INPUT', message: 'IPC 页面来源无效。' });
  }
}

export function createApplicationPagePolicy(devServerUrl: string | undefined, productionEntry: string): ApplicationPagePolicy {
  if (devServerUrl) {
    const expected = new URL(devServerUrl);
    return (url) => {
      try {
        const actual = new URL(url);
        return actual.origin === expected.origin && actual.pathname === expected.pathname;
      } catch { return false; }
    };
  }
  const expected = path.normalize(productionEntry);
  return (url) => {
    try { return path.normalize(fileURLToPath(new URL(url))) === expected; }
    catch { return false; }
  };
}

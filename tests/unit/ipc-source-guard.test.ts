import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { describe, expect, it } from 'vitest';
import { IpcSourceGuard, createApplicationPagePolicy } from '../../src/main-process/ipc/ipc-source-guard';

function createFakeWindow(url = 'http://127.0.0.1:5173/') {
  const mainFrame = {};
  const sender = { id: 7, isDestroyed: () => false, mainFrame, getURL: () => url };
  const window = { webContents: { ...sender, once: (_event: string, _listener: () => void) => undefined } };
  return { sender, mainFrame, window };
}

describe('IpcSourceGuard', () => {
  it('accepts only the registered top-level application page', () => {
    const { sender, mainFrame, window } = createFakeWindow();
    const guard = new IpcSourceGuard((url) => url === 'http://127.0.0.1:5173/');
    guard.registerWindow(window as unknown as BrowserWindow);
    expect(() => guard.assert({ sender, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent)).not.toThrow();
  });

  it('rejects unknown windows, child frames and untrusted pages', () => {
    const fake = createFakeWindow();
    const guard = new IpcSourceGuard((url) => url === 'http://127.0.0.1:5173/');
    guard.registerWindow(fake.window as unknown as BrowserWindow);
    expect(() => guard.assert({ sender: fake.sender, senderFrame: {} } as unknown as IpcMainInvokeEvent)).toThrow(/子 frame/);
    expect(() => guard.assert({ sender: { ...fake.sender, id: 99 }, senderFrame: fake.mainFrame } as unknown as IpcMainInvokeEvent)).toThrow(/应用窗口/);
    expect(() => guard.assert({ sender: { ...fake.sender, getURL: () => 'http://127.0.0.1:5173.evil/' }, senderFrame: fake.mainFrame } as unknown as IpcMainInvokeEvent)).toThrow(/页面来源/);
    expect(() => guard.assert({ sender: { ...fake.sender, isDestroyed: () => true }, senderFrame: fake.mainFrame } as unknown as IpcMainInvokeEvent)).toThrow(/应用窗口/);
  });

  it('uses exact origin/path matching in development and exact file paths in production', () => {
    const dev = createApplicationPagePolicy('http://127.0.0.1:5173/', 'C:\\app\\index.html');
    expect(dev('http://127.0.0.1:5173/')).toBe(true);
    expect(dev('http://127.0.0.1:5173.evil/')).toBe(false);
    const production = createApplicationPagePolicy(undefined, process.platform === 'win32' ? 'C:\\app\\index.html' : '/app/index.html');
    expect(production(process.platform === 'win32' ? 'file:///C:/app/index.html' : 'file:///app/index.html')).toBe(true);
  });
});

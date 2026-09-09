import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ZOOM_FACTOR, WindowZoomController, normalizeZoomFactor, stepZoomFactor } from '../../src/main-process/window-zoom';

class FakeWebContents extends EventEmitter {
  factor = 1;
  destroyed = false;

  setZoomFactor(value: number): void { this.factor = value; }
  getZoomFactor(): number { return this.factor; }
  isDestroyed(): boolean { return this.destroyed; }
}

function input(overrides: Record<string, unknown> = {}) {
  return { type: 'keyDown', control: true, alt: false, meta: false, key: '=', code: 'Equal', ...overrides };
}

describe('WindowZoomController', () => {
  it('normalizes invalid values and follows the accepted zoom steps', () => {
    expect(normalizeZoomFactor('125')).toBe(DEFAULT_ZOOM_FACTOR);
    expect(normalizeZoomFactor(0.1)).toBe(0.5);
    expect(normalizeZoomFactor(3.5)).toBe(3);
    expect(stepZoomFactor(1.25, 'out')).toBe(1.1);
    expect(stepZoomFactor(1.25, 'in')).toBe(1.5);
  });

  it('applies the configured value absolutely and persists keyboard changes', async () => {
    const webContents = new FakeWebContents();
    const patch = vi.fn(async (value: unknown) => value);
    const controller = new WindowZoomController({ patch } as never, DEFAULT_ZOOM_FACTOR);
    controller.attach({ webContents } as never);

    expect(webContents.factor).toBe(DEFAULT_ZOOM_FACTOR);
    webContents.factor = 1;
    webContents.emit('did-finish-load');
    expect(webContents.factor).toBe(DEFAULT_ZOOM_FACTOR);

    const event = { preventDefault: vi.fn() };
    webContents.emit('before-input-event', event, input({ key: '-', code: 'Minus' }));
    await new Promise((resolve) => setImmediate(resolve));
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(webContents.factor).toBe(1.1);
    expect(patch).toHaveBeenCalledWith({ zoomFactor: 1.1 });

    webContents.emit('before-input-event', event, input({ key: '0', code: 'Digit0' }));
    await new Promise((resolve) => setImmediate(resolve));
    expect(webContents.factor).toBe(DEFAULT_ZOOM_FACTOR);
    expect(patch).toHaveBeenLastCalledWith({ zoomFactor: DEFAULT_ZOOM_FACTOR });
  });
});

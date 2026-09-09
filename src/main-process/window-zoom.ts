import type { BrowserWindow } from 'electron';
import type { DataRootConfig } from './infrastructure/data-directory/data-root-config';

export const DEFAULT_ZOOM_FACTOR = 1.25;
export const MIN_ZOOM_FACTOR = 0.5;
export const MAX_ZOOM_FACTOR = 3;

const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

type ZoomConfig = Pick<DataRootConfig, 'patch'>;
type ZoomDirection = 'in' | 'out';

export function normalizeZoomFactor(value: unknown, fallback = DEFAULT_ZOOM_FACTOR): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_ZOOM_FACTOR, Math.max(MIN_ZOOM_FACTOR, Math.round(value * 100) / 100));
}

export function stepZoomFactor(current: number, direction: ZoomDirection): number {
  const value = normalizeZoomFactor(current);
  const index = ZOOM_STEPS.reduce((closest, candidate, candidateIndex) => Math.abs(candidate - value) < Math.abs(ZOOM_STEPS[closest] - value) ? candidateIndex : closest, 0);
  const next = direction === 'in' ? Math.min(index + 1, ZOOM_STEPS.length - 1) : Math.max(index - 1, 0);
  return ZOOM_STEPS[next];
}

/**
 * Keeps page zoom absolute and app-scoped. Electron's built-in per-file URL
 * zoom preference is intentionally overwritten on every load, so an old
 * packaged path cannot multiply the configured application value.
 */
export class WindowZoomController {
  private factor: number;
  private activeWindow: BrowserWindow | undefined;
  private persistQueue = Promise.resolve();

  constructor(private readonly config: ZoomConfig, initialFactor?: unknown) {
    this.factor = normalizeZoomFactor(initialFactor);
  }

  get currentFactor(): number {
    return this.factor;
  }

  attach(mainWindow: BrowserWindow): void {
    this.activeWindow = mainWindow;
    const { webContents } = mainWindow;
    const apply = () => {
      if (!webContents.isDestroyed()) webContents.setZoomFactor(this.factor);
    };
    apply();
    webContents.on('did-finish-load', apply);
    webContents.on('zoom-changed', () => {
      if (webContents.isDestroyed()) return;
      this.update(webContents.getZoomFactor());
    });
    webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return;
      const key = input.key.toLowerCase();
      const code = input.code.toLowerCase();
      if (key === '0' || code === 'digit0' || code === 'numpad0') {
        event.preventDefault();
        this.update(DEFAULT_ZOOM_FACTOR);
        return;
      }
      const direction = key === '+' || key === '=' || code === 'equal' || code === 'numpadadd' ? 'in'
        : key === '-' || key === '_' || code === 'minus' || code === 'numpadsubtract' ? 'out'
          : undefined;
      if (!direction) return;
      event.preventDefault();
      this.update(stepZoomFactor(this.factor, direction));
    });
  }

  private update(value: unknown): void {
    this.factor = normalizeZoomFactor(value, this.factor);
    const webContents = this.activeWindow?.webContents;
    if (webContents && !webContents.isDestroyed() && webContents.getZoomFactor() !== this.factor) webContents.setZoomFactor(this.factor);
    this.persistQueue = this.persistQueue
      .then(() => this.config.patch({ zoomFactor: this.factor }).then(() => undefined))
      .catch((error: unknown) => { console.error('保存界面缩放失败：', error); });
  }
}

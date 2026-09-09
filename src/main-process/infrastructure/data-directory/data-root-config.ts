import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { z } from 'zod';
import { atomicWriteUtf8 } from '../markdown/atomic-write';
import { DEFAULT_ZOOM_FACTOR } from '../../window-zoom';

const ConfigSchema = z.object({
  schemaVersion: z.literal(1),
  dataRoot: z.string().min(1),
  updateUrl: z.string().url().optional(),
  zoomFactor: z.number().finite().min(0.5).max(3).optional(),
}).strict();

export type ZhijiConfig = z.infer<typeof ConfigSchema>;

const DEFAULT_DATA_ROOT = () => path.join(app.getPath('documents'), '知己');

/** 应用级配置（数据根目录、更新地址等），独立于业务数据目录，存放在 Electron userData 下。 */
export class DataRootConfig {
  private readonly target: string;

  constructor(userDataDir = app.getPath('userData')) {
    this.target = path.join(userDataDir, 'zhiji-config.json');
  }

  async load(): Promise<ZhijiConfig> {
    try {
      const raw = await readFile(this.target, 'utf8');
      const parsed = ConfigSchema.parse(JSON.parse(raw));
      if (parsed.zoomFactor !== undefined) return parsed;
      const migrated = { ...parsed, zoomFactor: DEFAULT_ZOOM_FACTOR };
      await this.save(migrated);
      return migrated;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const fallback: ZhijiConfig = { schemaVersion: 1, dataRoot: process.env.ZHIJI_DATA_ROOT ?? DEFAULT_DATA_ROOT(), zoomFactor: DEFAULT_ZOOM_FACTOR };
    await this.save(fallback);
    return fallback;
  }

  async save(config: ZhijiConfig): Promise<void> {
    const validated = ConfigSchema.parse(config);
    await atomicWriteUtf8(this.target, `${JSON.stringify(validated, null, 2)}\n`, (value) => ConfigSchema.parse(JSON.parse(value)));
  }

  /** 仅更新部分字段；值为 undefined 时删除该字段。 */
  async patch(patch: Partial<ZhijiConfig>): Promise<ZhijiConfig> {
    const current = await this.load();
    const merged: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete merged[key];
      else merged[key] = value;
    }
    const next = ConfigSchema.parse(merged);
    await this.save(next);
    return next;
  }
}

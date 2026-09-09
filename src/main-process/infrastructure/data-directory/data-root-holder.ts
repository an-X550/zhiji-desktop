import path from 'node:path';
import { access, constants, cp, lstat, readdir, realpath, stat } from 'node:fs/promises';
import { appError } from '../../../shared/errors/app-error';
import { MaintenanceCoordinator } from '../lifecycle/maintenance-coordinator';
import type { DataRootConfig } from './data-root-config';

type DirectoryOperation = (source: string, target: string) => Promise<void>;

export interface DataRootHolderOptions {
  /** 仅用于故障路径测试；生产默认使用本文件底部的实现。 */
  copyDirectoryContents?: DirectoryOperation;
  /** 仅用于故障路径测试；生产默认使用本文件底部的实现。 */
  assertSameFileSet?: DirectoryOperation;
}

/**
 * 运行期数据根目录持有者：bootstrap 读一次后注入各仓储；
 * changeLocation 在运行期完成停写、复制/校验和配置更新；成功后当前进程进入只读，
 * 因为既有仓储和 Utility 已绑定旧路径，必须重启后才可继续写入。
 */
export class DataRootHolder {
  private current: string;
  constructor(
    private readonly config: DataRootConfig,
    initial: string,
    private readonly maintenance: MaintenanceCoordinator = new MaintenanceCoordinator(),
    private readonly options: DataRootHolderOptions = {},
  ) { this.current = path.resolve(initial); }

  get(): string { return this.current; }

  async changeLocation(target: string, options: { move: boolean }): Promise<{ moved: boolean; from: string; to: string }> {
    return this.maintenance.runMaintenance(() => this.changeLocationStopped(target, options), { keepReadOnly: true });
  }

  private async changeLocationStopped(target: string, options: { move: boolean }): Promise<{ moved: boolean; from: string; to: string }> {
    const normalized = path.resolve(target);
    const current = path.resolve(this.current);
    if (normalized === current) throw appError({ code: 'INVALID_INPUT', message: '新位置与当前位置相同。' });
    await access(normalized, constants.W_OK).catch(() => { throw appError({ code: 'INVALID_INPUT', message: '目标位置不可写，请选择其他文件夹。' }); });
    const targetStat = await lstat(normalized).catch(() => undefined);
    if (!targetStat?.isDirectory() || targetStat.isSymbolicLink()) throw appError({ code: 'INVALID_INPUT', message: '目标位置必须是实际存在的本地文件夹。' });

    const currentReal = await realpath(current).catch(() => current);
    const targetReal = await realpath(normalized);
    if (targetReal === currentReal || targetReal.startsWith(`${currentReal}${path.sep}`) || currentReal.startsWith(`${targetReal}${path.sep}`)) {
      throw appError({ code: 'INVALID_INPUT', message: '目标位置不能与当前数据目录重叠。' });
    }
    const existing = await readdir(normalized);
    if (existing.some((name) => name !== '.DS_Store')) throw appError({ code: 'INVALID_INPUT', message: '目标文件夹非空，请选择空文件夹以避免覆盖。' });

    let moved = false;
    if (options.move) {
      try {
        await (this.options.copyDirectoryContents ?? copyDirectoryContents)(current, normalized);
        await (this.options.assertSameFileSet ?? assertSameFileSet)(current, normalized);
      } catch (error) {
        throw appError({ code: 'UNKNOWN', message: `迁移失败，原数据未受影响：${error instanceof Error ? error.message : '请稍后重试'}` });
      }
      moved = true;
    }
    await this.config.patch({ dataRoot: normalized });
    return { moved, from: current, to: normalized };
  }
}

async function copyDirectoryContents(source: string, target: string): Promise<void> {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    await cp(path.join(source, entry.name), path.join(target, entry.name), {
      recursive: true,
      force: false,
      errorOnExist: true,
      preserveTimestamps: true,
    });
  }
}

async function assertSameFileSet(source: string, target: string): Promise<void> {
  const collect = async (root: string): Promise<Map<string, number>> => {
    const files = new Map<string, number>();
    const walk = async (folder: string, prefix: string): Promise<void> => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        if (entry.name === '.DS_Store') continue;
        const relative = prefix ? path.join(prefix, entry.name) : entry.name;
        const targetPath = path.join(folder, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`symbolic link: ${relative}`);
        if (entry.isDirectory()) await walk(targetPath, relative);
        else if (entry.isFile()) files.set(relative, (await stat(targetPath)).size);
      }
    };
    await walk(root, '');
    return files;
  };
  const [sourceFiles, targetFiles] = await Promise.all([collect(source), collect(target)]);
  if (sourceFiles.size !== targetFiles.size) throw new Error('copied file count does not match');
  for (const [file, size] of sourceFiles) if (targetFiles.get(file) !== size) throw new Error(`copied file does not match: ${file}`);
}

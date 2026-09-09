import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    // Squirrel extraction can corrupt Chinese executable names on Windows;
    // keep the installed process path ASCII-stable across releases.
    executableName: 'zhiji',
    asar: {
      // Koffi is used by DSH's Windows durable JSONL publisher and loads a
      // native .node binary; native modules cannot be dlopen'ed from asar.
      unpack: '**/*.node',
    },
    appBundleId: 'com.zhiji.desktop',
    // The Vite plugin normally excludes every node_modules entry because
    // application dependencies are bundled. DSH must stay external so its
    // package-relative package.json lookup remains valid, therefore keep the
    // DSH runtime and its small set of external runtime dependencies in asar.
    ignore: (file) => {
      if (!file) return false;
      const normalized = file.replace(/\\/g, '/').toLowerCase();
      const keptPaths = [
        '/.vite',
        '/node_modules/@deepseek-ai',
        // Keep the declared provider package visible in app.asar as well as
        // bundling its hot path into the Main Process Vite output.
        '/node_modules/@tavily',
        // DSH packages are externalized and import these non-DSH runtime
        // dependencies from their own ESM entry points.
        '/node_modules/@standard-schema',
        '/node_modules/zod',
        '/node_modules/koffi',
        '/node_modules/@koromix',
      ];
      const kept =
        normalized === '/' ||
        normalized === '/resources' ||
        normalized.endsWith('/resources') ||
        normalized === '/resources/app' ||
        normalized.endsWith('/resources/app') ||
        normalized === '/node_modules' ||
        normalized.endsWith('/resources/app/node_modules') ||
        normalized.endsWith('/node_modules') ||
        normalized === '/package.json' ||
        normalized.endsWith('/resources/app/package.json') ||
        keptPaths.some(
          (path) =>
            normalized === path ||
            normalized.endsWith(path) ||
            normalized.includes(`${path}/`),
        );
      return !kept;
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({ name: 'zhiji', setupIcon: undefined }),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
        {
          entry: 'src/main-process/agent/utility.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;

import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { createWindowOptions } from './main-process/window-options';
import { bootstrap } from './main-process/bootstrap';
import type { AgentFacade } from './main-process/agent/agent-facade';
import { createApplicationPagePolicy, IpcSourceGuard } from './main-process/ipc/ipc-source-guard';
import { WindowZoomController } from './main-process/window-zoom';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
const pagePolicy = createApplicationPagePolicy(MAIN_WINDOW_VITE_DEV_SERVER_URL, path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
const sourceGuard = new IpcSourceGuard(pagePolicy);
let windowZoomController: WindowZoomController | undefined;

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow(
    createWindowOptions(path.join(__dirname, 'preload.js')),
  );
  windowZoomController?.attach(mainWindow);
  sourceGuard.registerWindow(mainWindow);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => { if (!pagePolicy(url)) event.preventDefault(); });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

};

app.on('second-instance', () => {
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

let agentFacade: AgentFacade | undefined;

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', async () => {
  const bootstrapped = await bootstrap(sourceGuard);
  agentFacade = bootstrapped.agentFacade;
  windowZoomController = new WindowZoomController(bootstrapped.config, bootstrapped.zoomFactor);
  createWindow();
});

app.on('before-quit', () => { void agentFacade?.dispose(); });

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

}

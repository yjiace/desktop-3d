const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } = require('electron');
const path = require('path');
let Store;
let store;

(async () => {
  Store = (await import('electron-store')).default;
  store = new Store();
})();

let mainWindow;
let tray;
let settingsWindow = null;

// 简单防抖函数
function debounce(fn, delay) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

const saveWindowBounds = () => {
  if (mainWindow) {
    const bounds = mainWindow.getBounds();
    store.set('windowBounds', bounds);
  }
};

const debouncedSaveWindowBounds = debounce(saveWindowBounds, 300);

function createWindow() {
  const windowBounds = store.get('windowBounds') || { width: 300, height: 400 };

  mainWindow = new BrowserWindow({
    x: windowBounds.x,
    y: windowBounds.y,
    width: windowBounds.width,
    height: windowBounds.height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), // a preload script is good practice
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

  mainWindow.on('close', () => {
    saveWindowBounds(); // 关闭时强制保存一次
  });

  mainWindow.on('move', debouncedSaveWindowBounds);
  mainWindow.on('resize', debouncedSaveWindowBounds);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 600,
    height: 420,
    resizable: true,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    frame: false,
    transparent: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  settingsWindow.loadFile(path.join(__dirname, 'renderer/settings.html'));
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

ipcMain.on('show-context-menu', (event) => {
  const menu = Menu.buildFromTemplate([
    { label: '设置', click: () => createSettingsWindow() },
    { label: '退出', click: () => app.quit() },
  ]);
  menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
});

ipcMain.on('close-settings', () => {
  if (settingsWindow) settingsWindow.close();
});

ipcMain.on('save-setting', async (event, key, value) => {
  if (!store) {
    Store = (await import('electron-store')).default;
    store = new Store();
  }
  store.set(key, value);
});

ipcMain.handle('get-setting', async (event, key) => {
  if (!store) {
    Store = (await import('electron-store')).default;
    store = new Store();
  }
  return store.get(key);
});

app.on('ready', async () => {
  if (!store) {
    Store = (await import('electron-store')).default;
    store = new Store();
  }
  createWindow();

  // 托盘菜单
  const iconPath = path.join(__dirname, '../assets/icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);
  const contextMenu = Menu.buildFromTemplate([
    { label: '设置', click: () => createSettingsWindow() },
    { label: '退出', click: () => app.quit() },
  ]);
  tray.setToolTip('桌面3D伙伴');
  tray.setContextMenu(contextMenu);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
}); 
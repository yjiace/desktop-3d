const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
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

// 确保窗口位置在屏幕边界内
function ensureWindowInBounds(bounds) {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  
  let { x, y, width, height } = bounds;
  
  // 确保窗口不会超出屏幕边界
  if (x === undefined || x < 0) x = 50;
  if (y === undefined || y < 0) y = 50;
  if (x + width > screenWidth) x = screenWidth - width - 20;
  if (y + height > screenHeight) y = screenHeight - height - 20;
  
  return { x, y, width, height };
}

const saveWindowBounds = () => {
  if (mainWindow) {
    const bounds = mainWindow.getBounds();
    store.set('windowBounds', bounds);
  }
};

const saveSettingsWindowBounds = () => {
  if (settingsWindow) {
    const bounds = settingsWindow.getBounds();
    store.set('settingsWindowBounds', bounds);
  }
};

const debouncedSaveWindowBounds = debounce(saveWindowBounds, 300);
const debouncedSaveSettingsWindowBounds = debounce(saveSettingsWindowBounds, 300);

function createWindow() {
  const windowBounds = store.get('windowBounds') || { width: 300, height: 400 };
  const safeBounds = ensureWindowInBounds(windowBounds);

  mainWindow = new BrowserWindow({
    x: safeBounds.x,
    y: safeBounds.y,
    width: safeBounds.width,
    height: safeBounds.height,
    transparent: true,
    frame: false,
    alwaysOnTop: false,
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
  
  // 获取保存的设置窗口位置和大小
  const settingsWindowBounds = store.get('settingsWindowBounds') || { 
    width: 600, 
    height: 420,
    x: undefined,
    y: undefined
  };
  
  const safeBounds = ensureWindowInBounds(settingsWindowBounds);

  settingsWindow = new BrowserWindow({
    x: safeBounds.x,
    y: safeBounds.y,
    width: safeBounds.width,
    height: safeBounds.height,
    resizable: true,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: false,
    frame: false,
    transparent: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  
  settingsWindow.loadFile(path.join(__dirname, 'renderer/settings.html'));
  
  settingsWindow.on('close', () => {
    saveSettingsWindowBounds(); // 关闭时强制保存一次
  });

  settingsWindow.on('move', debouncedSaveSettingsWindowBounds);
  settingsWindow.on('resize', debouncedSaveSettingsWindowBounds);
  
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

// --- 新增：文件操作 ---

// 将用户选择的文件复制到应用的 assets 目录
ipcMain.handle('copy-to-assets', async (event, sourcePath) => {
  if (!sourcePath) throw new Error('Source path is required.');

  const assetsDir = path.join(path.dirname(app.getAppPath()), 'assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  const fileName = `custom-${Date.now()}-${path.basename(sourcePath)}`;
  const destPath = path.join(assetsDir, fileName);

  try {
    fs.copyFileSync(sourcePath, destPath);
    // 返回一个渲染进程可以使用的、相对于 index.html 的路径
    return `../../assets/${fileName}`;
  } catch (err) {
    console.error('Failed to copy file:', err);
    throw err;
  }
});

// 从应用的 assets 目录删除文件
ipcMain.handle('delete-from-assets', async (event, rendererRelativePath) => {
  if (!rendererRelativePath) throw new Error('Relative path is required.');

  try {
    // 将渲染器相对路径 (../../assets/file.vrm) 转换为绝对路径
    const absolutePath = path.resolve(__dirname, 'renderer', rendererRelativePath);
    
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
      return { success: true, path: absolutePath };
    } else {
      console.warn(`Attempted to delete non-existent file: ${absolutePath}`);
      return { success: false, error: 'File not found', path: absolutePath };
    }
  } catch (err) {
    console.error('Failed to delete file:', err);
    throw err;
  }
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

// 读取默认配置
function getDefaultConfig() {
  const configPath = path.join(__dirname, 'renderer/config.default.json');
  const raw = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(raw);
}

// 初始化配置到数据库
async function initConfig() {
  if (!store) {
    Store = (await import('electron-store')).default;
    store = new Store();
  }
  const currentConfig = store.get('config');
  const defaultConfig = getDefaultConfig();

  // 如果没有配置，或者存储的模型是旧的、不正确的默认路径，则重置为默认配置
  if (!currentConfig || currentConfig.modelPath === 'assets/default.vrm') {
    store.set('config', defaultConfig);
  }
}

ipcMain.handle('get-config', async () => {
  if (!store) {
    Store = (await import('electron-store')).default;
    store = new Store();
  }
  return store.get('config');
});

ipcMain.on('set-config', async (event, config) => {
  if (!store) {
    Store = (await import('electron-store')).default;
    store = new Store();
  }
  store.set('config', config);
  // 通知主窗口刷新
  if (mainWindow) mainWindow.webContents.send('config-updated', config);
});

// 新增：保存3D模型状态
ipcMain.on('save-model-state', async (event, modelState) => {
  if (!store) {
    Store = (await import('electron-store')).default;
    store = new Store();
  }
  const currentConfig = store.get('config') || getDefaultConfig();
  currentConfig.modelState = modelState;
  store.set('config', currentConfig);
});

// 新增：获取3D模型状态
ipcMain.handle('get-model-state', async () => {
  if (!store) {
    Store = (await import('electron-store')).default;
    store = new Store();
  }
  const config = store.get('config');
  return config?.modelState || getDefaultConfig().modelState;
});

ipcMain.on('reset-config', async (event) => {
  const def = getDefaultConfig();
  if (!store) {
    Store = (await import('electron-store')).default;
    store = new Store();
  }
  store.set('config', def);
  // 通知主窗口刷新
  if (mainWindow) mainWindow.webContents.send('config-updated', def);
});

// 监听渲染进程置顶切换请求
ipcMain.on('toggle-always-on-top', (event, isTop) => {
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(!!isTop);
  }
});

app.on('ready', async () => {
  if (!store) {
    Store = (await import('electron-store')).default;
    store = new Store();
  }
  await initConfig();
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
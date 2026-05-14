const { app, BrowserWindow, Tray, Menu, clipboard, nativeImage, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

const APP_DATA_ROOT = 'E:\\AppDataCaches';
const APP_DATA_DIR = path.join(APP_DATA_ROOT, 'clipboard-history');
const APP_CACHE_DIR = path.join(APP_DATA_DIR, 'cache');

ensureDirectory(APP_DATA_ROOT);
ensureDirectory(APP_DATA_DIR);
ensureDirectory(APP_CACHE_DIR);

app.setPath('userData', APP_DATA_DIR);
app.setPath('sessionData', APP_CACHE_DIR);
app.setPath('temp', path.join(APP_CACHE_DIR, 'temp'));

const store = new Store({
  cwd: APP_DATA_DIR,
  name: 'clipboard-history'
});

let mainWindow = null;
let tray = null;
let clipboardHistory = [];
let lastClipboardContent = '';
let clipboardWatcher = null;

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function resolveAppIcon() {
  if (process.platform === 'darwin') {
    return path.join(__dirname, 'build', 'icon.png');
  }

  return path.join(__dirname, 'build', 'icon.ico');
}

function getDefaultSettings() {
  return {
    retentionDays: 3,
    maxItems: 100
  };
}

if (!store.get('settings')) {
  store.set('settings', getDefaultSettings());
}

function loadHistory() {
  clipboardHistory = store.get('history', []);
  cleanOldItems();
}

function saveHistory() {
  store.set('history', clipboardHistory);
}

function cleanOldItems() {
  const settings = store.get('settings', getDefaultSettings());
  const retentionMs = settings.retentionDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  clipboardHistory = clipboardHistory.filter((item) => (now - item.timestamp) < retentionMs);

  if (clipboardHistory.length > settings.maxItems) {
    clipboardHistory = clipboardHistory.slice(0, settings.maxItems);
  }

  saveHistory();
}

function sortHistory() {
  clipboardHistory.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.timestamp - a.timestamp;
  });
}

function notifyHistoryUpdated() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('history-updated', clipboardHistory);
  }
}

function startClipboardWatcher() {
  clipboardWatcher = setInterval(() => {
    try {
      const text = clipboard.readText();
      const image = clipboard.readImage();
      const hasText = Boolean(text && text.trim().length > 0);
      const hasImage = Boolean(image && !image.isEmpty());

      let newItem = null;

      if (hasImage) {
        const imageData = image.toDataURL();
        if (imageData !== lastClipboardContent) {
          newItem = {
            id: Date.now().toString(),
            type: 'image',
            content: imageData,
            timestamp: Date.now(),
            pinned: false
          };
          lastClipboardContent = imageData;
        }
      } else if (hasText && text !== lastClipboardContent) {
        newItem = {
          id: Date.now().toString(),
          type: 'text',
          content: text,
          timestamp: Date.now(),
          pinned: false
        };
        lastClipboardContent = text;
      }

      if (!newItem) {
        return;
      }

      const existingIndex = clipboardHistory.findIndex(
        (item) => item.type === newItem.type && item.content === newItem.content
      );

      if (existingIndex !== -1) {
        clipboardHistory[existingIndex].timestamp = newItem.timestamp;
      } else {
        clipboardHistory.unshift(newItem);
      }

      sortHistory();
      cleanOldItems();
      notifyHistoryUpdated();
    } catch (error) {
      console.error('Clipboard watch error:', error);
    }
  }, 500);
}

function stopClipboardWatcher() {
  if (clipboardWatcher) {
    clearInterval(clipboardWatcher);
    clipboardWatcher = null;
  }
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: resolveAppIcon()
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  tray = new Tray(resolveAppIcon());

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开',
      click: () => createWindow()
    },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('历史剪贴板');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => createWindow());
}

ipcMain.handle('get-history', () => clipboardHistory);
ipcMain.handle('get-settings', () => store.get('settings', getDefaultSettings()));

ipcMain.handle('save-settings', (event, settings) => {
  store.set('settings', settings);
  cleanOldItems();
  notifyHistoryUpdated();
  return true;
});

ipcMain.handle('copy-item', (event, item) => {
  try {
    if (item.type === 'text') {
      clipboard.writeText(item.content);
    } else if (item.type === 'image') {
      clipboard.writeImage(nativeImage.createFromDataURL(item.content));
    }

    lastClipboardContent = item.content;
    return true;
  } catch (error) {
    console.error('Copy item failed:', error);
    return false;
  }
});

ipcMain.handle('delete-item', (event, id) => {
  clipboardHistory = clipboardHistory.filter((item) => item.id !== id);
  saveHistory();
  return clipboardHistory;
});

ipcMain.handle('pin-item', (event, id) => {
  const item = clipboardHistory.find((entry) => entry.id === id);
  if (item) {
    item.pinned = !item.pinned;
    sortHistory();
    saveHistory();
  }
  return clipboardHistory;
});

ipcMain.handle('clear-all', () => {
  clipboardHistory = [];
  saveHistory();
  return clipboardHistory;
});

app.whenReady().then(() => {
  loadHistory();
  createTray();
  startClipboardWatcher();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});

app.on('before-quit', () => {
  stopClipboardWatcher();
  saveHistory();
});

const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

function createWindow() {
  const win = new BrowserWindow({
    title: 'Heft Studio', width: 1600, height: 960, minWidth: 1100, minHeight: 700, backgroundColor: '#191919',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  if (process.argv.includes('--dev')) win.loadURL(process.env.HEFT_STUDIO_URL || 'http://localhost:5190');
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}

// Project files on disk: the renderer only ever gets paths the user picked in a native dialog.
const picked = new Set();
ipcMain.handle('file:save-as', async (_e, name, bytes) => {
  const r = await dialog.showSaveDialog({ defaultPath: name });
  if (r.canceled || !r.filePath) return null;
  await fs.writeFile(r.filePath, Buffer.from(bytes)); picked.add(r.filePath); return r.filePath;
});
ipcMain.handle('file:save', async (_e, file, bytes) => {
  if (!picked.has(file)) throw new Error('path was not chosen by the user');
  const tmp = file + '.tmp'; await fs.writeFile(tmp, Buffer.from(bytes)); await fs.rename(tmp, file); return file;
});
ipcMain.handle('file:open', async (_e, filters) => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters });
  if (r.canceled || !r.filePaths[0]) return null;
  picked.add(r.filePaths[0]);
  return { path: r.filePaths[0], bytes: await fs.readFile(r.filePaths[0]) };
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

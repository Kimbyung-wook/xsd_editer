import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IPC_OPEN_XSD_DIALOG, IPC_READ_TEXT_FILE, IPC_RESOLVE_IMPORT_PATH, IPC_WRITE_TEXT_FILE } from "./ipcChannels.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (DEV_SERVER_URL) {
    win.loadURL(DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

ipcMain.handle(IPC_OPEN_XSD_DIALOG, async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "XSD Schema", extensions: ["xsd"] }]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true as const };
  }
  return { canceled: false as const, filePath: result.filePaths[0] };
});

ipcMain.handle(IPC_READ_TEXT_FILE, async (_event, filePath: string) => {
  return readFile(filePath, "utf-8");
});

ipcMain.handle(IPC_RESOLVE_IMPORT_PATH, (_event, fromFilePath: string, href: string) => {
  return path.resolve(path.dirname(fromFilePath), href);
});

ipcMain.handle(IPC_WRITE_TEXT_FILE, async (_event, filePath: string, contents: string) => {
  await writeFile(filePath, contents, "utf-8");
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

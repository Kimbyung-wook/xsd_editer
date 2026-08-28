import { contextBridge, ipcRenderer } from "electron";
import { IPC_OPEN_XSD_DIALOG, IPC_READ_TEXT_FILE, IPC_RESOLVE_IMPORT_PATH, IPC_WRITE_TEXT_FILE } from "./ipcChannels.js";

export interface XsdFileApi {
  openXsdDialog(): Promise<{ canceled: true } | { canceled: false; filePath: string }>;
  readTextFile(filePath: string): Promise<string>;
  resolveImportPath(fromFilePath: string, href: string): Promise<string>;
  writeTextFile(filePath: string, contents: string): Promise<void>;
}

const api: XsdFileApi = {
  openXsdDialog: () => ipcRenderer.invoke(IPC_OPEN_XSD_DIALOG),
  readTextFile: (filePath) => ipcRenderer.invoke(IPC_READ_TEXT_FILE, filePath),
  resolveImportPath: (fromFilePath, href) => ipcRenderer.invoke(IPC_RESOLVE_IMPORT_PATH, fromFilePath, href),
  writeTextFile: (filePath, contents) => ipcRenderer.invoke(IPC_WRITE_TEXT_FILE, filePath, contents)
};

/**
 * File I/O surface exposed to the renderer, kept to exactly what multi-file XSD loading/saving
 * needs (see docs/PLAN.md "다중 파일 병합 범위") — no generic fs/path access, per Electron's
 * contextIsolation security guidance.
 */
contextBridge.exposeInMainWorld("api", api);

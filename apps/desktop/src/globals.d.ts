export {};

/**
 * Mirrors electron/preload.ts's exposed API shape. Kept as a separate declaration (rather than
 * importing electron/preload.ts directly) since the renderer and electron/ compile as separate
 * TypeScript programs with different lib targets (see tsconfig.json vs electron/tsconfig.json).
 */
export interface XsdFileApi {
  openXsdDialog(): Promise<{ canceled: true } | { canceled: false; filePath: string }>;
  readTextFile(filePath: string): Promise<string>;
  resolveImportPath(fromFilePath: string, href: string): Promise<string>;
  writeTextFile(filePath: string, contents: string): Promise<void>;
  openDirectoryDialog(): Promise<{ canceled: true } | { canceled: false; dirPath: string }>;
  joinPath(dirPath: string, fileName: string): Promise<string>;
}

declare global {
  interface Window {
    /** Present only when running inside the Electron shell; undefined in a plain browser tab. */
    api?: XsdFileApi;
  }
}

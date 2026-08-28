import { create } from "zustand";
import {
  SchemaModel,
  validateModel,
  type Command,
  type Diagnostic,
  type DocumentSource,
  type NodeId,
  type SchemaNode,
  type SchemaSet
} from "@xsd-visualizer/core";
import type { ParseRequest, ParseResponse } from "../workers/parseWorker.js";
import type { SerializeRequest, SerializeResponse } from "../workers/serializeWorker.js";
import { collectDocuments } from "./collectDocuments.js";

interface SchemaStoreState {
  model: SchemaModel;
  /** Bumped on every mutation of `model` (SchemaModel mutates in place) so selectors relying on
   *  it re-render even though the `model` object reference itself doesn't change. */
  revision: number;
  /** The exact file(s) read at load time — kept immutable for the session so every Save re-patches
   *  from this same baseline using the current (cumulative) model. Re-patching from THIS fixed
   *  baseline each time — rather than advancing it to the last-saved output — keeps every model
   *  node's `sourceRef.path` valid no matter how many times Save has run (see docs/PLAN.md). */
  originalDocuments: DocumentSource[];
  selectedNodeId: NodeId | null;
  diagnostics: Diagnostic[];
  undoStack: Command[];
  redoStack: Command[];
  isDirty: boolean;
  isLoading: boolean;
  isSaving: boolean;
  loadError: string | null;
  saveError: string | null;
  select: (nodeId: NodeId | null) => void;
  dispatch: (command: Command) => void;
  undo: () => void;
  redo: () => void;
  /** Browser fallback (no Electron file-system access) — single file, no import/include resolution. */
  loadFile: (file: File) => Promise<void>;
  /** Real Electron path — opens the native dialog, resolves xs:import/xs:include across files. */
  openViaDialog: () => Promise<void>;
  /** Writes the current model back to disk (Electron) or triggers a download (browser fallback). */
  save: () => Promise<void>;
}

function reviveModel(nodes: SchemaNode[], schemaSet: SchemaSet): SchemaModel {
  const model = new SchemaModel();
  for (const node of nodes) {
    model.addNode(node);
  }
  model.setSchemaSet(schemaSet);
  return model;
}

function parseInWorker(request: ParseRequest): Promise<{ model: SchemaModel }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/parseWorker.ts", import.meta.url), { type: "module" });

    worker.onmessage = (event: MessageEvent<ParseResponse>) => {
      worker.terminate();
      if (event.data.ok) {
        resolve({ model: reviveModel(event.data.nodes, event.data.schemaSet) });
      } else {
        reject(new Error(event.data.error));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage(request);
  });
}

function serializeInWorker(request: SerializeRequest): Promise<DocumentSource[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/serializeWorker.ts", import.meta.url), { type: "module" });

    worker.onmessage = (event: MessageEvent<SerializeResponse>) => {
      worker.terminate();
      if (event.data.ok) {
        resolve(event.data.documents);
      } else {
        reject(new Error(event.data.error));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage(request);
  });
}

function triggerBrowserDownload(filePath: string, xml: string): void {
  const filename = filePath.split(/[/\\]/).pop() ?? "schema.xsd";
  const blob = new Blob([xml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Single source of truth for the loaded schema. Every edit is dispatched as a Command
 * (see docs/PLAN.md 데이터 흐름 / 상태관리) so undo/redo is a stack of commands rather than
 * full-model snapshots. Validation re-runs in full after every dispatch — benchmarked at
 * ~24ms on the 8MB/150k-line target schema (packages/core/scripts/bench-large-schema.mjs),
 * fast enough that a true incremental validator isn't needed yet.
 */
export const useSchemaStore = create<SchemaStoreState>((set, get) => ({
  model: new SchemaModel(),
  revision: 0,
  originalDocuments: [],
  selectedNodeId: null,
  diagnostics: [],
  undoStack: [],
  redoStack: [],
  isDirty: false,
  isLoading: false,
  isSaving: false,
  loadError: null,
  saveError: null,
  select: (nodeId) => set({ selectedNodeId: nodeId }),
  dispatch: (command) => {
    const { model } = get();
    command.apply(model);
    set((state) => ({
      revision: state.revision + 1,
      undoStack: [...state.undoStack, command],
      redoStack: [],
      diagnostics: validateModel(model),
      isDirty: true
    }));
  },
  undo: () => {
    const { model, undoStack } = get();
    const command = undoStack[undoStack.length - 1];
    if (!command) return;
    command.invert().apply(model);
    set((state) => ({
      revision: state.revision + 1,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, command],
      diagnostics: validateModel(model)
    }));
  },
  redo: () => {
    const { model, redoStack } = get();
    const command = redoStack[redoStack.length - 1];
    if (!command) return;
    command.apply(model);
    set((state) => ({
      revision: state.revision + 1,
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, command],
      diagnostics: validateModel(model)
    }));
  },
  loadFile: async (file) => {
    set({ isLoading: true, loadError: null });
    try {
      const xml = await file.text();
      const documents: DocumentSource[] = [{ fileId: file.name, filePath: file.name, xml }];
      const { model } = await parseInWorker({ documents });
      set({
        model,
        revision: 0,
        originalDocuments: documents,
        selectedNodeId: null,
        undoStack: [],
        redoStack: [],
        diagnostics: validateModel(model),
        isDirty: false,
        isLoading: false
      });
    } catch (error) {
      set({ isLoading: false, loadError: error instanceof Error ? error.message : String(error) });
    }
  },
  openViaDialog: async () => {
    if (!window.api) {
      set({ loadError: "Electron file API를 사용할 수 없습니다 (브라우저 탭에서는 Open XSD 버튼으로 파일을 선택하세요)." });
      return;
    }
    const dialogResult = await window.api.openXsdDialog();
    if (dialogResult.canceled) return;

    set({ isLoading: true, loadError: null });
    try {
      const documents = await collectDocuments(dialogResult.filePath, window.api);
      const { model } = await parseInWorker({ documents });
      set({
        model,
        revision: 0,
        originalDocuments: documents,
        selectedNodeId: null,
        undoStack: [],
        redoStack: [],
        diagnostics: validateModel(model),
        isDirty: false,
        isLoading: false
      });
    } catch (error) {
      set({ isLoading: false, loadError: error instanceof Error ? error.message : String(error) });
    }
  },
  save: async () => {
    const { model, originalDocuments } = get();
    const schemaSet = model.getSchemaSet();
    if (originalDocuments.length === 0 || !schemaSet) return;

    set({ isSaving: true, saveError: null });
    try {
      const documents = await serializeInWorker({
        documents: originalDocuments,
        nodes: [...model.allNodes()],
        schemaSet
      });
      if (window.api) {
        for (const doc of documents) {
          await window.api.writeTextFile(doc.filePath, doc.xml);
        }
      } else {
        triggerBrowserDownload(documents[0].filePath, documents[0].xml);
      }
      set({ isSaving: false, isDirty: false });
    } catch (error) {
      set({ isSaving: false, saveError: error instanceof Error ? error.message : String(error) });
    }
  }
}));

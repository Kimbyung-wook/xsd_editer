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
import { collectDocuments } from "./collectDocuments.js";

interface SchemaStoreState {
  model: SchemaModel;
  /** Bumped on every mutation of `model` (SchemaModel mutates in place) so selectors relying on
   *  it re-render even though the `model` object reference itself doesn't change. */
  revision: number;
  selectedNodeId: NodeId | null;
  diagnostics: Diagnostic[];
  undoStack: Command[];
  redoStack: Command[];
  isDirty: boolean;
  isLoading: boolean;
  loadError: string | null;
  select: (nodeId: NodeId | null) => void;
  dispatch: (command: Command) => void;
  undo: () => void;
  redo: () => void;
  /** Browser fallback (no Electron file-system access) — single file, no import/include resolution. */
  loadFile: (file: File) => Promise<void>;
  /** Real Electron path — opens the native dialog, resolves xs:import/xs:include across files. */
  openViaDialog: () => Promise<void>;
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
  selectedNodeId: null,
  diagnostics: [],
  undoStack: [],
  redoStack: [],
  isDirty: false,
  isLoading: false,
  loadError: null,
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
  }
}));

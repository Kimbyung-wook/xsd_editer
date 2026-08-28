import { useEffect, useRef } from "react";
import { useSchemaStore } from "../../state/schemaStore.js";

export function Toolbar() {
  const loadFile = useSchemaStore((state) => state.loadFile);
  const openViaDialog = useSchemaStore((state) => state.openViaDialog);
  const isLoading = useSchemaStore((state) => state.isLoading);
  const undo = useSchemaStore((state) => state.undo);
  const redo = useSchemaStore((state) => state.redo);
  const canUndo = useSchemaStore((state) => state.undoStack.length > 0);
  const canRedo = useSchemaStore((state) => state.redoStack.length > 0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasElectronApi = typeof window !== "undefined" && !!window.api;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const meta = event.ctrlKey || event.metaKey;
      if (!meta || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      if (event.shiftKey) {
        redo();
      } else {
        undo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  return (
    <header className="toolbar">
      <span className="toolbar__title">XSD Visualizer</span>
      <div className="toolbar__actions">
        <input
          ref={fileInputRef}
          type="file"
          accept=".xsd"
          className="toolbar__file-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void loadFile(file);
            event.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={isLoading}
          onClick={() => (hasElectronApi ? void openViaDialog() : fileInputRef.current?.click())}
        >
          {isLoading ? "로딩 중..." : "Open XSD"}
        </button>
        <button type="button" disabled title="Phase 4에서 연결">Save</button>
        <button type="button" disabled={!canUndo} onClick={undo} title="Ctrl+Z">Undo</button>
        <button type="button" disabled={!canRedo} onClick={redo} title="Ctrl+Shift+Z">Redo</button>
        <button type="button" disabled title="Phase 5에서 연결">Generate Code</button>
      </div>
    </header>
  );
}

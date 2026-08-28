import { useSchemaStore } from "../../state/schemaStore.js";

const SEVERITY_ICON: Record<string, string> = { error: "🛑", warning: "⚠️", info: "ℹ️" };

export function ValidationPanel() {
  const diagnostics = useSchemaStore((state) => state.diagnostics);
  const select = useSchemaStore((state) => state.select);

  return (
    <div className="panel panel--validation">
      <div className="panel__header">검증 / 진단 {diagnostics.length > 0 && `(${diagnostics.length})`}</div>
      <div className="panel__body panel__body--diagnostics">
        {diagnostics.length === 0 && <div className="panel__body--empty">진단 항목 없음</div>}
        {diagnostics.map((d, i) => (
          <div
            key={i}
            className="diagnostic-row"
            onClick={() => d.nodeId && select(d.nodeId)}
            style={{ cursor: d.nodeId ? "pointer" : "default" }}
          >
            <span>{SEVERITY_ICON[d.severity] ?? ""}</span>
            <span className="diagnostic-row__code">{d.code}</span>
            <span>{d.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

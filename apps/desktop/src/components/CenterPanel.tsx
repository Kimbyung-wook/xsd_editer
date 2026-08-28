import { useState } from "react";
import { GraphView } from "./GraphView/GraphView.js";
import { LocalDiagram } from "./LocalDiagram/LocalDiagram.js";

type CenterTab = "diagram" | "graph" | "source";

const TABS: { id: CenterTab; label: string }[] = [
  { id: "diagram", label: "다이어그램" },
  { id: "graph", label: "참조 그래프" },
  { id: "source", label: "XML 소스" }
];

export function CenterPanel() {
  const [activeTab, setActiveTab] = useState<CenterTab>("diagram");

  return (
    <div className="panel panel--center">
      <div className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={tab.id === activeTab ? "tabs__tab tabs__tab--active" : "tabs__tab"}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab === "diagram" && <LocalDiagram />}
      {activeTab === "graph" && <GraphView />}
      {activeTab === "source" && (
        <div className="panel__body panel__body--empty">XML 소스 뷰 (Phase 2, Monaco 연동)</div>
      )}
    </div>
  );
}

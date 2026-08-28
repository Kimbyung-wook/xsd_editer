import { Toolbar } from "./components/Toolbar/Toolbar.js";
import { TreeView } from "./components/TreeView/TreeView.js";
import { CenterPanel } from "./components/CenterPanel.js";
import { PropertyPanel } from "./components/PropertyPanel/PropertyPanel.js";
import { ValidationPanel } from "./components/ValidationPanel/ValidationPanel.js";

export function App() {
  return (
    <div className="app-shell">
      <Toolbar />
      <div className="app-shell__main">
        <TreeView />
        <CenterPanel />
        <PropertyPanel />
      </div>
      <ValidationPanel />
    </div>
  );
}

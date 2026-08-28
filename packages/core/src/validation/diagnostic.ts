import type { NodeId } from "../model/nodeId.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  nodeId: NodeId | null;
  code: string;
}

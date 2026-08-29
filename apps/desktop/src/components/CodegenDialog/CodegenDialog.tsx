import { useMemo, useState } from "react";
import { codegenRegistry, defaultOptionsFrom, type CodegenWarning, type OptionField } from "@xsd-visualizer/core";
import { useSchemaStore } from "../../state/schemaStore.js";
import { CheckboxField } from "../PropertyPanel/forms/fields.js";

interface CodegenDialogProps {
  open: boolean;
  onClose: () => void;
}

interface LogEntry {
  path: string;
  ok: boolean;
  message?: string;
}

function triggerBrowserDownload(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function OptionFieldControl({ field, value, onChange }: { field: OptionField; value: unknown; onChange: (value: unknown) => void }) {
  if (field.type === "boolean") {
    return <CheckboxField label={field.label} checked={Boolean(value)} onChange={onChange} />;
  }
  return (
    <label className="field">
      <span className="field__label">{field.label}</span>
      <select className="field__input" value={String(value)} onChange={(e) => onChange(e.target.value)}>
        {field.choices?.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Target language / options / output directory / generate flow (docs/PLAN.md 코드 생성 흐름).
 * Runs entirely on the renderer's main thread — buildCodegenIr + generate is a one-shot,
 * user-initiated action, and full-model validation at comparable scale already benchmarks in the
 * tens of milliseconds (packages/core/scripts/bench-large-schema.mjs), so no Worker is needed here.
 */
export function CodegenDialog({ open, onClose }: CodegenDialogProps) {
  const model = useSchemaStore((s) => s.model);
  const revision = useSchemaStore((s) => s.revision);
  const generators = useMemo(() => codegenRegistry.list(), []);
  const [generatorId, setGeneratorId] = useState(generators[0]?.id ?? "");
  const generator = generators.find((g) => g.id === generatorId) ?? generators[0];
  const [optionsByGenerator, setOptionsByGenerator] = useState<Record<string, Record<string, unknown>>>({});
  const options = generator ? (optionsByGenerator[generator.id] ?? defaultOptionsFrom(generator.getOptionsSchema())) : {};
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [log, setLog] = useState<LogEntry[] | null>(null);
  const hasElectronApi = typeof window !== "undefined" && !!window.api;

  const warnings: CodegenWarning[] = useMemo(() => {
    if (!generator?.validateModelSupport) return [];
    return generator.validateModelSupport(model);
    // revision isn't read directly, but the model mutates in place — see schemaStore.ts's note on
    // why revision must be a dependency for any memo/effect derived from `model`.
  }, [generator, model, revision]);

  if (!open) return null;

  function setOption(key: string, value: unknown): void {
    if (!generator) return;
    setOptionsByGenerator((prev) => ({ ...prev, [generator.id]: { ...options, [key]: value } }));
  }

  async function handleChooseDirectory(): Promise<void> {
    if (!window.api) return;
    const result = await window.api.openDirectoryDialog();
    if (!result.canceled) setOutputDir(result.dirPath);
  }

  async function handleGenerate(): Promise<void> {
    if (!generator) return;
    setIsGenerating(true);
    setLog(null);
    try {
      const files = generator.generate(model, options);
      const entries: LogEntry[] = [];
      if (window.api) {
        if (!outputDir) {
          entries.push({ path: "-", ok: false, message: "출력 디렉토리를 선택하세요." });
        } else {
          for (const file of files) {
            try {
              const fullPath = await window.api.joinPath(outputDir, file.path);
              await window.api.writeTextFile(fullPath, file.content);
              entries.push({ path: fullPath, ok: true });
            } catch (error) {
              entries.push({ path: file.path, ok: false, message: error instanceof Error ? error.message : String(error) });
            }
          }
        }
      } else {
        for (const file of files) {
          triggerBrowserDownload(file.path, file.content);
          entries.push({ path: file.path, ok: true });
        }
      }
      setLog(entries);
    } catch (error) {
      setLog([{ path: "-", ok: false, message: error instanceof Error ? error.message : String(error) }]);
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="modal__header">
          <span>코드 생성</span>
          <button type="button" className="modal__close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal__body">
          <label className="field">
            <span className="field__label">대상 언어</span>
            <select className="field__input" value={generator?.id ?? ""} onChange={(e) => setGeneratorId(e.target.value)}>
              {generators.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.displayName}
                </option>
              ))}
            </select>
          </label>

          {generator?.getOptionsSchema().map((field) => (
            <OptionFieldControl key={field.key} field={field} value={options[field.key]} onChange={(value) => setOption(field.key, value)} />
          ))}

          {warnings.length > 0 && (
            <div className="facet-editor">
              <div className="facet-editor__section-title">경고 ({warnings.length}) — 아래 구성은 근사되거나 생략됩니다</div>
              {warnings.map((warning, i) => (
                <div key={i} className="diagnostic-row">
                  {warning.message}
                </div>
              ))}
            </div>
          )}

          <div className="field">
            <span className="field__label">출력 위치</span>
            {hasElectronApi ? (
              <div className="field__occurs-row">
                <input className="field__input" readOnly value={outputDir ?? ""} placeholder="디렉토리를 선택하세요" />
                <button type="button" onClick={() => void handleChooseDirectory()}>
                  찾아보기
                </button>
              </div>
            ) : (
              <span className="property-form__hint">브라우저 모드에서는 생성된 파일이 각각 다운로드됩니다.</span>
            )}
          </div>

          {log && (
            <div className="facet-editor">
              <div className="facet-editor__section-title">결과</div>
              {log.map((entry, i) => (
                <div key={i} className="diagnostic-row">
                  <span className="diagnostic-row__code">{entry.ok ? "OK" : "실패"}</span>
                  {entry.path} {entry.message ?? ""}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal__footer">
          <button type="button" onClick={onClose}>
            닫기
          </button>
          <button type="button" disabled={!generator || isGenerating || (hasElectronApi && !outputDir)} onClick={() => void handleGenerate()}>
            {isGenerating ? "생성 중..." : "생성"}
          </button>
        </div>
      </div>
    </div>
  );
}

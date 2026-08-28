import { useEffect, useRef } from "react";

export interface ContextMenuAction {
  label: string;
  onSelect: () => void;
}

interface TreeContextMenuProps {
  x: number;
  y: number;
  actions: ContextMenuAction[];
  onClose: () => void;
}

export function TreeContextMenu({ x, y, actions, onClose }: TreeContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  if (actions.length === 0) return null;

  return (
    <div ref={ref} className="context-menu" style={{ left: x, top: y }}>
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          className="context-menu__item"
          onClick={() => {
            action.onSelect();
            onClose();
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

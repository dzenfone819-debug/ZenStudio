import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import "./OrbitalInspectorContextMenu.css";

type OrbitalInspectorContextMenuPresentation = "popover" | "sheet";
type OrbitalInspectorContextMenuActionTone = "default" | "danger" | "accent";
type OrbitalInspectorContextMenuActionIcon =
  | "rename"
  | "folder"
  | "note"
  | "canvas"
  | "color"
  | "pin"
  | "unpin"
  | "trash";

export interface OrbitalInspectorContextMenuAction {
  id: string;
  label: string;
  icon: OrbitalInspectorContextMenuActionIcon;
  tone?: OrbitalInspectorContextMenuActionTone;
  disabled?: boolean;
  onSelect: () => void;
}

interface OrbitalInspectorContextMenuProps {
  open: boolean;
  presentation: OrbitalInspectorContextMenuPresentation;
  position?: {
    x: number;
    y: number;
  } | null;
  accentColor: string;
  title: string;
  kindLabel: string;
  actions: OrbitalInspectorContextMenuAction[];
  colorOptions?: Array<{
    id: string;
    hex: string;
    label: string;
  }>;
  activeColor?: string | null;
  chooseColorLabel: string;
  customColorLabel: string;
  closeLabel: string;
  onClose: () => void;
  onColorChange?: ((color: string) => void) | null;
}

type AnchoredRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type ColorPanelPlacement = "right" | "left" | "bottom" | "top";

function toAnchoredRect(rect: DOMRect): AnchoredRect {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height
  };
}

function renderActionIcon(icon: OrbitalInspectorContextMenuActionIcon) {
  if (icon === "rename") {
    return (
      <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
        <path d="M4.4 13.9 13.7 4.6a2 2 0 0 1 2.9 0l.8.8a2 2 0 0 1 0 2.9l-9.3 9.3-3.5.6.6-3.5Z" />
        <path d="M11.8 6.5 15.5 10.2" className="orbital-context-menu-icon-accent" />
      </svg>
    );
  }

  if (icon === "folder") {
    return (
      <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
        <path d="M2.9 6.9c0-1.2 1-2.2 2.2-2.2H8l1.4 1.5h5.4c1.2 0 2.2 1 2.2 2.2v4.7c0 1.2-1 2.2-2.2 2.2H5.1c-1.2 0-2.2-1-2.2-2.2V6.9Z" />
        <path d="M3.3 8.3h12.9" className="orbital-context-menu-icon-accent" />
      </svg>
    );
  }

  if (icon === "canvas") {
    return (
      <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
        <rect x="3.2" y="4.2" width="13.6" height="11.6" rx="2.7" />
        <path d="M6.1 8h7.8M6.1 10.4h6M6.1 12.8h5.2" className="orbital-context-menu-icon-accent" />
      </svg>
    );
  }

  if (icon === "color") {
    return (
      <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
        <circle cx="10" cy="10" r="6.5" />
        <circle cx="10" cy="10" r="2.9" className="orbital-context-menu-icon-core" />
      </svg>
    );
  }

  if (icon === "pin") {
    return (
      <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
        <path d="M7.6 3.8h4.8l-.8 4.1 2.2 2.2H6l2.4-2.2-.8-4.1Z" />
        <path d="M10 10.2v5.7" className="orbital-context-menu-icon-accent" />
      </svg>
    );
  }

  if (icon === "unpin") {
    return (
      <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
        <path d="M7.6 3.8h4.8l-.8 4.1 2.2 2.2H6l2.4-2.2-.8-4.1Z" />
        <path d="M4.4 4.4 15.6 15.6" className="orbital-context-menu-icon-accent" />
      </svg>
    );
  }

  if (icon === "trash") {
    return (
      <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
        <path d="M6.5 5.3h7l-.5 9.2a1.6 1.6 0 0 1-1.6 1.5H8.6A1.6 1.6 0 0 1 7 14.5l-.5-9.2Z" />
        <path d="M5.2 5.3h9.6M8.1 5.3V4a1 1 0 0 1 1-1h1.8a1 1 0 0 1 1 1v1.3M8.5 8.1v4.5M11.5 8.1v4.5" className="orbital-context-menu-icon-accent" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
      <path d="M5.8 3.7h5.5L14.7 7v7.6c0 1.1-.9 2-2 2H5.8a2 2 0 0 1-2-2V5.7c0-1.1.9-2 2-2Z" />
      <path d="M11.2 3.9v3.3h3.2M6.7 9.2h6.4M6.7 11.8h5.2" className="orbital-context-menu-icon-accent" />
    </svg>
  );
}

export default function OrbitalInspectorContextMenu({
  open,
  presentation,
  position,
  accentColor,
  title,
  kindLabel,
  actions,
  colorOptions = [],
  activeColor,
  chooseColorLabel,
  customColorLabel,
  closeLabel,
  onClose,
  onColorChange
}: OrbitalInspectorContextMenuProps) {
  const [showColorPanel, setShowColorPanel] = useState(false);
  const previousOpenRef = useRef(open);
  const colorTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [colorPanelAnchorRect, setColorPanelAnchorRect] = useState<AnchoredRect | null>(null);
  const style = useMemo(() => {
    if (presentation !== "popover" || !position) {
      return undefined;
    }

    const viewportWidth = typeof window === "undefined" ? 1440 : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? 900 : window.innerHeight;
    const width = Math.min(300, viewportWidth - 24);
    const approximateHeight = 320;
    const left = Math.min(Math.max(12, position.x), viewportWidth - width - 12);
    const top = Math.min(Math.max(12, position.y), viewportHeight - approximateHeight - 12);

    return {
      "--context-menu-left": `${left}px`,
      "--context-menu-top": `${top}px`
    } as CSSProperties;
  }, [position, presentation]);

  useEffect(() => {
    if (open && !previousOpenRef.current) {
      setShowColorPanel(false);
      setColorPanelAnchorRect(null);
    }

    previousOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open || !showColorPanel || presentation !== "popover") {
      return undefined;
    }

    const updateAnchorRect = () => {
      if (!colorTriggerRef.current) {
        return;
      }

      setColorPanelAnchorRect(toAnchoredRect(colorTriggerRef.current.getBoundingClientRect()));
    };

    updateAnchorRect();
    window.addEventListener("resize", updateAnchorRect);

    return () => {
      window.removeEventListener("resize", updateAnchorRect);
    };
  }, [open, presentation, showColorPanel]);

  if (!open) {
    return null;
  }

  const menuClassName =
    presentation === "sheet"
      ? "orbital-context-menu-card is-sheet"
      : "orbital-context-menu-card is-popover";
  const primaryActions = actions.filter((action) => action.tone !== "danger");
  const destructiveActions = actions.filter((action) => action.tone === "danger");
  const isFloatingColorPanel = presentation === "popover";
  const floatingColorPanelStyle = useMemo(() => {
    if (!showColorPanel || !colorPanelAnchorRect || !isFloatingColorPanel) {
      return null;
    }

    const viewportWidth = typeof window === "undefined" ? 1440 : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? 900 : window.innerHeight;
    const viewportPadding = 12;
    const gap = 16;
    const width = Math.min(252, viewportWidth - viewportPadding * 2);
    const height = Math.min(212, viewportHeight - viewportPadding * 2);
    const room = {
      right: viewportWidth - viewportPadding - (colorPanelAnchorRect.right + gap),
      left: colorPanelAnchorRect.left - viewportPadding - gap,
      bottom: viewportHeight - viewportPadding - (colorPanelAnchorRect.bottom + gap),
      top: colorPanelAnchorRect.top - viewportPadding - gap
    };

    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
    const candidates = [
      {
        placement: "right" as const,
        fits: room.right >= width,
        score: room.right,
        left: colorPanelAnchorRect.right + gap,
        top: clamp(colorPanelAnchorRect.top - 6, viewportPadding, viewportHeight - height - viewportPadding)
      },
      {
        placement: "left" as const,
        fits: room.left >= width,
        score: room.left,
        left: colorPanelAnchorRect.left - gap - width,
        top: clamp(colorPanelAnchorRect.top - 6, viewportPadding, viewportHeight - height - viewportPadding)
      },
      {
        placement: "bottom" as const,
        fits: room.bottom >= height,
        score: room.bottom,
        left: clamp(colorPanelAnchorRect.left, viewportPadding, viewportWidth - width - viewportPadding),
        top: colorPanelAnchorRect.bottom + gap
      },
      {
        placement: "top" as const,
        fits: room.top >= height,
        score: room.top,
        left: clamp(colorPanelAnchorRect.left, viewportPadding, viewportWidth - width - viewportPadding),
        top: colorPanelAnchorRect.top - gap - height
      }
    ];

    const chosen =
      candidates.find((candidate) => candidate.placement === "right" && candidate.fits) ??
      candidates.find((candidate) => candidate.placement === "left" && candidate.fits) ??
      candidates.find((candidate) => candidate.placement === "bottom" && candidate.fits) ??
      candidates.find((candidate) => candidate.placement === "top" && candidate.fits) ??
      [...candidates].sort((left, right) => right.score - left.score)[0];

    return {
      left: clamp(chosen.left, viewportPadding, viewportWidth - width - viewportPadding),
      top: clamp(chosen.top, viewportPadding, viewportHeight - height - viewportPadding),
      width,
      maxHeight: height,
      placement: chosen.placement as ColorPanelPlacement
    };
  }, [colorPanelAnchorRect, isFloatingColorPanel, showColorPanel]);

  const renderColorPanel = (className: string) => (
    <div
      className={className}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="orbital-context-menu-swatches">
        {colorOptions.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`orbital-context-menu-swatch ${
              activeColor?.toLowerCase() === entry.hex.toLowerCase() ? "is-active" : ""
            }`}
            onClick={() => onColorChange?.(entry.hex)}
            style={{ "--swatch-color": entry.hex } as CSSProperties}
            aria-label={entry.label}
            title={entry.label}
          >
            <span />
          </button>
        ))}
      </div>

      <label className="orbital-context-menu-customcolor">
        <span>{customColorLabel}</span>
        <span className="orbital-context-menu-customcolor-control">
          <input
            type="color"
            value={activeColor ?? colorOptions[0]?.hex ?? "#ffffff"}
            onChange={(event) => onColorChange?.(event.target.value)}
            aria-label={customColorLabel}
          />
          <strong>{(activeColor ?? colorOptions[0]?.hex ?? "#ffffff").toUpperCase()}</strong>
        </span>
      </label>
    </div>
  );

  const renderAction = (action: OrbitalInspectorContextMenuAction) => (
    <button
      key={action.id}
      type="button"
      className={`orbital-context-menu-action ${
        action.tone === "danger"
          ? "is-danger"
          : action.tone === "accent"
            ? "is-accent"
            : ""
      }`}
      onClick={(event) => {
        event.stopPropagation();

        if (action.disabled) {
          return;
        }

        action.onSelect();
      }}
      disabled={action.disabled}
    >
      <span className="orbital-context-menu-action-icon">
        {renderActionIcon(action.icon)}
      </span>
      <span className="orbital-context-menu-action-label">{action.label}</span>
    </button>
  );

  return (
    <div className="orbital-context-menu-layer" style={style}>
      <button
        type="button"
        className={`orbital-context-menu-backdrop ${presentation === "sheet" ? "is-sheet" : ""}`}
        aria-label={closeLabel}
        onClick={onClose}
      />
      <div
        className={menuClassName}
        style={{ "--menu-accent": accentColor } as CSSProperties}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.stopPropagation()}
      >
        <div className="orbital-context-menu-head">
          <div className="orbital-context-menu-copy">
            <span className="orbital-context-menu-kind">{kindLabel}</span>
            <strong className="orbital-context-menu-title" title={title}>
              {title}
            </strong>
          </div>
          <button
            type="button"
            className="orbital-context-menu-close"
            onClick={onClose}
            aria-label={closeLabel}
          >
            ×
          </button>
        </div>

        <div className="orbital-context-menu-actions">
          {primaryActions.map(renderAction)}

          {onColorChange ? (
            <>
              <button
                ref={colorTriggerRef}
                type="button"
                className={`orbital-context-menu-action ${showColorPanel ? "is-accent" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  if (isFloatingColorPanel && colorTriggerRef.current) {
                    setColorPanelAnchorRect(toAnchoredRect(colorTriggerRef.current.getBoundingClientRect()));
                  }
                  setShowColorPanel((current) => !current);
                }}
              >
                <span className="orbital-context-menu-action-icon">
                  {renderActionIcon("color")}
                </span>
                <span className="orbital-context-menu-action-label">{chooseColorLabel}</span>
              </button>

              {showColorPanel && !isFloatingColorPanel
                ? renderColorPanel("orbital-context-menu-colorpanel")
                : null}
            </>
          ) : null}

          {destructiveActions.map(renderAction)}
        </div>
      </div>

      {showColorPanel && isFloatingColorPanel && floatingColorPanelStyle ? (
        <div
          className={`orbital-context-menu-colorpanel orbital-context-menu-colorpanel-floating is-${floatingColorPanelStyle.placement}`}
          style={{
            left: floatingColorPanelStyle.left,
            top: floatingColorPanelStyle.top,
            width: floatingColorPanelStyle.width,
            maxHeight: floatingColorPanelStyle.maxHeight
          } as CSSProperties}
        >
          {renderColorPanel("orbital-context-menu-colorpanel-body")}
        </div>
      ) : null}
    </div>
  );
}

import { useEffect } from "react";

import "./ConfirmDialog.css";

interface ConfirmDialogProps {
  open: boolean;
  kicker: string;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  details?: string[];
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  kicker,
  title,
  message,
  confirmLabel,
  cancelLabel,
  details = [],
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onCancel, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="confirm-dialog-layer" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
      <button
        type="button"
        className="confirm-dialog-dim"
        aria-label={cancelLabel}
        onClick={onCancel}
      />
      <div className="confirm-dialog-window">
        <div className="confirm-dialog-copy">
          <p className="panel-kicker confirm-dialog-kicker">{kicker}</p>
          <h2 className="panel-title confirm-dialog-title" id="confirm-dialog-title">
            {title}
          </h2>
          <p className="confirm-dialog-message">{message}</p>
          {details.length > 0 ? (
            <div className="confirm-dialog-details">
              {details.map((detail) => (
                <span key={detail} className="confirm-dialog-detail">
                  {detail}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="confirm-dialog-actions">
          <button type="button" className="toolbar-action" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="toolbar-action danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

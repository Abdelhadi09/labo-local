import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Info, CheckCircle, AlertCircle, X } from 'lucide-react';
import '../../styles/heroModal.css';
import './alertDialog.css';

// HeroUI-shaped AlertDialog — no @heroui/react dependency. Mirrors
// heroui.com/docs/react/components/alert-dialog: icon + heading header,
// body copy, footer with cancel/confirm actions. Reuses the shared
// .hero-modal-* shell (see /styles/heroModal.css) for backdrop/dialog/
// header/body/footer chrome, same as NurseRequestModal and DemandModal.
//
// Usage:
//   <AlertDialog
//     status="danger"
//     heading="Annuler cette demande ?"
//     description="Cette action ne peut pas être annulée."
//     confirmLabel="Annuler la demande"
//     cancelLabel="Retour"
//     onConfirm={() => ...}
//     onClose={() => setOpen(false)}
//   />
//
// Render only while open (like NurseRequestModal) — there's no internal
// isOpen state, the parent conditionally mounts it.

const STATUS_ICON = {
  default: Info,
  accent: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  danger: AlertCircle,
};

export default function AlertDialog({
  status = 'danger',
  icon,
  heading,
  description,
  children,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  onConfirm,
  onClose,
  confirmLoading = false,
  isDismissable = false,
}) {
  const [exiting, setExiting] = useState(false);

  const close = useCallback(() => {
    setExiting(true);
    setTimeout(() => onClose?.(), 180);
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [close]);

  const handleConfirm = async () => {
    await onConfirm?.();
  };

  const Icon = STATUS_ICON[status] || STATUS_ICON.default;

  return createPortal(
    <div
      className="hero-modal-overlay"
      data-exiting={exiting}
      onClick={(e) => { if (isDismissable && e.target === e.currentTarget) close(); }}
    >
      <div
        className={`hero-modal-dialog alert-dialog alert-dialog--${status}`}
        data-exiting={exiting}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="alert-dialog-heading"
      >
        <div className="hero-modal-header alert-dialog__header">
          <div className="alert-dialog__icon-row">
            <span className={`alert-dialog__icon alert-dialog__icon--${status}`}>
              {icon || <Icon size={20} />}
            </span>
            <h3 id="alert-dialog-heading" className="alert-dialog__heading">{heading}</h3>
          </div>
          <button className="hero-modal-close" onClick={close} aria-label="Fermer" disabled={confirmLoading}>
            <X size={16} />
          </button>
        </div>

        <div className="hero-modal-body">
          {description && <p className="alert-dialog__description">{description}</p>}
          {children}
        </div>

        <div className="hero-modal-footer alert-dialog__footer">
          <button className="btn btn-secondary" onClick={close} disabled={confirmLoading}>
            {cancelLabel}
          </button>
          <button
            className={`btn ${status === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            onClick={handleConfirm}
            disabled={confirmLoading}
          >
            {confirmLoading ? <><span className="spinner" /> …</> : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
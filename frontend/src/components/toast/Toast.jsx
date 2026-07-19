import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, Info, AlertTriangle, AlertCircle, Bell, X } from 'lucide-react';
import { toastStore } from './toastStore.js';
import './toast.css';

// Default indicator per variant — mirrors HeroUI's built-in variant icons.
const VARIANT_ICON = {
  default: Bell,
  accent: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  danger: AlertCircle,
};

function ToastIndicator({ variant, isLoading, children }) {
  if (isLoading) return <span className="toast__spinner" aria-hidden="true" />;
  if (children === null) return null;
  const Icon = VARIANT_ICON[variant] || VARIANT_ICON.default;
  return <span className="toast__indicator"><Icon size={17} /></span>;
}

function ToastItem({ item }) {
  const { id, title, description, variant, indicator, actionProps, isLoading } = item;
  return (
    <div className={`toast toast--${variant}`} role="status" data-frontmost>
      <ToastIndicator variant={variant} isLoading={isLoading}>{indicator}</ToastIndicator>
      <div className="toast__content">
        {title && <p className="toast__title">{title}</p>}
        {description && <p className="toast__description">{description}</p>}
      </div>
      {actionProps && (
        <button
          className="toast__action"
          onClick={() => { actionProps.onPress?.(); }}
        >
          {actionProps.children}
        </button>
      )}
      <button className="toast__close" onClick={() => toastStore.close(id)} aria-label="Fermer">
        <X size={14} />
      </button>
    </div>
  );
}

// Mount once near the root of the app (see main.jsx). Subscribes to the
// module-level toast queue so `toast()` can be called from anywhere —
// event handlers, catch blocks — without prop drilling a context.
export default function ToastProvider({ placement = 'bottom end' }) {
  const [items, setItems] = useState([]);

  useEffect(() => toastStore.subscribe(setItems), []);

  if (items.length === 0) return null;

  const [vertical, horizontal = 'center'] = placement.split(' ');

  return createPortal(
    <div className={`toast__region toast__region--${vertical} toast__region--${horizontal}`}>
      {items.slice(0, 3).map(item => <ToastItem key={item.id} item={item} />)}
    </div>,
    document.body
  );
}
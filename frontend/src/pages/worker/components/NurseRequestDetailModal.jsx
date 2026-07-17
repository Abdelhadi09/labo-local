import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Phone, MapPin, FlaskConical, CheckCircle, X, UserRound, Calendar, Building2 } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import '../../../styles/heroModal.css';

const NURSE_STATUS = {
  pending:   { label: 'En attente', color: '#92400e', bg: '#fef3c7', border: '#fcd34d' },
  confirmed: { label: 'Confirmée',  color: '#065f46', bg: '#d1fae5', border: '#6ee7b7' },
  done:      { label: 'Effectuée',  color: '#1e40af', bg: '#dbeafe', border: '#93c5fd' },
  cancelled: { label: 'Annulée',    color: '#991b1b', bg: '#fee2e2', border: '#fca5a5' },
  no_show:   { label: 'Absence',    color: '#78350f', bg: '#fef3c7', border: '#fbbf24' },
};

const EXIT_DURATION = 200; // ms — must match heroModal.css's exit animation duration

// Full detail view for a single home-nurse request. Opened from the compact
// row in NurseTab; carries everything that used to be crammed into the card
// (analyses, total, timestamps, assignment dropdown, status actions) plus
// the fields that stay important to see at a glance. Same shell as
// NurseRosterManager — see /styles/heroModal.css.
export default function NurseRequestDetailModal({
  request: r,
  nurses,
  loadByDate,
  updatingId,
  assigningId,
  showBranch,
  onStatus,
  onAssign,
  onClose,
}) {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [isExiting, setIsExiting] = useState(false);

  const requestClose = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => onClose?.(), EXIT_DURATION);
  }, [onClose]);

  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  useEffect(() => {
    const onKeyDown = e => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [requestClose]);

  if (!r) return null;
  const s = NURSE_STATUS[r.status] || NURSE_STATUS.pending;
  const dayLoad = loadByDate?.[r.preferred_date];

  const modalContent = (
    <div
      className={`hero-modal-overlay${isMobile ? ' hero-modal-overlay--bottom' : ''}`}
      data-exiting={isExiting}
      onMouseDown={e => { if (e.target === e.currentTarget) requestClose(); }}
    >
      <div
        className={`hero-modal-dialog${isMobile ? ' hero-modal-dialog--sheet' : ''}`}
        data-exiting={isExiting}
        role="dialog"
        aria-modal="true"
        aria-labelledby="nrd-heading"
        style={{ maxWidth: isMobile ? '100%' : 480 }}
      >
        <div className="hero-modal-header">
          <div>
            <div className="hero-modal-header-icon">
              <UserRound size={20} color="var(--teal)" />
            </div>
            <h3 id="nrd-heading" style={{ margin: 0, fontSize: isMobile ? '0.98rem' : '1.05rem' }}>
              {r.first_name && r.last_name ? `${r.first_name} ${r.last_name}` : r.username}
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700, background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
                {s.label}
              </span>
              {showBranch && r.branch_name && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.74rem', fontWeight: 600, color: 'var(--teal-dark)' }}>
                  <Building2 size={11} /> {r.branch_name}
                </span>
              )}
            </div>
          </div>
          <button className="hero-modal-close" onClick={requestClose} aria-label="Fermer"><X size={18} /></button>
        </div>

        <div className="hero-modal-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.88rem' }}>
            <Phone size={15} color="var(--teal)" style={{ flexShrink: 0 }} />
            <a href={`tel:${r.phone}`} style={{ color: 'var(--teal)', fontWeight: 600 }}>{r.phone}</a>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: '0.88rem' }}>
            <MapPin size={15} color="var(--teal)" style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{r.address}</span>
          </div>

          {r.preferred_date && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.88rem', fontWeight: 600, color: 'var(--navy)' }}>
              <Calendar size={15} color="var(--teal)" style={{ flexShrink: 0 }} />
              <span>
                {format(new Date(r.preferred_date), 'dd MMM yyyy', { locale: fr })}
                {' · '}
                {r.preferred_slot === 'morning' ? 'Matin' : 'Après-midi'}
              </span>
            </div>
          )}

          {r.analyses?.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: '0.86rem' }}>
              <FlaskConical size={15} color="var(--teal)" style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{r.analyses.join(' · ')}</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {r.demand_total && <span style={{ fontWeight: 600, color: 'var(--teal-dark)' }}>{Number(r.demand_total).toLocaleString('fr-DZ')} DA</span>}
            <span>Créée le {format(new Date(r.created_at), 'dd MMM yyyy HH:mm', { locale: fr })}</span>
          </div>

          {(r.status === 'cancelled' || r.status === 'no_show') && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '8px 10px' }}>
              {r.cancelled_by === 'client' ? 'Annulée par le client' : r.status === 'no_show' ? 'Absence constatée' : 'Annulée par le laboratoire'}
              {r.cancelled_reason && <div style={{ fontStyle: 'italic', marginTop: 3 }}>« {r.cancelled_reason} »</div>}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 600, color: 'var(--navy)' }}>
              <UserRound size={14} color="var(--teal)" /> Infirmière assignée
            </label>
            <select
              value={r.assigned_nurse_id || ''}
              disabled={assigningId === r.id}
              onChange={e => onAssign(r.id, e.target.value || null, r.preferred_date)}
              style={{
                fontSize: '0.85rem', padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)', background: 'white', width: '100%',
              }}
            >
              <option value="">— Assigner une infirmière —</option>
              {nurses.map(n => {
                const load = dayLoad?.find(l => l.id === n.id);
                const count = load?.total_count ?? 0;
                const max = n.max_visits_per_day;
                const atOrOverCapacity = load && count >= max && n.id !== r.assigned_nurse_id;
                return (
                  <option key={n.id} value={n.id}>
                    {n.name}{n.zone ? ` (${n.zone})` : ''} — {count}/{max}{atOrOverCapacity ? ' ⚠ complet' : ''}
                  </option>
                );
              })}
              {r.assigned_nurse_id && !nurses.some(n => n.id === r.assigned_nurse_id) && (
                <option value={r.assigned_nurse_id}>{r.assigned_nurse_name || 'Infirmière (inactive)'}</option>
              )}
            </select>
          </div>
        </div>

        <div className="hero-modal-footer" style={{ flexDirection: isMobile ? 'column' : 'row' }}>
          {r.status === 'pending' && (
            <button
              className="btn btn-primary btn-sm"
              disabled={updatingId === r.id || !r.assigned_nurse_id}
              title={!r.assigned_nurse_id ? 'Assignez une infirmière avant de confirmer' : undefined}
              onClick={() => onStatus(r.id, 'confirmed')}
              style={{ flex: 1 }}
            >
              {updatingId === r.id ? <span className="spinner" style={{ width: 14, height: 14 }} /> : <><CheckCircle size={13} /> Confirmer</>}
            </button>
          )}
          {r.status === 'confirmed' && (
            <button className="btn btn-sm" style={{ background: 'var(--navy)', color: 'white', flex: 1 }} disabled={updatingId === r.id} onClick={() => onStatus(r.id, 'done')}>
              {updatingId === r.id ? <span className="spinner" style={{ width: 14, height: 14 }} /> : <><CheckCircle size={13} /> Marquer effectuée</>}
            </button>
          )}
          {r.status === 'confirmed' && (
            <button
              className="btn btn-sm"
              style={{ background: '#fef3c7', color: '#78350f', border: '1px solid #fbbf24', flex: 1 }}
              disabled={updatingId === r.id}
              onClick={() => onStatus(r.id, 'no_show')}
            >
              <X size={13} /> Absence
            </button>
          )}
          {(r.status === 'pending' || r.status === 'confirmed') && (
            <button
              className="btn btn-sm"
              style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', flex: 1 }}
              disabled={updatingId === r.id}
              onClick={() => onStatus(r.id, 'cancelled')}
            >
              <X size={13} /> Annuler
            </button>
          )}
          {r.status === 'done' && (
            <span style={{ fontSize: '0.85rem', color: 'var(--teal)', fontWeight: 600 }}>✓ Visite effectuée</span>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
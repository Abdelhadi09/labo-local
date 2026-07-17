import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { nursesRosterAPI } from '../../../services/api';
import { X, Plus, UserRound, Phone, MapPin, AlertCircle, Users, ListChecks } from 'lucide-react';
import '../../../styles/heroModal.css';

// Simple CRUD panel for the nurse roster. Nurses have no login here — this
// is purely a list the worker maintains so requests can be assigned to a
// real person instead of just a "confirmed" status with nobody behind it.
//
// Modal shell styled to match HeroUI's Modal (heroui.com/docs/react/components/modal)
// using plain CSS only — blurred backdrop, layered shadow, scale/fade
// entrance + exit animation, sticky icon-circle header — see
// NurseRosterManager.css. No @heroui/react dependency; ESC-to-close and
// backdrop-click-to-close are hand-rolled below to match HeroUI's behavior.
const EXIT_DURATION = 200; // ms — must match the CSS exit animation duration

export default function NurseRosterManager({ onClose, onChange }) {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [nurses, setNurses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', zone: '', max_visits_per_day: 6 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
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

  // ESC to dismiss — mirrors HeroUI's default isKeyboardDismissDisabled={false}
  useEffect(() => {
    const onKeyDown = e => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [requestClose]);

  const load = async (includeInactive = showInactive) => {
    setLoading(true);
    try {
      const res = await nursesRosterAPI.list(includeInactive);
      setNurses(res.data?.data || []);
    } catch (e) {
      setError('Erreur lors du chargement');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(showInactive); }, [showInactive]);

  const handleAdd = async () => {
    if (!form.name.trim() || !form.phone.trim()) {
      setError('Nom et téléphone requis');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await nursesRosterAPI.create({
        name: form.name.trim(),
        phone: form.phone.trim(),
        zone: form.zone.trim() || null,
        max_visits_per_day: form.max_visits_per_day || 6,
      });
      setForm({ name: '', phone: '', zone: '', max_visits_per_day: 6 });
      await load();
      onChange?.();
    } catch (e) {
      setError(e.response?.data?.error || "Erreur lors de l'ajout");
    } finally {
      setSaving(false);
    }
  };

  const updateCapacity = async (nurse, newValue) => {
    const value = parseInt(newValue, 10);
    if (!value || value < 1 || value === nurse.max_visits_per_day) return;
    try {
      await nursesRosterAPI.update(nurse.id, { name: nurse.name, phone: nurse.phone, zone: nurse.zone, max_visits_per_day: value });
      await load();
      onChange?.();
    } catch (e) {
      setError('Erreur lors de la mise à jour de la capacité');
    }
  };

  const toggleActive = async (nurse) => {
    try {
      await nursesRosterAPI.setActive(nurse.id, !nurse.is_active);
      await load();
      onChange?.();
    } catch (e) {
      setError('Erreur lors de la mise à jour');
    }
  };

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
        aria-labelledby="nrm-heading"
        style={{ maxWidth: isMobile ? '100%' : 520 }}
      >
        {/* Header — icon-circle + heading, sticky, mirrors Modal.Header/Modal.Icon */}
        <div className="hero-modal-header">
          <div>
            <div className="hero-modal-header-icon">
              <Users size={20} color="var(--teal)" />
            </div>
            <h3 id="nrm-heading" style={{ margin: 0, fontSize: isMobile ? '0.98rem' : '1.05rem' }}>
              Gérer les infirmières
            </h3>
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 3 }}>
              Ajoutez ou désactivez les infirmières disponibles pour les visites
            </p>
          </div>
          <button className="hero-modal-close" onClick={requestClose} aria-label="Fermer"><X size={18} /></button>
        </div>

        {error && (
          <div className="alert alert-error" style={{ margin: '10px 16px 0' }}>
            <AlertCircle size={14} style={{ flexShrink: 0 }} />{error}
          </div>
        )}

        <div style={styles.scrollBody}>
          {/* ── Section 1 : Ajouter une infirmière ── */}
          <div style={styles.stepBody}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <div style={styles.stepIcon}>
                <Plus size={20} color="var(--teal)" />
              </div>
              <h4 style={styles.stepTitle}>Ajouter une infirmière</h4>
            </div>
          

            <div className="form-group" style={{ marginTop: 2 }}>
              <label>Nom *</label>
              <input
                placeholder="Ex: Amina B."
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                style={{ fontSize: '16px' }}
              />
            </div>
            <div className="form-group" style={{ marginTop: 2 }}>
              <label>Téléphone *</label>
              <input
                type="tel"
                placeholder="Ex: 0555 123 456"
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                style={{ fontSize: '16px' }}
              />
            </div>
            {/* <div className="form-group" style={{ marginTop: 10 }}>
              <label>Zone (optionnel)</label>
              <input
                placeholder="Ex: Tipaza / Kolea"
                value={form.zone}
                onChange={e => setForm(f => ({ ...f, zone: e.target.value }))}
                style={{ fontSize: '16px' }}
              />
            </div> */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 2, alignItems: 'flex-end' }}>
            <div className="form-group" style={{ marginTop: 2 }}>
              <label>Capacité max — visites/jour</label>
              <input
                type="number"
                min={1}
                max={50}
                value={form.max_visits_per_day}
                onChange={e => setForm(f => ({ ...f, max_visits_per_day: parseInt(e.target.value, 10) || '' }))}
                style={{ fontSize: '16px', maxWidth: 120 }}
              />
            </div>
<div>
            <button
              className="btn btn-primary"
              disabled={saving}
              onClick={handleAdd}
              style={{ marginTop: 14, width: isMobile ? '100%' : 'auto', alignSelf: isMobile ? 'stretch' : 'flex-start' }}
            >
              {saving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : <><Plus size={14} /> Ajouter</>}
            </button>
            </div>
            </div>
          </div>

          {/* ── Section 2 : Liste des infirmières ── */}
          <div style={{ ...styles.stepBody, marginTop: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <div style={styles.stepIcon}>
                <Users size={20} color="var(--teal)" />
              </div>
              <h4 style={styles.stepTitle}>Infirmières enregistrées</h4>
            </div>

            <div style={{ ...styles.addressToggle, flexDirection: 'row', marginTop: 2 }}>
              <button
                style={{ ...styles.toggleBtn, ...(!showInactive ? styles.toggleActive : {}), width: isMobile ? '100%' : 'auto' }}
                onClick={() => setShowInactive(false)}
              >
                <ListChecks size={14} /> Actives seulement
              </button>
              <button
                style={{ ...styles.toggleBtn, ...(showInactive ? styles.toggleActive : {}), width: isMobile ? '100%' : 'auto' }}
                onClick={() => setShowInactive(true)}
              >
                <Users size={14} /> Toutes (incl. désactivées)
              </button>
            </div>

            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
                <span className="spinner spinner-dark" />
              </div>
            ) : nurses.length === 0 ? (
              <div style={styles.profileAddrBox}>
                <UserRound size={14} color="var(--teal)" style={{ flexShrink: 0, marginTop: 2 }} />
                <span style={{ fontSize: '0.85rem' }}>Aucune infirmière pour l'instant.</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                {nurses.map(n => (
                  <div key={n.id} style={{ ...styles.nurseRow, opacity: n.is_active ? 1 : 0.55 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <UserRound size={16} color="var(--teal)" style={{ flexShrink: 0, marginTop: 2 }} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--navy)' }}>{n.name}</div>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Phone size={11} /> {n.phone}</span>
                          {n.zone && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><MapPin size={11} /> {n.zone}</span>}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: isMobile ? 'space-between' : 'flex-end' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Max/jour
                        <input
                          type="number"
                          min={1}
                          max={50}
                          defaultValue={n.max_visits_per_day}
                          onBlur={e => updateCapacity(n, e.target.value)}
                          style={{ width: 46, padding: '3px 5px', borderRadius: 4, border: '1px solid var(--border)', fontSize: '0.8rem' }}
                        />
                      </label>
                      <button className="btn btn-secondary btn-sm" onClick={() => toggleActive(n)}>
                        {n.is_active ? 'Désactiver' : 'Réactiver'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}

const styles = {
  scrollBody: {
    padding: '14px 16px 20px', overflowY: 'auto',
  },
  stepBody: {
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  stepIcon: {
    width: 42, height: 42, borderRadius: '50%',
    background: 'rgba(10,147,150,0.1)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    marginBottom: 2, flexShrink: 0,
  },
  stepTitle: {
    margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--navy)',
  },
  stepHint: {
    margin: 0, fontSize: '0.83rem', color: 'var(--text-muted)', lineHeight: 1.5,
  },
  addressToggle: { display: 'flex', gap: 8 },
  toggleBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: '6px 8px', borderRadius: 'var(--radius-lg)',
    border: '1.5px solid var(--border)', background: 'white',
    cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.83rem',
    fontWeight: 500, color: 'var(--text-muted)', transition: 'all 0.15s',
    WebkitTapHighlightColor: 'transparent',
    minHeight: 44,
  },
  toggleActive: {
    borderColor: 'var(--teal)', background: 'rgba(10,147,150,0.07)', color: 'var(--teal-dark)',
  },
  profileAddrBox: {
    display: 'flex', alignItems: 'flex-start', gap: 8,
    padding: '6px 8px', background: 'rgba(10,147,150,0.06)',
    borderRadius: 'var(--radius-lg)', border: '1px solid rgba(10,147,150,0.2)',
    marginTop: 2, lineHeight: 1.5,
  },
  nurseRow: {
    display: 'flex', flexDirection: 'column', gap: 10,
    padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
    background: 'var(--cream)',
  },
};
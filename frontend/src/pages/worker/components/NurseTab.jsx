import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Phone, MapPin, FlaskConical, CheckCircle, X, UserRound, Calendar, Map, List } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { nurseAPI, nursesRosterAPI } from '../../../services/api';
import NurseRosterManager from './NurseRosterManager';
import NurseMapView from './NurseMapView';
import NurseFilterBar from './NurseFilterBar';

const NURSE_STATUS = {
  pending:   { label: 'En attente', color: '#92400e', bg: '#fef3c7', border: '#fcd34d' },
  confirmed: { label: 'Confirmée',  color: '#065f46', bg: '#d1fae5', border: '#6ee7b7' },
  done:      { label: 'Effectuée',  color: '#1e40af', bg: '#dbeafe', border: '#93c5fd' },
  cancelled: { label: 'Annulée',    color: '#991b1b', bg: '#fee2e2', border: '#fca5a5' },
  no_show:   { label: 'Absence',    color: '#78350f', bg: '#fef3c7', border: '#fbbf24' },
};

const styles = {
  viewToggleBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '7px 10px', background: 'white', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
  },
  viewToggleActive: {
    background: 'rgba(10,147,150,0.1)', color: 'var(--teal-dark)',
  },
};

export default function NurseTab({ requests, loading, onRefresh, isMobile, page, totalPages, total, limit, onPageChange, hasFilters, filterBarProps, onClearFilters }) {
  const [updatingId, setUpdatingId] = useState(null);
  const [assigningId, setAssigningId] = useState(null);
  const [nurses, setNurses] = useState([]);
  const [showRoster, setShowRoster] = useState(false);
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'map'
  const [highlightedId, setHighlightedId] = useState(null);
  const cardRefs = useRef({});
  const [loadByDate, setLoadByDate] = useState({}); // { 'YYYY-MM-DD': [{id, name, max_visits_per_day, morning_count, afternoon_count, total_count}] }

  // On the map view, only requests that can actually be plotted (i.e. have
  // coordinates) should show — both as pins and as the list beneath, so the
  // two stay in sync. Status filtering (cancelled/no-show included) is the
  // filter bar's job, not this component's.
  const geolocatedRequests = useMemo(
    () => requests.filter(r => r.address_lat != null && r.address_lng != null),
    [requests]
  );
  const displayedRequests = viewMode === 'map' ? geolocatedRequests : requests;

  const loadNurses = () => {
    nursesRosterAPI.list().then(res => setNurses(res.data?.data || [])).catch(() => {});
  };

  useEffect(() => { loadNurses(); }, []);

  // Fetch capacity/load for every distinct preferred_date currently visible,
  // so the assignment dropdown can show "3/6 today" per nurse without a
  // separate request per card.
  useEffect(() => {
    const dates = [...new Set(requests.map(r => r.preferred_date).filter(Boolean))];
    dates.forEach(date => {
      if (loadByDate[date]) return; // already fetched
      nursesRosterAPI.load(date)
        .then(res => setLoadByDate(prev => ({ ...prev, [date]: res.data?.data || [] })))
        .catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests]);

  const refreshLoadFor = (date) => {
    if (!date) return;
    nursesRosterAPI.load(date)
      .then(res => setLoadByDate(prev => ({ ...prev, [date]: res.data?.data || [] })))
      .catch(() => {});
  };

  const handleStatus = async (id, status) => {
    let reason = null;
    if (status === 'cancelled' || status === 'no_show') {
      reason = window.prompt(
        status === 'cancelled' ? "Motif de l'annulation (optionnel) :" : "Motif de l'absence (optionnel) :",
        ''
      );
      if (reason === null) return; // worker hit Cancel on the prompt itself
    }
    setUpdatingId(id);
    try {
      await nurseAPI.updateStatus(id, status, reason || null);
      onRefresh();
    } catch (e) {
      alert(e.response?.data?.error || 'Erreur lors de la mise à jour');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleAssign = async (id, nurseId, preferredDate, force = false) => {
    setAssigningId(id);
    try {
      await nurseAPI.assign(id, nurseId || null, force);
      onRefresh();
      refreshLoadFor(preferredDate);
    } catch (e) {
      const data = e.response?.data;
      if (data?.code === 'CAPACITY_EXCEEDED') {
        const confirmOverride = window.confirm(
          `${data.error}\n\nAssigner quand même cette infirmière ?`
        );
        if (confirmOverride) {
          await handleAssign(id, nurseId, preferredDate, true);
          return;
        }
      } else {
        alert(data?.error || "Erreur lors de l'assignation");
      }
    } finally {
      setAssigningId(null);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'space-between', marginBottom: 14 , flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 10 : 0}}>
        <h2 style={{ margin: 0, fontSize: isMobile ? '1.1rem' : '1.4rem' }}>
           Demandes d'infirmière à domicile
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
            <button
              onClick={() => setViewMode('list')}
              style={{ ...styles.viewToggleBtn, ...(viewMode === 'list' ? styles.viewToggleActive : {}) }}
              title="Vue liste"
            >
              <List size={14} />
            </button>
            <button
              onClick={() => setViewMode('map')}
              style={{ ...styles.viewToggleBtn, ...(viewMode === 'map' ? styles.viewToggleActive : {}) }}
              title="Vue carte"
            >
              <Map size={14} />
            </button>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowRoster(true)}>
            <UserRound size={13} /> Gérer les infirmières
          </button>
          <button className="btn btn-secondary btn-sm" onClick={onRefresh}><span style={{display:'inline-block', transform:'translateY(1px)'}}>⟳</span> Actualiser</button>
        </div>
      </div>

      {showRoster && (
        <NurseRosterManager onClose={() => setShowRoster(false)} onChange={loadNurses} />
      )}

      {filterBarProps && <NurseFilterBar {...filterBarProps} />}

      {viewMode === 'map' && !loading && (
        <div style={{ marginBottom: 16 }}>
          <NurseMapView
            requests={requests}
            onSelectRequest={(r) => {
              setHighlightedId(r.id);
              setTimeout(() => {
                cardRefs.current[r.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, 60);
              setTimeout(() => setHighlightedId(null), 2500);
            }}
          />
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><div className="spinner spinner-dark" /></div>
      ) : displayedRequests.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '60px 24px', color: 'var(--text-muted)' }}>
          <FlaskConical size={32} color="var(--text-muted)" />
          <p>
            {viewMode === 'map'
              ? (requests.length === 0
                  ? (hasFilters ? 'Aucun résultat pour ces filtres' : "Aucune demande d'infirmière pour l'instant")
                  : 'Aucune visite géolocalisée pour ces filtres')
              : (hasFilters ? 'Aucun résultat pour ces filtres' : "Aucune demande d'infirmière pour l'instant")}
          </p>
          {hasFilters && (
            <button className="btn btn-secondary btn-sm" onClick={onClearFilters}>
              <X size={12} /> Effacer les filtres
            </button>
          )}
        </div>
      ) : (
        <>
          {hasFilters && (
            <p style={{ margin: '0 0 10px', fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
              {displayedRequests.length} résultat{displayedRequests.length > 1 ? 's' : ''} affiché{displayedRequests.length > 1 ? 's' : ''}
            </p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {displayedRequests.map(r => {
              const s = NURSE_STATUS[r.status] || NURSE_STATUS.pending;
              return (
                <div
                  key={r.id}
                  ref={el => { cardRefs.current[r.id] = el; }}
                  style={{
                    background: 'white', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden',
                    borderLeft: `4px solid ${
                      r.status === 'pending' ? 'var(--coral)' :
                      r.status === 'confirmed' ? 'var(--teal)' :
                      r.status === 'cancelled' ? '#dc2626' :
                      r.status === 'no_show' ? '#f59e0b' :
                      'var(--border)'
                    }`,
                    outline: highlightedId === r.id ? '3px solid var(--teal)' : 'none',
                    outlineOffset: 2,
                    transition: 'outline 0.2s',
                  }}
                >
                  <div style={{ padding: '14px 18px', display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 14 }}>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: '0.95rem', color: 'var(--navy)' }}>
                          {r.first_name && r.last_name ? `${r.first_name} ${r.last_name}` : r.username}
                        </p>
                        <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700, background: s.bg, color: s.color, border: `1px solid ${s.border}`, flexShrink: 0 }}>
                          {s.label}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                        <Phone size={13} color="var(--teal)" />
                        <a href={`tel:${r.phone}`} style={{ color: 'var(--teal)', fontWeight: 600 }}>{r.phone}</a>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                        <MapPin size={13} color="var(--teal)" style={{ flexShrink: 0, marginTop: 2 }} />
                        <span>{r.address}</span>
                      </div>
                      {r.preferred_date && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.84rem', fontWeight: 600, color: 'var(--navy)' }}>
                          <Calendar size={13} color="var(--teal)" style={{ flexShrink: 0 }} />
                          <span>
                            {format(new Date(r.preferred_date), 'dd MMM yyyy', { locale: fr })}
                            {' · '}
                            {r.preferred_slot === 'morning' ? 'Matin' : 'Après-midi'}
                          </span>
                        </div>
                      )}
                      {r.analyses?.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                          <FlaskConical size={13} color="var(--teal)" style={{ flexShrink: 0, marginTop: 2 }} />
                          <span>{r.analyses.join(' · ')}</span>
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 12, fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                        {r.demand_total && <span style={{ fontWeight: 600, color: 'var(--teal-dark)' }}>{Number(r.demand_total).toLocaleString('fr-DZ')} DA</span>}
                        <span>{format(new Date(r.created_at), 'dd MMM yyyy HH:mm', { locale: fr })}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                        <UserRound size={13} color="var(--teal)" style={{ flexShrink: 0 }} />
                        <select
                          value={r.assigned_nurse_id || ''}
                          disabled={assigningId === r.id}
                          onChange={e => handleAssign(r.id, e.target.value || null, r.preferred_date)}
                          style={{
                            fontSize: '0.8rem', padding: '4px 8px', borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--border)', background: 'white', maxWidth: 240,
                          }}
                        >
                          <option value="">— Assigner une infirmière —</option>
                          {nurses.map(n => {
                            const dayLoad = loadByDate[r.preferred_date]?.find(l => l.id === n.id);
                            const count = dayLoad?.total_count ?? 0;
                            const max = n.max_visits_per_day;
                            const atOrOverCapacity = dayLoad && count >= max && n.id !== r.assigned_nurse_id;
                            return (
                              <option key={n.id} value={n.id}>
                                {n.name}{n.zone ? ` (${n.zone})` : ''} — {count}/{max}{atOrOverCapacity ? ' ⚠ complet' : ''}
                              </option>
                            );
                          })}
                          {/* Keep a currently-assigned-but-now-inactive nurse selectable/visible */}
                          {r.assigned_nurse_id && !nurses.some(n => n.id === r.assigned_nurse_id) && (
                            <option value={r.assigned_nurse_id}>{r.assigned_nurse_name || 'Infirmière (inactive)'}</option>
                          )}
                        </select>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: isMobile ? 'row' : 'column', gap: 8, flexShrink: 0, justifyContent: isMobile ? 'flex-end' : 'center', flexWrap: 'wrap' }}>
                      {r.status === 'pending' && (
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={updatingId === r.id || !r.assigned_nurse_id}
                          title={!r.assigned_nurse_id ? 'Assignez une infirmière avant de confirmer' : undefined}
                          onClick={() => handleStatus(r.id, 'confirmed')}
                        >
                          {updatingId === r.id ? <span className="spinner" style={{ width: 14, height: 14 }} /> : <><CheckCircle size={13} /> Confirmer</>}
                        </button>
                      )}
                      {r.status === 'confirmed' && (
                        <button className="btn btn-sm" style={{ background: 'var(--navy)', color: 'white' }} disabled={updatingId === r.id} onClick={() => handleStatus(r.id, 'done')}>
                          {updatingId === r.id ? <span className="spinner" style={{ width: 14, height: 14 }} /> : <><CheckCircle size={13} /> Marquer effectuée</>}
                        </button>
                      )}
                      {r.status === 'confirmed' && (
                        <button
                          className="btn btn-sm"
                          style={{ background: '#fef3c7', color: '#78350f', border: '1px solid #fbbf24' }}
                          disabled={updatingId === r.id}
                          onClick={() => handleStatus(r.id, 'no_show')}
                        >
                          <X size={13} /> Absence
                        </button>
                      )}
                      {(r.status === 'pending' || r.status === 'confirmed') && (
                        <button
                          className="btn btn-sm"
                          style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' }}
                          disabled={updatingId === r.id}
                          onClick={() => handleStatus(r.id, 'cancelled')}
                        >
                          <X size={13} /> Annuler
                        </button>
                      )}
                      {r.status === 'done' && (
                        <span style={{ fontSize: '0.8rem', color: 'var(--teal)', fontWeight: 600 }}>✓ Effectuée</span>
                      )}
                      {(r.status === 'cancelled' || r.status === 'no_show') && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: isMobile ? 'right' : 'left', maxWidth: 160 }}>
                          {r.cancelled_by === 'client' ? 'Annulée par le client' : r.status === 'no_show' ? 'Absence constatée' : 'Annulée par le laboratoire'}
                          {r.cancelled_reason && <div style={{ fontStyle: 'italic', marginTop: 2 }}>« {r.cancelled_reason} »</div>}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
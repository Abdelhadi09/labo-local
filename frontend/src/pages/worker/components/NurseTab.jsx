import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Phone, FlaskConical, X, UserRound, Calendar, Map, List, Building2, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { nurseAPI, nursesRosterAPI } from '../../../services/api';
import NurseRosterManager from './NurseRosterManager';
import NurseRequestDetailModal from './NurseRequestDetailModal';
import NurseMapView from './NurseMapView';
import NurseFilterBar from './NurseFilterBar';
import Pagination from '../../../components/Pagination';
import AnimatedList from '../../../components/AnimatedList';

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

export default function NurseTab({ requests, loading, onRefresh, isMobile, page, totalPages, total, limit, onPageChange, hasFilters, filterBarProps, onClearFilters, showBranch = false }) {
  const [updatingId, setUpdatingId] = useState(null);
  const [assigningId, setAssigningId] = useState(null);
  const [nurses, setNurses] = useState([]);
  const [showRoster, setShowRoster] = useState(false);
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'map'
  const [highlightedId, setHighlightedId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
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
  const selectedRequest = useMemo(() => requests.find(r => r.id === selectedId) || null, [requests, selectedId]);

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

      {selectedRequest && (
        <NurseRequestDetailModal
          request={selectedRequest}
          nurses={nurses}
          loadByDate={loadByDate}
          updatingId={updatingId}
          assigningId={assigningId}
          showBranch={showBranch}
          onStatus={handleStatus}
          onAssign={handleAssign}
          onClose={() => setSelectedId(null)}
        />
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
          <AnimatedList
            items={displayedRequests}
            getKey={r => r.id}
            ariaLabel="Demandes d'infirmière à domicile"
            onItemSelect={r => setSelectedId(r.id)}
            onItemRef={(r, index, node) => { cardRefs.current[r.id] = node; }}
            renderItem={(r, index) => {
              const s = NURSE_STATUS[r.status] || NURSE_STATUS.pending;
              const assignedNurseName = r.assigned_nurse_id
                ? (nurses.find(n => n.id === r.assigned_nurse_id)?.name || r.assigned_nurse_name)
                : null;
              return (
                <div
                  style={{
                    background: 'white', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden',
                    cursor: 'pointer',
                    borderLeft: `4px solid ${
                      r.status === 'pending' ? 'var(--coral)' :
                      r.status === 'confirmed' ? 'var(--teal)' :
                      r.status === 'cancelled' ? '#dc2626' :
                      r.status === 'no_show' ? '#f59e0b' :
                      'var(--border)'
                    }`,
                    outline: highlightedId === r.id ? '3px solid var(--teal)' : 'none',
                    outlineOffset: 2,
                    transition: 'outline 0.2s, background 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--cream)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'white'; }}
                >
                  <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: '0.92rem', color: 'var(--navy)' }}>
                          {r.first_name && r.last_name ? `${r.first_name} ${r.last_name}` : r.username}
                        </p>
                        <span style={{ padding: '2px 9px', borderRadius: 20, fontSize: '0.7rem', fontWeight: 700, background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
                          {s.label}
                        </span>
                        {showBranch && r.branch_name && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.72rem', fontWeight: 600, color: 'var(--teal-dark)' }}>
                            <Building2 size={11} /> {r.branch_name}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {r.preferred_date && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Calendar size={12} color="var(--teal)" />
                            {format(new Date(r.preferred_date), 'dd MMM', { locale: fr })}
                            {' · '}{r.preferred_slot === 'morning' ? 'Matin' : 'Après-midi'}
                          </span>
                        )}
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <UserRound size={12} color="var(--teal)" />
                          {assignedNurseName || 'Non assignée'}
                        </span>
                      </div>
                    </div>
                    <a
                      href={`tel:${r.phone}`}
                      onClick={e => e.stopPropagation()}
                      title={r.phone}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: '50%', background: 'rgba(10,147,150,0.1)', color: 'var(--teal)', flexShrink: 0 }}
                    >
                      <Phone size={14} />
                    </a>
                    <ChevronRight size={16} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                  </div>
                </div>
              );
            }}
          />
        </>
      )}

      {!hasFilters && totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          limit={limit}
          onPageChange={onPageChange}
        />
      )}
    </div>
  );
}
import React, { useState } from 'react';
import { Search, CalendarDays, X, ListFilter } from 'lucide-react';

const NURSE_STATUS_OPTIONS = [
  { value: '',          label: 'Tous les statuts' },
  { value: 'pending',   label: 'En attente' },
  { value: 'confirmed', label: 'Confirmée' },
  { value: 'done',      label: 'Effectuée' },
  { value: 'cancelled', label: 'Annulée' },
  { value: 'no_show',   label: 'Absence' },
];

export default function NurseFilterBar({
  nameFilter, setNameFilter,
  dateFilter, setDateFilter,
  statusFilter, setStatusFilter,
  isMobile,
}) {
  const [showMoreOnMobile, setShowMoreOnMobile] = useState(false);
  const hasFilters = nameFilter.trim() || dateFilter || statusFilter;

  const styles = {
    filterField: {
      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 999, flex: 1,
    },
    filterInput: { border: 'none', outline: 'none', background: 'transparent', padding: '6px 8px', flex: 1, fontSize: '0.92rem' },
    filterSelect: { border: 'none', outline: 'none', background: 'transparent', padding: '6px 8px', fontSize: '0.92rem', color: 'var(--navy)', fontFamily: 'var(--font-body)', cursor: 'pointer' },
    filterClearBtn: { background: 'none', border: 'none', cursor: 'pointer', padding: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  };

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.12) 100%)',
      backdropFilter: 'blur(16px) saturate(180%)',
      WebkitBackdropFilter: 'blur(16px) saturate(180%)',
      padding: '3px 6px',
      marginBottom: 14,
      display: 'flex',
      flexDirection: isMobile ? 'column' : 'row',
      gap: 10,
      alignItems: isMobile ? 'stretch' : 'center',
      border: hasFilters ? '1.5px solid rgba(10,147,150,0.4)' : '1.5px solid rgba(255,255,255,0.3)',
      borderRadius: '24px',
      transition: 'all 0.3s ease',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6), 0 4px 16px rgba(0,0,0,0.08)',
    }}>
      {/* Name search */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.12) 100%)',
        backdropFilter: 'blur(16px) saturate(180%)',
        WebkitBackdropFilter: 'blur(16px) saturate(180%)',
        ...styles.filterField,
        ...(isMobile && { position: 'relative' }),
      }}>
        <Search size={18} color="var(--text-muted)" style={{ flexShrink: 0 }} />
        <input
          type="text"
          placeholder="Rechercher par nom…"
          value={nameFilter}
          onChange={e => setNameFilter(e.target.value)}
          style={styles.filterInput}
        />
        {nameFilter && (
          <button onClick={() => setNameFilter('')} style={styles.filterClearBtn} title="Effacer">
            <X size={14} />
          </button>
        )}
        {isMobile && (
          <button
            onClick={() => setShowMoreOnMobile(!showMoreOnMobile)}
            style={{
              ...styles.filterClearBtn,
              color: showMoreOnMobile || dateFilter || statusFilter ? 'var(--teal)' : 'var(--text-muted)',
              transition: 'color 0.2s',
            }}
            title="Plus de filtres"
          >
            <ListFilter size={16} />
          </button>
        )}
      </div>

      {!isMobile && <div style={{ width: 1, height: 26, background: 'var(--border)', flexShrink: 0 }} />}

      {/* Preferred date filter */}
      {(!isMobile || showMoreOnMobile) && (
        <div style={{ ...styles.filterField, flex: '0 0 auto' }}>
          {!isMobile && <CalendarDays size={18} color="var(--text-muted)" style={{ flexShrink: 0 }} />}
          <input
            type="date"
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value)}
            style={{ ...styles.filterInput, colorScheme: 'light', minWidth: 140 }}
            title="Filtrer par date préférée"
          />
          {dateFilter && (
            <button onClick={() => setDateFilter('')} style={styles.filterClearBtn} title="Effacer">
              <X size={18} />
            </button>
          )}
        </div>
      )}

      {!isMobile && <div style={{ width: 1, height: 26, background: 'var(--border)', flexShrink: 0 }} />}

      {/* Status filter */}
      {(!isMobile || showMoreOnMobile) && (
        <div style={{ ...styles.filterField, flex: '0 0 auto' }}>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            style={{ ...styles.filterSelect, minWidth: isMobile ? undefined : 150 }}
          >
            {NURSE_STATUS_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      )}

      {hasFilters && (
        <button
          onClick={() => { setNameFilter(''); setDateFilter(''); setStatusFilter(''); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '6px 12px', borderRadius: '24px',
            border: '1.5px solid var(--coral)', background: 'rgba(239,68,68,0.06)',
            color: 'var(--coral)', fontSize: '0.78rem', fontWeight: 600,
            cursor: 'pointer', fontFamily: 'var(--font-body)',
            flexShrink: 0, whiteSpace: 'nowrap',
          }}
        >
          <X size={12} /> Réinitialiser
        </button>
      )}
    </div>
  );
}
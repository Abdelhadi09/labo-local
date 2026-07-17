import React, { useState, useEffect, useRef } from 'react';
import Navbar from '../../components/Navbar';
import StatusBadge from '../../components/StatusBadge';
import Pagination from '../../components/Pagination';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useAuth } from '../../contexts/AuthContext';
import { normalize, matchesQuery, highlight } from '../../utils/search';
import { demandsAPI, servicesAPI, nurseAPI, branchesAPI } from '../../services/api';
import {
  FileText, RefreshCw, CheckCircle, Clock,
  ChevronRight, X, DollarSign, Scan, PenLine,
  AlertCircle, FlaskConical, ListChecks, Stethoscope, MapPin, Phone, Search, CalendarDays
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

// Extracted components
import FilterBar from './components/FilterBar';
import DemandCard from './components/DemandCard';
import DemandModal from './components/DemandModal';
import NurseTab from './components/NurseTab';
import NurseFilterBar from './components/NurseFilterBar';
import BranchSelect from './components/BranchSelect';
import AnimatedList from '../../components/AnimatedList';

/* ── Search helpers (accent-insensitive, keyword-aware) ── */

/* ── Filter helpers ── */
function getClientName(item) {
  if (item.first_name && item.last_name) return `${item.first_name} ${item.last_name}`;
  return item.username || '';
}
function applyFilters(items, nameFilter, dateFilter) {
  return items.filter(item => {
    // Name filter (accent-insensitive)
    if (nameFilter.trim()) {
      const name = normalize(getClientName(item));
      const q = normalize(nameFilter.trim());
      if (!q.split(/\s+/).every(w => name.includes(w))) return false;
    }
    // Single date filter — show only items created on that exact day
    if (dateFilter) {
      const d = new Date(item.created_at);
      const t = new Date(dateFilter);
      if (
        d.getFullYear() !== t.getFullYear() ||
        d.getMonth()    !== t.getMonth()    ||
        d.getDate()     !== t.getDate()
      ) return false;
    }
    return true;
  });
}

// Nurse tab filters by name, preferred visit date, and request status.
function applyNurseFilters(items, nameFilter, preferredDateFilter, statusFilter) {
  return items.filter(item => {
    if (nameFilter.trim()) {
      const name = normalize(getClientName(item));
      const q = normalize(nameFilter.trim());
      if (!q.split(/\s+/).every(w => name.includes(w))) return false;
    }
    if (preferredDateFilter) {
      if (!item.preferred_date) return false;
      const d = new Date(item.preferred_date);
      const t = new Date(preferredDateFilter);
      if (
        d.getFullYear() !== t.getFullYear() ||
        d.getMonth()    !== t.getMonth()    ||
        d.getDate()     !== t.getDate()
      ) return false;
    }
    if (statusFilter && item.status !== statusFilter) return false;
    return true;
  });
}

function typeLabel(type) {
  if (type === 'ocr') return '🖨️ Imprimée';
  if (type === 'manual') return '📋 Manuelle';
  else return '✍️ Manuscrite';
}


const NURSE_STATUS = {
  pending:   { label: 'En attente', color: '#92400e', bg: '#fef3c7', border: '#fcd34d' },
  confirmed: { label: 'Confirmée',  color: '#065f46', bg: '#d1fae5', border: '#6ee7b7' },
  done:      { label: 'Effectuée',  color: '#1e40af', bg: '#dbeafe', border: '#93c5fd' },
};


export default function WorkerDashboard() {
  const PAGE_LIMIT = 10;

  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

 // Branch list: used for the admin-only "all branches" switcher, and also
  // to plot lab locations on the nurse map for every worker (not just
  // admins). Regular workers never see the switcher itself — their scoping
  // is invisible, enforced server-side regardless of what (if anything) is
  // sent to the API.
  const [branches, setBranches] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState(null);

  useEffect(() => {
    branchesAPI.list().then(r => setBranches(r.data.data)).catch(() => {});
  }, []);

  const [tab, setTab] = useState('all');
  const [demands, setDemands] = useState([]);
  const [demandsTotal, setDemandsTotal] = useState(0);
  const [demandsPage, setDemandsPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [nurseRequests, setNurseRequests] = useState([]);
  const [nurseTotal, setNurseTotal] = useState(0);
  const [nursePage, setNursePage] = useState(1);
  const [nurseLoading, setNurseLoading] = useState(false);
  const isMobile = useIsMobile();

  // ── Shared filter state across all tabs ──
  const [nameFilter, setNameFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const hasFilters = Boolean(nameFilter.trim() || dateFilter);

  // ── Nurse tab filter state (name, preferred date, status) ──
  const [nurseNameFilter, setNurseNameFilter] = useState('');
  const [nursePreferredDateFilter, setNursePreferredDateFilter] = useState('');
  const [nurseStatusFilter, setNurseStatusFilter] = useState('');
  const hasNurseFilters = Boolean(nurseNameFilter.trim() || nursePreferredDateFilter || nurseStatusFilter);

  // Server-side pagination only returns one page's worth of rows, but the
  // name/date filters need to search across ALL of the worker's demands —
  // not just whichever page happens to be loaded, or a match sitting on
  // page 2 silently "disappears". So: filters active -> fetch every page
  // (looping at the API's max limit of 100) into `demands` and paginate
  // entirely client-side; filters cleared -> back to normal one-page-at-a-
  // time server pagination.
  const MAX_API_LIMIT = 100;

  const loadAll = async (branchId = selectedBranchId) => {
    setLoading(true);
    try {
      const first = await demandsAPI.list(1, MAX_API_LIMIT, branchId);
      let all = first.data.data;
      const total = first.data.total;
      const pages = Math.ceil(total / MAX_API_LIMIT);
      for (let p = 2; p <= pages; p++) {
        const r = await demandsAPI.list(p, MAX_API_LIMIT, branchId);
        all = all.concat(r.data.data);
      }
      setDemands(all);
      setDemandsTotal(total);
      setDemandsPage(1);
    } catch {
      // ignore — mirrors load()'s existing swallow-and-stop-spinner behavior
    } finally {
      setLoading(false);
    }
  };

  const load = (page = demandsPage) => {
    if (hasFilters) { loadAll(); return; }
    setLoading(true);
    demandsAPI.list(page, PAGE_LIMIT, selectedBranchId)
      .then(r => {
        setDemands(r.data.data);
        setDemandsTotal(r.data.total);
        setDemandsPage(r.data.page);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const loadAllNurse = async (branchId = selectedBranchId) => {
    setNurseLoading(true);
    try {
      const first = await nurseAPI.list(1, MAX_API_LIMIT, branchId);
      let all = first.data.data;
      const total = first.data.total;
      const pages = Math.ceil(total / MAX_API_LIMIT);
      for (let p = 2; p <= pages; p++) {
        const r = await nurseAPI.list(p, MAX_API_LIMIT, branchId);
        all = all.concat(r.data.data);
      }
      setNurseRequests(all);
      setNurseTotal(total);
      setNursePage(1);
    } catch {
      // ignore — mirrors loadNurse()'s existing swallow-and-stop-spinner behavior
    } finally {
      setNurseLoading(false);
    }
  };

  const loadNurse = (page = nursePage) => {
    if (hasNurseFilters) { loadAllNurse(); return; }
    setNurseLoading(true);
    nurseAPI.list(page, PAGE_LIMIT, selectedBranchId)
      .then(r => {
        setNurseRequests(r.data.data);
        setNurseTotal(r.data.total);
        setNursePage(r.data.page);
      })
      .catch(() => {})
      .finally(() => setNurseLoading(false));
  };

  useEffect(() => { if (tab === 'nurse') loadNurse(1); }, [tab]);
  // Admin switches branches — re-fetch whichever tab is currently visible
  // from page 1, same as changing any other filter.
  useEffect(() => {
    if (!isAdmin) return;
    if (tab === 'nurse') loadNurse(1); else load(1);
  }, [selectedBranchId]);
  // Filters turning on/off changes whether we need the full unpaginated
  // dataset or just one page — re-fetch accordingly. (While filters stay
  // on, we don't need to refetch on every keystroke: the fetched set
  // already has everything, applyFilters() just narrows it client-side.)
  useEffect(() => { load(1); }, [hasFilters]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'nurse') loadNurse(1); }, [hasNurseFilters]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    document.body.style.overflow = selected ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [selected]);

  const demandsPageRef = useRef(demandsPage);
  useEffect(() => { demandsPageRef.current = demandsPage; }, [demandsPage]);
  const nursePageRef = useRef(nursePage);
  useEffect(() => { nursePageRef.current = nursePage; }, [nursePage]);

  // Realtime subscriptions removed (Epic 5.1). Stopgap: poll for fresh data
  // every 30s, plus the manual "Actualiser" buttons already in the UI.
  useEffect(() => {
    const interval = setInterval(() => load(demandsPageRef.current), 300000); // 5 minutes
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (tab !== 'nurse') return;
    const interval = setInterval(() => loadNurse(nursePageRef.current), 300000); // 5 minutes
    return () => clearInterval(interval);
  }, [tab]);

  const pending   = demands.filter(d => d.status === 'pending' || d.status === 'ocr_no_match');
  const processed = demands.filter(d => ['ocr_processed', 'processed'].includes(d.status));
  const nurseCount = nurseRequests.filter(r => r.status === 'pending').length;

  const demandsTotalPages = Math.ceil(demandsTotal / PAGE_LIMIT);
  const nurseTotalPages   = Math.ceil(nurseTotal   / PAGE_LIMIT);

  const tabs = [
    { id: 'all',       label: 'Toutes',     count: demandsTotal },
    { id: 'pending',   label: 'À traiter',  count: pending.length,  urgent: true },
    { id: 'processed', label: 'Traitées',   count: processed.length },
    { id: 'nurse',     label: 'Infirmière', count: nurseCount, urgent: nurseCount > 0, icon: <Stethoscope size={14} /> },
  ];

  const baseList        = tab === 'pending' ? pending : tab === 'processed' ? processed : demands;
  const filteredDemands = applyFilters(baseList, nameFilter, dateFilter);
  const filteredNurse   = applyNurseFilters(nurseRequests, nurseNameFilter, nursePreferredDateFilter, nurseStatusFilter);

  const filterBarProps = { nameFilter, setNameFilter, dateFilter, setDateFilter, isMobile };
  const clearFilters   = () => { setNameFilter(''); setDateFilter(''); };

  const nurseFilterBarProps = {
    nameFilter: nurseNameFilter, setNameFilter: setNurseNameFilter,
    dateFilter: nursePreferredDateFilter, setDateFilter: setNursePreferredDateFilter,
    statusFilter: nurseStatusFilter, setStatusFilter: setNurseStatusFilter,
    isMobile,
  };
  const clearNurseFilters = () => { setNurseNameFilter(''); setNursePreferredDateFilter(''); setNurseStatusFilter(''); };

  const activeIndex = tabs.findIndex(t => t.id === tab);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--cream)', paddingBottom: isMobile ? 72 : 0 }}>
      <Navbar role="worker" />

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: isMobile ? '14px 12px' : '24px 20px', display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        {!isMobile && (
          <aside style={styles.sidebar}>
            <p style={styles.sidebarTitle}><FlaskConical size={14} color="var(--teal)" /> Technicien</p>
            {isAdmin && (
              <div style={{ ...styles.branchSwitcher, marginBottom: 12 }}>
                <BranchSelect
                  branches={branches}
                  value={selectedBranchId}
                  onChange={setSelectedBranchId}
                />
              </div>
            )}
            <nav style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {tabs.map(({ id, label, count, urgent, icon }) => (
                <button key={id}
                  style={{ ...styles.navItem, ...(tab === id ? styles.navActive : {}) }}
                  onClick={() => setTab(id)}>
                  {icon || null}
                  <span style={{ flex: 1 }}>{label}</span>
                  {count > 0 && (
                    <span style={{ ...styles.countBadge, background: urgent ? 'var(--coral)' : 'var(--teal)' }}>
                      {count}
                    </span>
                  )}
                </button>
              ))}
            </nav>
            <div style={styles.statsBox}>
              {[['Total', demandsTotal, 'var(--text-dark)'],
                ['À traiter', pending.length, 'var(--coral)'],
                ['Traitées', processed.length, 'var(--teal)'],
                ['Infirmières', nurseCount, 'var(--gold)']].map(([label, val, color]) => (
                <div key={label} style={styles.statRow}>
                  <span style={{ fontSize: '0.84rem' }}>{label}</span>
                  <strong style={{ color }}>{val}</strong>
                </div>
              ))}
            </div>
          </aside>
        )}

        <main style={{ flex: 1, minWidth: 0 }} className="page-enter">
          {isMobile && isAdmin && (
            <div style={{ ...styles.branchSwitcher, marginBottom: 14 }}>
              <BranchSelect
                branches={branches}
                value={selectedBranchId}
                onChange={setSelectedBranchId}
              />
            </div>
          )}
          {tab !== 'nurse' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <h2 style={{ margin: 0, fontSize: isMobile ? '1.1rem' : '1.4rem' }}>
                  {tab === 'pending' ? 'À traiter' : tab === 'processed' ? 'Traitées' : 'Toutes les demandes'}
                </h2>
                <button className="btn btn-secondary btn-sm" onClick={load}><RefreshCw size={13} /> Actualiser</button>
              </div>

              <FilterBar {...filterBarProps} />

              {tab === 'pending' && pending.length > 0 && (
                <div className="alert alert-warning" style={{ marginBottom: 14 }}>
                  <Clock size={14} style={{ flexShrink: 0 }} />
                  {pending.length} demande(s) en attente de traitement manuel
                </div>
              )}

              {loading ? (
                <div style={styles.center}><div className="spinner spinner-dark" /></div>
              ) : filteredDemands.length === 0 ? (
                <div style={styles.empty}>
                  <FileText size={32} color="var(--text-muted)" />
                  <p>{hasFilters ? 'Aucun résultat pour ces filtres' : 'Aucune demande'}</p>
                  {hasFilters && (
                    <button className="btn btn-secondary btn-sm" onClick={clearFilters}>
                      <X size={12} /> Effacer les filtres
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {hasFilters && (
                    <p style={{ margin: '0 0 10px', fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      {filteredDemands.length} résultat{filteredDemands.length > 1 ? 's' : ''} affiché{filteredDemands.length > 1 ? 's' : ''}
                    </p>
                  )}
                  <AnimatedList
                    items={filteredDemands}
                    getKey={d => d.id}
                    ariaLabel="Toutes les demandes"
                    itemClassName="worker-demand-list__item"
                    onItemSelect={d => setSelected(d)}
                    renderItem={d => (
                      <DemandCard demand={d} onSelect={() => setSelected(d)} isMobile={isMobile} showBranch={isAdmin && !selectedBranchId} />
                    )}
                  />
                </>
              )}

              {tab === 'all' && demandsTotalPages > 1 && !hasFilters && (
                <Pagination
                  page={demandsPage}
                  totalPages={demandsTotalPages}
                  total={demandsTotal}
                  limit={PAGE_LIMIT}
                  onPageChange={p => load(p)}
                />
              )}
            </>
          )}

          {tab === 'nurse' && (
            <NurseTab
              requests={filteredNurse}
              loading={nurseLoading}
              onRefresh={loadNurse}
              isMobile={isMobile}
              page={nursePage}
              totalPages={nurseTotalPages}
              total={nurseTotal}
              limit={PAGE_LIMIT}
              onPageChange={p => loadNurse(p)}
              hasFilters={hasNurseFilters}
              filterBarProps={nurseFilterBarProps}
              onClearFilters={clearNurseFilters}
              showBranch={isAdmin && !selectedBranchId}
              branches={branches}
            />
          )}
        </main>
      </div>

      {isMobile && (
        <nav style={styles.bottomNav}>
          <div style={styles.glassShine} />
          <div
            style={{
              ...styles.activePill,
              width: `calc((100% - 12px) / ${tabs.length})`,
              transform: `translateX(calc(${activeIndex} * 100%))`,
            }}
          />
          {tabs.map(({ id, label, count, urgent }) => (
            <button key={id}
              style={{ ...styles.bottomItem, ...(tab === id ? styles.bottomActive : {}) }}
              onClick={() => setTab(id)}>
              {id === 'nurse' ? <Stethoscope size={19} /> : <FileText size={19} />}
              <span style={{ fontSize: '0.6rem', fontWeight: 600 }}>{label}</span>
              {count > 0 && (
                <span style={{ position: 'absolute', top: 6, right: 'calc(50% - 18px)', width: 16, height: 16, borderRadius: '50%', background: urgent ? 'var(--coral)' : 'var(--teal)', color: 'white', fontSize: '0.6rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{count}</span>
              )}
            </button>
          ))}
        </nav>
      )}

      {selected && (
        <DemandModal demand={selected} isMobile={isMobile} onClose={() => { setSelected(null); load(); }} />
      )}
    </div>
  );
}




const styles = {
  sidebar: { width: 230, flexShrink: 0, background: 'white', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', padding: 16, position: 'sticky', top: 76 },
  sidebarTitle: { display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', marginBottom: 12 },
  navItem: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.88rem', fontWeight: 500, transition: 'all 0.15s', textAlign: 'left', width: '100%', WebkitTapHighlightColor: 'transparent' },
  navActive: { background: 'rgba(10,147,150,0.08)', color: 'var(--teal-dark)' },
  countBadge: { minWidth: 20, height: 20, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700, color: 'white', padding: '0 5px' },
  statsBox: { marginTop: 16, padding: 12, background: 'var(--cream)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: 8 },
  statRow: { display: 'flex', justifyContent: 'space-between' },
  branchSwitcher: { display: 'flex', alignItems: 'center', gap: 6, background: 'var(--cream)', borderRadius: 'var(--radius-md)', padding: '6px 10px', border: '1px solid var(--border)' },
  priceTag: { fontWeight: 700, fontSize: '0.84rem', color: 'var(--teal-dark)', background: 'rgba(10,147,150,0.08)', padding: '3px 8px', borderRadius: 20 },
  center: { display: 'flex', justifyContent: 'center', padding: 48 },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '60px 24px', color: 'var(--text-muted)' },
  bottomNav: {
    position: 'fixed', bottom: 16, left: 16, right: 16, height: 68,
    background: 'linear-gradient(180deg, rgba(255,255,255,0.32) 0%, rgba(255,255,255,0.16) 100%)',
    backdropFilter: 'blur(24px) saturate(180%)', WebkitBackdropFilter: 'blur(24px) saturate(180%)',
    borderRadius: 999, border: '1px solid rgba(255,255,255,0.35)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.8), inset 0 -1px 0 rgba(255,255,255,0.15), 0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)',
    display: 'flex', alignItems: 'center', padding: 6, overflow: 'hidden', zIndex: 200,
  },
  glassShine: {
    position: 'absolute', top: '-50%', left: '-20%', width: '140%', height: '200%',
    background: 'linear-gradient(120deg, transparent 30%, rgba(255,255,255,0.25) 50%, transparent 70%)',
    transform: 'rotate(-8deg)', pointerEvents: 'none',
  },
  activePill: {
    position: 'absolute', top: 6, left: 6, height: 'calc(100% - 12px)', borderRadius: 999,
    background: 'rgba(73, 73, 73, 0.2)', backdropFilter: 'blur(12px)',
    border: '1px solid rgba(255,255,255,0.45)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.8), 0 4px 16px rgba(0,0,0,0.08)',
    transition: 'transform 400ms cubic-bezier(.34,1.56,.64,1)', zIndex: 0,
  },
  bottomItem: {
    flex: 1, position: 'relative', zIndex: 2,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', border: 'none', transition: 'color 250ms ease',
  },
  bottomActive: { color: 'var(--teal)' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(13,27,42,0.55)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 },
  modal: { background: 'white', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 620, maxHeight: '90vh', overflow: 'auto', boxShadow: 'var(--shadow-lg)' },
  modalMobile: { maxHeight: '95vh', borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0', position: 'fixed', bottom: 0, left: 0, right: 0, maxWidth: '100%' },
  modalHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '16px 18px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'white', zIndex: 1, gap: 12 },
  closeBtn: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, borderRadius: 4, display: 'flex', alignItems: 'center', flexShrink: 0, WebkitTapHighlightColor: 'transparent' },
  modalBody: { padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 18 },
  infoGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: 12, background: 'var(--cream)', borderRadius: 'var(--radius-md)' },
  infoLabel: { fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' },
  sectionLabel: { fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 8 },
  ocrBox: { background: 'var(--cream-dark)', borderRadius: 'var(--radius-sm)', padding: 12, fontSize: '0.78rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 150, overflow: 'auto', border: '1px solid var(--border)' },
  servicesList: { border: '1.5px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' },
  serviceRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--border)' },
  totalRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 14px', background: 'var(--navy)', color: 'white', fontSize: '0.9rem', fontWeight: 700 },
  workerSearchWrap: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: '1.5px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'white' },
  workerSearchInput: { flex: 1, border: 'none', outline: 'none', fontSize: '0.85rem', fontFamily: 'var(--font-body)', background: 'transparent', color: 'var(--navy)', minWidth: 0 },
  workerClearBtn: { display: 'flex', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, flexShrink: 0 },
  filterField: { display: 'flex', alignItems: 'center', gap: 7, padding: '7px 11px', border: 'none', borderRadius: '24px', background: 'none', flex: 1, minWidth: 0 },
  filterInput: { flex: 1, border: 'none', outline: 'none', fontSize: '0.84rem', fontFamily: 'var(--font-body)', background: 'none', color: 'var(--navy)', minWidth: 0 },
  filterClearBtn: { display: 'flex', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, flexShrink: 0 },
};
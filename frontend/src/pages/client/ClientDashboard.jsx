import React, { useState, useEffect } from 'react';
import Navbar from '../../components/Navbar';
import ProfileForm from '../../components/ProfileForm';
import OrdonnanceUpload from '../../components/OrdonnanceUpload';
import StatusBadge from '../../components/StatusBadge';
import NurseRequestModal from '../../components/NurseRequestModal';
import AnimatedList from '../../components/AnimatedList';
import { useIsMobile } from '../../hooks/useIsMobile';
import { demandsAPI, profileAPI, nurseAPI } from '../../services/api';
import { LayoutDashboard, User, Upload, FileText, RefreshCw, DollarSign, FlaskConical, Stethoscope } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

function typeLabel(type) {
  if (type === 'ocr') return ' Imprimée';
  if (type === 'manual') return ' Manuelle';
  return ' Manuscrite';
}

function isProcessed(status) {
  return ['processed', 'ocr_processed'].includes(status);
}

// Ordonnance images require auth now, so they can't be linked to directly
// with a static href — fetch as a blob on click (lazily, so we're not
// pulling every image in the list up front) and open it in a new tab.
function OrdonnanceLink({ demandId, className, style, children }) {
  const [loading, setLoading] = useState(false);

  const handleClick = async (e) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      const url = await demandsAPI.getOrdonnanceUrl(demandId);
      const win = window.open(url, '_blank', 'noopener,noreferrer');
      // Revoke once the new tab has had a chance to load the image; if the
      // popup was blocked, revoke right away instead of leaking the URL.
      if (win) {
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        URL.revokeObjectURL(url);
      }
    } catch {
      // Silently ignore — e.g. file no longer exists or access was revoked.
    } finally {
      setLoading(false);
    }
  };

  return (
    <a href="#" onClick={handleClick} className={className} style={style}>
      {loading ? '…' : children}
    </a>
  );
}

export default function ClientDashboard() {
  const [tab, setTab] = useState('history');
  const [hasProfile, setHasProfile] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const isMobile = useIsMobile();

  useEffect(() => {
    profileAPI.get()
      .then((res) => {
        const exists = !!res.data;
        setHasProfile(exists);
        if (!exists) setTab('profile');
      })
      .catch(() => setTab('profile'))
      .finally(() => setProfileLoading(false));
  }, []);

  const tabs = [
    // { id: 'dashboard', label: 'Accueil',   Icon: LayoutDashboard },
     { id: 'history',   label: 'Demandes',  Icon: FileText },
    { id: 'upload',    label: 'Soumettre', Icon: Upload },
   
    { id: 'profile',   label: 'Profil',    Icon: User },
  ];
const activeIndex = tabs.findIndex(t => t.id === tab);
  if (profileLoading) return (
    <div style={{ minHeight: '100vh', background: 'var(--cream)' }}>
      <Navbar role="client" />
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <div className="spinner spinner-dark" />
      </div>
    </div>
  );

  const handleTabChange = (id) => {
    if (!hasProfile && id !== 'profile') return;
    setTab(id);
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--cream)', paddingBottom: isMobile ? 72 : 0 }}>
      <Navbar role="client" />

      <div style={{
        display: 'flex', maxWidth: 1200, margin: '0 auto',
        padding: isMobile ? '16px 12px' : '24px 20px',
        gap: 24, alignItems: 'flex-start',
      }}>
        {!isMobile && (
          <aside style={styles.sidebar}>
            <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {tabs.map(({ id, label, Icon }) => {
                const locked = !hasProfile && id !== 'profile';
                return (
                  <button key={id}
                    style={{ ...styles.navItem, ...(tab === id ? styles.navActive : {}), ...(locked ? styles.navLocked : {}) }}
                    onClick={() => handleTabChange(id)}
                    title={locked ? 'Complétez votre profil d\'abord' : ''}
                  >
                    <Icon size={17} />
                    <span>{label}</span>
                    {locked && <span style={{ marginLeft: 'auto', fontSize: '0.75rem' }}>🔒</span>}
                  </button>
                );
              })}
            </nav>
          </aside>
        )}

        <main style={{ flex: 1, minWidth: 0 }} className="page-enter">
          {!hasProfile && tab !== 'profile' && (
            <div style={styles.blockerCard}>
              <div style={styles.blockerIcon}><User size={32} color="var(--teal)" /></div>
              <h2 style={{ margin: 0, fontSize: '1.3rem' }}>Bienvenue 👋</h2>
              <p style={{ color: 'var(--text-muted)', margin: 0, textAlign: 'center', maxWidth: 360 }}>
                Avant de continuer, veuillez compléter votre profil. C'est obligatoire pour soumettre une demande.
              </p>
              <button className="btn btn-primary btn-lg" onClick={() => setTab('profile')}>
                <User size={16} /> Compléter mon profil
              </button>
            </div>
          )}

          {tab === 'dashboard' && hasProfile &&
            <DashboardTab setTab={setTab} hasProfile={hasProfile} isMobile={isMobile} />}

          {tab === 'upload' && hasProfile && (
            <div className="card">
              <div className="card-body">
                <OrdonnanceUpload onSuccess={() => setTab('history')} />
              </div>
            </div>
          )}

          {tab === 'history' && hasProfile && <HistoryTab />}

          {tab === 'profile' && (
            <div className="card">
              <div className="card-body">
                {!hasProfile && (
                  <div className="alert alert-info" style={{ marginBottom: 20 }}>
                    <User size={15} style={{ flexShrink: 0 }} />
                    Remplissez toutes les informations ci-dessous pour accéder à l'application.
                  </div>
                )}
                <ProfileForm onComplete={() => { setHasProfile(true); setTab('dashboard'); }} />
              </div>
            </div>
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
          {tabs.map(({ id, label, Icon }) => {
            const locked = !hasProfile && id !== 'profile';
            return (
              <button key={id}
                style={{ ...styles.bottomItem, ...(tab === id ? styles.bottomItemActive : {}), ...(locked ? { opacity: 0.35 } : {}) }}
                onClick={() => handleTabChange(id)}
              >
                <Icon size={21} />
                <span style={{ fontSize: '0.65rem', marginTop: 2 }}>{label}</span>
                {id === 'profile' && !hasProfile && <span style={styles.bottomDot} />}
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}

function DashboardTab({ setTab, isMobile }) {
  const [demands, setDemands] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    demandsAPI.list(1, 5).then(r => setDemands(r.data.data)).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // Realtime subscription removed (Epic 5.2). Stopgap: poll every 30s,
  // plus the manual "Actualiser" button added to the card header below.
  useEffect(() => {
    const interval = setInterval(load, 900000); // 15 minutes
    return () => clearInterval(interval);
  }, []);

  const stats = {
    total: demands.length,
    pending: demands.filter(d => d.status === 'pending').length,
    processed: demands.filter(d => isProcessed(d.status)).length,
    totalSpend: demands.filter(d => d.total_price).reduce((s, d) => s + parseFloat(d.total_price), 0),
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap: 12 }}>
        {[
          { label: 'Total',      value: stats.total,     icon: <FileText size={18} color="var(--teal)" /> },
          { label: 'En attente', value: stats.pending,   icon: <RefreshCw size={18} color="var(--gold)" /> },
          { label: 'Traitées',   value: stats.processed, icon: <FlaskConical size={18} color="var(--teal)" /> },
          { label: 'Dépenses',   value: `${stats.totalSpend.toLocaleString('fr-DZ')} DA`, icon: <DollarSign size={18} color="var(--coral)" /> },
        ].map(({ label, value, icon }) => (
          <div key={label} style={styles.statCard}>
            <div style={styles.statIcon}>{icon}</div>
            <div style={{ minWidth: 0 }}>
              <p style={{ ...styles.statValue, fontSize: isMobile ? '1.1rem' : '1.25rem' }}>{value}</p>
              <p style={styles.statLabel}>{label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Dernières demandes</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-secondary btn-sm" onClick={load}><RefreshCw size={13} /> Actualiser</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setTab('history')}>Tout voir</button>
          </div>
        </div>
        {loading ? (
          <div style={styles.center}><div className="spinner spinner-dark" /></div>
        ) : demands.length === 0 ? (
          <div style={styles.empty}>
            <Upload size={28} color="var(--text-muted)" />
            <p>Aucune demande pour l'instant</p>
            <button className="btn btn-primary btn-sm" onClick={() => setTab('upload')}>Soumettre</button>
          </div>
        ) : isMobile ? (
          <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {demands.slice(0, 5).map(d => <MobileDemandCard key={d.id} d={d} />)}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead><tr>{['Date','Type','Statut','Prix total'].map(h => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
              <tbody>
                {demands.slice(0, 5).map(d => (
                  <tr key={d.id} style={styles.tr}>
                    <td style={styles.td}>{format(new Date(d.created_at), 'dd MMM yyyy', { locale: fr })}</td>
                    <td style={styles.td}>{typeLabel(d.ordonnance_type)}</td>
                    <td style={styles.td}><StatusBadge status={d.status} /></td>
                    <td style={styles.td}>
                      {d.total_price
                        ? <strong style={{ color: 'var(--teal-dark)' }}>{Number(d.total_price).toLocaleString('fr-DZ')} DA</strong>
                        : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryTab() {
  const [demands, setDemands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [nurseModal, setNurseModal] = useState(null); // demand object
  const [nurseSuccess, setNurseSuccess] = useState(null); // demand id
  const [nurseRequests, setNurseRequests] = useState({}); // { demand_id: {id, status, preferred_date, preferred_slot, assigned_nurse_name, ...} }
  const [cancellingId, setCancellingId] = useState(null);

  const load = () => {
    setLoading(true);
    demandsAPI.list(1, 100).then(r => setDemands(r.data.data)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  // Once demands are loaded, fetch this client's own nurse requests for all
  // of them in one call, keyed by demand_id — gives real status (pending /
  // confirmed / done / cancelled / no_show) instead of a local "requested" flag.
  useEffect(() => {
    if (demands.length === 0) return;
    nurseAPI.mine(demands.map(d => d.id))
      .then(res => {
        const byDemand = {};
        (res.data?.data || []).forEach(nr => { byDemand[nr.demand_id] = nr; });
        setNurseRequests(byDemand);
      })
      .catch(() => {});
  }, [demands]);

  // Realtime subscription removed (Epic 5.2). Stopgap: poll every 30s,
  // plus the existing manual "Actualiser" button in the card header.
  useEffect(() => {
    const interval = setInterval(load, 900000); // 15 minutes
    return () => clearInterval(interval);
  }, []);

  const handleNurseSuccess = (demandId) => {
    setNurseModal(null);
    setNurseSuccess(demandId);
    // Re-fetch so the new request's real status (pending, with its date/slot)
    // replaces the optimistic "just submitted" state.
    nurseAPI.mine(demands.map(d => d.id))
      .then(res => {
        const byDemand = {};
        (res.data?.data || []).forEach(nr => { byDemand[nr.demand_id] = nr; });
        setNurseRequests(byDemand);
      })
      .catch(() => {});
    setTimeout(() => setNurseSuccess(null), 4000);
  };

  const handleCancelNurse = async (nurseRequestId, demandId) => {
    if (!window.confirm('Annuler cette demande d\'infirmière ?')) return;
    setCancellingId(nurseRequestId);
    try {
      await nurseAPI.cancel(nurseRequestId);
      setNurseRequests(prev => ({
        ...prev,
        [demandId]: { ...prev[demandId], status: 'cancelled', cancelled_by: 'client' },
      }));
    } catch (e) {
      alert(e.response?.data?.error || "Erreur lors de l'annulation");
    } finally {
      setCancellingId(null);
    }
  };
  

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {nurseSuccess && (
        <div className="alert alert-success">
          <Stethoscope size={15} style={{ flexShrink: 0 }} />
          Demande d'infirmière envoyée ! Un technicien vous contactera pour confirmer le rendez-vous.
        </div>
      )}

      <div className="cardd">
        <div className="card-header">
          <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Mes demandes</h2>
          <button className="btn btn-secondary btn-sm" onClick={load}><RefreshCw size={13} /> Actualiser</button>
        </div>

        {loading ? (
          <div style={styles.center}><div className="spinner spinner-dark" /></div>
        ) : demands.length === 0 ? (
          <div style={styles.empty}><FileText size={28} color="var(--text-muted)" /><p>Aucune demande soumise</p></div>
        ) : (
          <AnimatedList
            items={demands}
            getKey={d => d.id}
            ariaLabel="Mes demandes"
            itemClassName="client-demand-list__item"
            renderItem={d => (
              <MobileDemandCard d={d} showLink
                showNurse={isProcessed(d.status)}
                nurseRequest={nurseRequests[d.id]}
                onNurse={() => setNurseModal(d)}
                onCancelNurse={handleCancelNurse}
                cancellingNurse={cancellingId === nurseRequests[d.id]?.id}
              />
            )}
          />
        )}
      </div>

      {nurseModal && (
        <NurseRequestModal
          demand={nurseModal}
          onClose={() => setNurseModal(null)}
          onSuccess={() => handleNurseSuccess(nurseModal.id)}
        />
      )}
    </div>
  );
}

function MobileDemandCard({ d, showLink, showNurse, nurseRequest, onNurse, onCancelNurse, cancellingNurse }) {
  return (
    <div style={{
      background: 'white', borderRadius: 'var(--radius-md)', padding: '12px 14px',
      borderLeft: `3px solid ${d.status === 'pending' ? 'var(--gold)' : 'var(--teal)'}`,
      display: 'flex', flexDirection: 'column', gap: 6, boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          {format(new Date(d.created_at), 'dd MMM yyyy', { locale: fr })}
        </span>
         <span style={{ fontSize: '0.85rem' , fontWeight: 600 , marginLeft: 6 }}>{typeLabel(d.ordonnance_type)}</span>
        </div>
        <StatusBadge status={d.status} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {d.items?.length > 0 && (
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 , width: '60%' }}>
          {d.items.map(i => i.name).join(' · ')}
        </p>
      )}
        {d.total_price
          ? <strong style={{ color: 'var(--teal-dark)', fontSize: '0.92rem' }}>{Number(d.total_price).toLocaleString('fr-DZ')} DA</strong>
          : <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Prix en attente…</span>}
          
      </div>
     
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2, alignItems: 'center' , justifyContent: 'space-between'}}>
        {showLink && d.ordonnance_url && d.ordonnance_url !== 'manual' && (
          <OrdonnanceLink demandId={d.id}
            style={{ fontSize: '0.8rem', color: 'var(--teal)', fontWeight: 600 }}>
            Voir l'ordonnance 
          </OrdonnanceLink>
        )}
        {showNurse && (
          <NurseCell
            demand={d}
            nurseRequest={nurseRequest}
            onRequest={onNurse}
            onCancel={onCancelNurse}
            cancelling={cancellingNurse}
          />
        )}
      </div>
    </div>
  );
}

// Shared between desktop table and mobile card: shows the real nurse-request
// status for a demand (not just "requested or not"), and offers a cancel
// action while it's still cancellable (pending or confirmed).
const NURSE_REQUEST_LABELS = {
  pending:   { text: 'En attente de confirmation', color: '#92400e' },
  confirmed: { text: 'Confirmée', color: '#065f46' },
  done:      { text: 'Effectuée', color: '#1e40af' },
  cancelled: { text: 'Demande annulée', color: '#991b1b' },
  no_show:   { text: 'Absence constatée', color: '#78350f' },
};

function NurseCell({ demand, nurseRequest, onRequest, onCancel, cancelling }) {
  if (!isProcessed(demand.status)) {
    return <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>;
  }

  if (!nurseRequest) {
    return (
      <button className="btn btn-sm"
        style={{ background: 'rgba(233,196,106,0.15)', color: '#92400e', border: '1px solid #fcd34d', gap: 5 }}
        onClick={onRequest}>
        <Stethoscope size={12} /> Infirmière
      </button>
    );
  }

  const info = NURSE_REQUEST_LABELS[nurseRequest.status] || NURSE_REQUEST_LABELS.pending;
  const canCancel = ['pending', 'confirmed'].includes(nurseRequest.status);

  return (
    <div style={{ display: 'flex', flexDirection: 'row', gap: 3 , justifyContent: 'space-between', alignItems: 'center', width: '100%'}}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' ,flexDirection: 'column'}}>
      <span style={{ fontSize: '0.78rem', fontWeight: 600, color: info.color }}>
        {info.text}
        {nurseRequest.status === 'confirmed' && nurseRequest.assigned_nurse_name && ` · ${nurseRequest.assigned_nurse_name}`}
      </span>
      {nurseRequest.preferred_date && ['pending', 'confirmed'].includes(nurseRequest.status) && (
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          {format(new Date(nurseRequest.preferred_date), 'dd MMM', { locale: fr })}
          {' · '}{nurseRequest.preferred_slot === 'morning' ? 'Matin' : 'Après-midi'}
        </span>
      )}
      </div>
      <div>
      {canCancel && (
        <button
          onClick={() => onCancel(nurseRequest.id, demand.id)}
          disabled={cancelling}
          style={{
            fontSize: '0.72rem', color: 'white', background: 'var(--coral)', border: 'var(--coral-light)', borderRadius: 16,
            padding: '6px 10px', textAlign: 'left', cursor: 'pointer', 
            fontFamily: 'var(--font-body)', width: 'fit-content',
          }}
        >
          {cancelling ? 'Annulation…' : 'Annuler'}
        </button>
      )}
      </div>
    </div>
  );
}

const styles = {
  sidebar: {
    width: 210, flexShrink: 0, background: 'white',
    borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)',
    padding: '10px 8px', position: 'sticky', top: 76,
  },
  navItem: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
    borderRadius: 'var(--radius-sm)', border: 'none', background: 'none',
    color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font-body)',
    fontSize: '0.88rem', fontWeight: 500, transition: 'all 0.15s',
    textAlign: 'left', width: '100%', WebkitTapHighlightColor: 'transparent',
  },
  navActive: { background: 'rgba(10,147,150,0.08)', color: 'var(--teal-dark)' },
  navLocked: { opacity: 0.35, cursor: 'not-allowed' },
  blockerCard: {
    background: 'white', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)',
    padding: '48px 32px', display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: 18, textAlign: 'center',
  },
  blockerIcon: {
    width: 72, height: 72, borderRadius: '50%',
    background: 'rgba(10,147,150,0.1)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  requiredBadge: {
    background: 'var(--coral)', color: 'white', padding: '2px 10px',
    borderRadius: 20, fontSize: '0.72rem', fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.05em',
  },
  statCard: {
    background: 'white', borderRadius: 'var(--radius-md)', padding: '12px 14px',
    display: 'flex', alignItems: 'center', gap: 10, boxShadow: 'var(--shadow-sm)',
  },
  statIcon: {
    width: 36, height: 36, borderRadius: 8, background: 'var(--cream)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  statValue: { fontFamily: 'var(--font-display)', margin: 0, color: 'var(--navy)' },
  statLabel: { fontSize: '0.7rem', color: 'var(--text-muted)', margin: 0 },
  center: { display: 'flex', justifyContent: 'center', padding: 40 },
  empty: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: 12, padding: '40px 20px', color: 'var(--text-muted)', fontSize: '0.9rem',
  },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    padding: '9px 14px', background: 'var(--cream-dark)', fontSize: '0.7rem',
    fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase',
    letterSpacing: '0.06em', textAlign: 'left', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
  },
  tr: { borderBottom: '1px solid var(--border)' },
  td: { padding: '10px 14px', fontSize: '0.85rem', verticalAlign: 'middle' },
  bottomNav: {
  position: 'fixed',
  bottom: 16,
  left: 16,
  right: 16,

  height: 68,

  background:
    'linear-gradient(180deg, rgba(255,255,255,0.32) 0%, rgba(255,255,255,0.16) 100%)',

  backdropFilter: 'blur(24px) saturate(180%)',
  WebkitBackdropFilter: 'blur(24px) saturate(180%)',

  borderRadius: 999,

  border: '1px solid rgba(255,255,255,0.35)',

  boxShadow: `
    inset 0 1px 0 rgba(255,255,255,0.8),
    inset 0 -1px 0 rgba(255,255,255,0.15),
    0 8px 32px rgba(0,0,0,0.12),
    0 2px 8px rgba(0,0,0,0.08)
  `,

  display: 'flex',
  alignItems: 'center',
  padding: 6,

  overflow: 'hidden',
  zIndex: 200,
},

glassShine: {
  position: 'absolute',
  top: '-50%',
  left: '-20%',
  width: '140%',
  height: '200%',

  background:
    'linear-gradient(120deg, transparent 30%, rgba(255,255,255,0.25) 50%, transparent 70%)',

  transform: 'rotate(-8deg)',
  pointerEvents: 'none',
},
activePill: {
  position: 'absolute',
  top: 6,
  left: 6,                          // anchor here
  height: 'calc(100% - 12px)',
  // compute this dynamically in JSX
  borderRadius: 999,
  background: 'rgba(255,255,255,0.30)',
  backdropFilter: 'blur(12px)',
  border: '1px solid rgba(255,255,255,0.45)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.8), 0 4px 16px rgba(0,0,0,0.08)',
  transition: 'transform 400ms cubic-bezier(.34,1.56,.64,1)',
  zIndex: 0,
},

bottomItem: {
  flex: 1,
  position: 'relative',
  zIndex: 2,

  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',

  background: 'transparent',
  border: 'none',

  transition: 'color 250ms ease',
},

bottomItemActive: {
 

  color: 'var(--teal)',



},
  bottomDot: {
    position: 'absolute', top: 8, right: 'calc(50% - 16px)',
    width: 7, height: 7, borderRadius: '50%', background: 'var(--coral)',
  },
};
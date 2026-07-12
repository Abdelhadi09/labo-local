import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { FlaskConical, AlertCircle, CheckCircle2, ArrowLeft } from 'lucide-react';

export default function ForgotPasswordPage() {
  const isMobile = useIsMobile();

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {!isMobile && <LeftPanel />}
      <div style={{
        flex: isMobile ? '1 1 auto' : '0 0 480px',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: isMobile ? 'flex-start' : 'center',
        padding: isMobile ? '40px 20px 32px' : '40px 36px',
        background: 'var(--cream)', overflowY: 'auto',
      }}>
        {isMobile && <MobileLogo />}
        <ForgotPasswordForm isMobile={isMobile} />
      </div>
    </div>
  );
}

function LeftPanel() {
  return (
    <div style={{ flex: 1, background: 'linear-gradient(145deg, var(--navy) 0%, var(--teal-dark) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 48px' }}>
      <div style={{ maxWidth: 420 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 48 }}>
          <FlaskConical size={32} color="white" />
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', color: 'white' }}>BioLin Analyse</span>
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2rem,3vw,3rem)', color: 'white', lineHeight: 1.15, marginBottom: 20 }}>
          Votre santé,<br /><em>notre priorité.</em>
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.72)', fontSize: '1rem', lineHeight: 1.7, marginBottom: 36 }}>
          Plateforme de gestion des analyses médicales — soumettez vos ordonnances, suivez vos résultats.
        </p>
      </div>
    </div>
  );
}

function MobileLogo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32, alignSelf: 'flex-start', width: '100%', maxWidth: 420 }}>
      <div style={{ width: 48, height: 48, borderRadius: 14, background: 'linear-gradient(135deg, var(--teal) 0%, var(--teal-dark) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <FlaskConical size={26} color="white" />
      </div>
      <div>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', color: 'var(--navy)', margin: 0 }}>BioLin Analyse</p>
      </div>
    </div>
  );
}

function ForgotPasswordForm({ isMobile }) {
  const { forgotPassword } = useAuth();

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await forgotPassword(email);
      // Backend always returns a generic success message, whether or not
      // the account exists — don't let the UI leak that distinction either.
      setSent(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Une erreur est survenue');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ width: '100%', maxWidth: 420 }}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.7rem', marginBottom: 4, textAlign: isMobile ? 'center' : 'left' }}>
        Mot de passe oublié
      </h2>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: 24, textAlign: isMobile ? 'center' : 'left' }}>
        Entrez votre adresse e-mail pour recevoir un lien de réinitialisation
      </p>

      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}><AlertCircle size={14} style={{ flexShrink: 0 }} />{error}</div>}

      {sent ? (
        <div className="alert" style={{ marginBottom: 16, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>Si cette adresse e-mail est associée à un compte, vous recevrez un e-mail contenant les instructions de réinitialisation.</span>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={S.form}>
          <div className="form-group">
            <label>Adresse e-mail</label>
            <input type="email" style={S.input} value={email} onChange={e => setEmail(e.target.value)} placeholder="Adresse e-mail" required />
          </div>
          <button type="submit" className="btn btn-primary btn-lg btn-block" style={S.btnStyle} disabled={loading}>
            {loading ? <span className="spinner" /> : 'Envoyer le lien'}
          </button>
        </form>
      )}

      <div style={{ marginTop: 20, textAlign: 'center' }}>
        <Link to="/login" style={{ color: 'var(--teal)', fontWeight: 600, fontSize: '0.9rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ArrowLeft size={14} /> Retour à la connexion
        </Link>
      </div>
    </div>
  );
}

const S = {
  form: { display: 'flex', flexDirection: 'column', gap: 16 },
  input: { width: '100%', padding: '12px 14px', borderRadius: 24, border: '1.5px solid var(--border)', fontSize: '16px', fontFamily: 'var(--font-body)', background: 'white', color: 'var(--text-dark)', transition: 'border-color var(--transition)', outline: 'none' },
  btnStyle: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '14px 30px',
    borderRadius: 24,
    fontFamily: 'var(--font-body)',
    fontSize: '1rem',
    fontWeight: 500,
    border: 'none',
    cursor: 'pointer',
    transition: 'all var(--transition)',
    whiteSpace: 'nowrap',
    WebkitTapHighlightColor: 'transparent',
    touchAction: 'manipulation',
  },
};
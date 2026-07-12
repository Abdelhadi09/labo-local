const nodemailer = require('nodemailer');

let transporter = null;

const getTransporter = () => {
  if (!transporter) {
    const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD } = process.env;
    if (!SMTP_HOST) throw new Error('SMTP_HOST must be set to send email');

    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: parseInt(SMTP_PORT || '587', 10),
      secure: SMTP_SECURE === 'true', // true for port 465, false for 587/25 (STARTTLS)
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASSWORD } : undefined,
    });
  }
  return transporter;
};

const FROM = () => process.env.SMTP_FROM || 'no-reply@localhost';

/**
 * Low-level send. Kept separate from the templated helpers below so future
 * transactional emails (password reset, nurse-visit confirmation, etc.) can
 * reuse it without duplicating transporter setup.
 */
const sendEmail = async ({ to, subject, html, text }) => {
  await getTransporter().sendMail({ from: FROM(), to, subject, html, text });
};

/**
 * Verification link email sent right after POST /api/auth/register.
 * rawToken is the UNHASHED token — only the SHA-256 hash is ever stored in
 * the database (email_verifications.token_hash), same pattern as refresh
 * tokens, so a leaked DB dump can't be used to forge a verification link.
 */
const sendVerificationEmail = async (to, rawToken) => {
  const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${encodeURIComponent(rawToken)}`;

  await sendEmail({
    to,
    subject: 'Confirmez votre adresse e-mail',
    text: `Merci de vous être inscrit. Cliquez sur ce lien pour confirmer votre adresse e-mail : ${verifyUrl}\n\nCe lien expire dans 24 heures.`,
    html: `
      <p>Merci de vous être inscrit.</p>
      <p><a href="${verifyUrl}">Cliquez ici pour confirmer votre adresse e-mail</a></p>
      <p>Ou copiez ce lien dans votre navigateur :<br>${verifyUrl}</p>
      <p style="color:#666;font-size:12px">Ce lien expire dans 24 heures. Si vous n'avez pas créé de compte, ignorez cet e-mail.</p>
    `,
  });
};

/**
 * Password reset link email, sent by POST /api/auth/forgot-password.
 * Same pattern as sendVerificationEmail: rawToken is UNHASHED and only its
 * SHA-256 hash is ever stored (password_resets.token_hash), so a leaked DB
 * dump can't be used to forge a reset link.
 */
const sendPasswordResetEmail = async (to, rawToken) => {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${encodeURIComponent(rawToken)}`;

  await sendEmail({
    to,
    subject: 'Réinitialisation de votre mot de passe',
    text: `Vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur ce lien pour choisir un nouveau mot de passe : ${resetUrl}\n\nCe lien expire dans 1 heure. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.`,
    html: `
      <p>Vous avez demandé la réinitialisation de votre mot de passe.</p>
      <p><a href="${resetUrl}">Cliquez ici pour choisir un nouveau mot de passe</a></p>
      <p>Ou copiez ce lien dans votre navigateur :<br>${resetUrl}</p>
      <p style="color:#666;font-size:12px">Ce lien expire dans 1 heure. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail — votre mot de passe ne sera pas modifié.</p>
    `,
  });
};

module.exports = { sendEmail, sendVerificationEmail, sendPasswordResetEmail };
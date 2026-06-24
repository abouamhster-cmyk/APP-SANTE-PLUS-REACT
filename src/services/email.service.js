// 📁 backend/src/services/email.service.js

const axios = require('axios');

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_URL = 'https://api.brevo.com/v3';

const sendEmail = async ({ to, subject, htmlContent, textContent, sender = { name: 'Santé Plus Services', email: process.env.BREVO_SENDER_EMAIL } }) => {
  try {
    if (!htmlContent && !textContent) {
      throw new Error('Either htmlContent or textContent is required');
    }

    const payload = {
      sender,
      to: Array.isArray(to) ? to.map(email => ({ email })) : [{ email: to }],
      subject,
      htmlContent: htmlContent || textContent,
    };

    console.log('📧 Sending email to:', to);
    console.log('📧 Subject:', subject);

    const response = await axios.post(
      `${BREVO_URL}/smtp/email`,
      payload,
      {
        headers: {
          'api-key': BREVO_API_KEY,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error('❌ Brevo email error:', error.response?.data || error.message);
    throw error;
  }
};

// =============================================
// STYLES COMMUNS
// =============================================

const emailStyles = `
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
  
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    background-color: #f5f0e8;
    -webkit-font-smoothing: antialiased;
  }
  
  .container {
    max-width: 600px;
    margin: 0 auto;
    padding: 20px;
    background-color: #f5f0e8;
  }
  
  .card {
    background-color: #ffffff;
    border-radius: 24px;
    padding: 40px 32px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06);
    border: 1px solid #e5e0d8;
  }
  
  .header {
    text-align: center;
    margin-bottom: 32px;
  }
  
  .logo-container {
    display: inline-block;
    background: #1a4a3a;
    border-radius: 16px;
    padding: 12px 24px;
    margin-bottom: 16px;
  }
  
  .logo-text {
    color: #c9a84c;
    font-size: 28px;
    font-weight: 900;
    letter-spacing: -0.5px;
  }
  
  .logo-sub {
    color: rgba(255, 255, 255, 0.6);
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 2px;
    text-transform: uppercase;
  }
  
  .title {
    font-size: 24px;
    font-weight: 700;
    color: #1a4a3a;
    margin-bottom: 8px;
  }
  
  .subtitle {
    color: #6b7280;
    font-size: 16px;
  }
  
  .otp-box {
    background: #f5f0e8;
    border-radius: 16px;
    padding: 24px;
    margin: 24px 0;
    text-align: center;
    border: 2px dashed #c9a84c;
  }
  
  .otp-label {
    color: #6b7280;
    font-size: 14px;
    font-weight: 500;
    margin-bottom: 8px;
  }
  
  .otp-code {
    font-size: 40px;
    font-weight: 900;
    letter-spacing: 12px;
    color: #1a4a3a;
    font-family: 'Courier New', monospace;
  }
  
  .otp-expiry {
    color: #9ca3af;
    font-size: 12px;
    margin-top: 8px;
  }
  
  .divider {
    border: none;
    border-top: 1px solid #e5e0d8;
    margin: 24px 0;
  }
  
  .footer {
    text-align: center;
    margin-top: 32px;
    padding-top: 24px;
    border-top: 1px solid #e5e0d8;
  }
  
  .footer-text {
    color: #9ca3af;
    font-size: 12px;
    line-height: 1.6;
  }
  
  .footer-text strong {
    color: #6b7280;
  }
  
  .btn {
    display: inline-block;
    background: #1a4a3a;
    color: #ffffff;
    padding: 12px 32px;
    border-radius: 12px;
    text-decoration: none;
    font-weight: 600;
    font-size: 14px;
    margin-top: 16px;
  }
  
  @media only screen and (max-width: 480px) {
    .card {
      padding: 24px 16px;
    }
    
    .logo-text {
      font-size: 22px;
    }
    
    .title {
      font-size: 20px;
    }
    
    .otp-code {
      font-size: 32px;
      letter-spacing: 8px;
    }
    
    .otp-box {
      padding: 16px;
    }
  }
`;

// =============================================
// TEMPLATES
// =============================================

const templates = {
  // =============================================
  // OTP - Code de vérification (pour admin setup)
  // =============================================
  otp: (otp, expiresIn = 10) => ({
    subject: '🔐 Code de vérification - Santé Plus Services',
    htmlContent: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Code de vérification</title>
        <style>${emailStyles}</style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <div class="header">
              <div class="logo-container">
                <div class="logo-text">Santé Plus</div>
                <div class="logo-sub">Services</div>
              </div>
            </div>
            <h1 class="title">🔐 Code de vérification</h1>
            <p class="subtitle">Bonjour,</p>
            <p class="subtitle" style="margin-top: 8px;">
              Vous avez demandé à créer un compte administrateur pour <strong>Santé Plus Services</strong>.
            </p>
            <div class="otp-box">
              <div class="otp-label">Votre code de vérification est :</div>
              <div class="otp-code">${otp}</div>
              <div class="otp-expiry">⏱️ Ce code expire dans ${expiresIn} minutes</div>
            </div>
            <p style="color: #6b7280; font-size: 14px; margin-top: 16px;">
              Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.
            </p>
            <hr class="divider">
            <div class="footer">
              <p class="footer-text">
                <strong>Santé Plus Services</strong><br>
                Cotonou, Bénin<br>
                📧 contact@santeplus.bj | 📞 +229 01 91 34 34 58
              </p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
  }),

  // =============================================
  // BIENVENUE - FAMILLE
  // =============================================
  welcome: (name) => ({
    subject: 'Bienvenue chez Santé Plus Services 🏥',
    htmlContent: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Bienvenue</title>
        <style>${emailStyles}</style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <div class="header">
              <div class="logo-container">
                <div class="logo-text">Santé Plus</div>
                <div class="logo-sub">Services</div>
              </div>
            </div>
            <h1 class="title">Bienvenue ${name} 👋</h1>
            <p class="subtitle">Nous sommes ravis de vous compter parmi nous.</p>
            <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin-top: 16px;">
              Votre compte a été créé avec succès. Vous pouvez dès maintenant accéder à votre espace personnel.
            </p>
            <div style="text-align: center; margin: 24px 0;">
              <a href="${process.env.CLIENT_URL || 'https://sante-plus-services.com'}" class="btn">
                Accéder à mon compte
              </a>
            </div>
            <hr class="divider">
            <div class="footer">
              <p class="footer-text">
                <strong>Santé Plus Services</strong><br>
                Cotonou, Bénin<br>
                📧 contact@santeplus.bj | 📞 +229 01 91 34 34 58
              </p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
  }),

  // =============================================
  // AIDANT - CANDIDATURE EN ATTENTE (NOUVEAU)
  // =============================================
  aidantPending: (name) => ({
    subject: '📋 Candidature aidant - En attente de validation',
    htmlContent: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Candidature en attente</title>
        <style>${emailStyles}</style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <div class="header">
              <div class="logo-container">
                <div class="logo-text">Santé Plus</div>
                <div class="logo-sub">Services</div>
              </div>
            </div>
            <h1 class="title">📋 Votre candidature a été reçue</h1>
            <p class="subtitle">Bonjour ${name},</p>
            <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin-top: 16px;">
              Nous avons bien reçu votre candidature pour rejoindre l'équipe <strong>Santé Plus Services</strong> en tant qu'aidant.
            </p>
            <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin-top: 8px;">
              Notre équipe examine votre dossier dans les plus brefs délais. Vous recevrez une notification par email dès que votre compte sera validé.
            </p>
            <div style="background: #f5f0e8; border-radius: 12px; padding: 16px; margin: 20px 0;">
              <p style="margin: 4px 0; color: #4b5563;">⏳ Délai de traitement : <strong>48h maximum</strong></p>
              <p style="margin: 4px 0; color: #4b5563;">📧 Une notification vous sera envoyée</p>
            </div>
            <p style="color: #9ca3af; font-size: 13px; text-align: center;">
              En attendant, vous pouvez consulter votre espace pour suivre l'avancement de votre candidature.
            </p>
            <hr class="divider">
            <div class="footer">
              <p class="footer-text">
                <strong>Santé Plus Services</strong><br>
                Cotonou, Bénin<br>
                📧 contact@santeplus.bj | 📞 +229 01 91 34 34 58
              </p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
  }),

  // =============================================
  // AIDANT APPROUVÉ
  // =============================================
  aidantApproved: (name) => ({
    subject: '✅ Votre compte aidant est approuvé !',
    htmlContent: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Compte approuvé</title>
        <style>${emailStyles}</style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <div class="header">
              <div class="logo-container">
                <div class="logo-text">Santé Plus</div>
                <div class="logo-sub">Services</div>
              </div>
            </div>
            <h1 class="title">✅ Compte approuvé !</h1>
            <p class="subtitle">Félicitations ${name} ! 🎉</p>
            <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin-top: 16px;">
              Nous avons le plaisir de vous annoncer que votre compte aidant a été <strong>approuvé</strong>.
              Vous pouvez maintenant commencer à accepter des missions.
            </p>
            <div style="text-align: center; margin: 24px 0;">
              <a href="${process.env.CLIENT_URL || 'https://sante-plus-services.com'}/login" class="btn">
                Se connecter
              </a>
            </div>
            <hr class="divider">
            <div class="footer">
              <p class="footer-text">
                <strong>Santé Plus Services</strong><br>
                Cotonou, Bénin
              </p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
  }),

  // =============================================
  // MOT DE PASSE OUBLIÉ
  // =============================================
  forgotPassword: (name, resetLink) => ({
    subject: 'Réinitialisation de votre mot de passe 🔑',
    htmlContent: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Réinitialisation</title>
        <style>${emailStyles}</style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <div class="header">
              <div class="logo-container">
                <div class="logo-text">Santé Plus</div>
                <div class="logo-sub">Services</div>
              </div>
            </div>
            <h1 class="title">🔑 Réinitialisation</h1>
            <p class="subtitle">Bonjour ${name},</p>
            <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin-top: 16px;">
              Nous avons reçu une demande de réinitialisation de votre mot de passe.
            </p>
            <div style="text-align: center; margin: 24px 0;">
              <a href="${resetLink}" class="btn">
                Réinitialiser mon mot de passe
              </a>
            </div>
            <p style="color: #9ca3af; font-size: 13px; text-align: center;">
              Ce lien expire dans 1 heure.
            </p>
            <hr class="divider">
            <div class="footer">
              <p class="footer-text">
                Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.
              </p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
  }),

  // =============================================
  // AIDANT REFUSÉ
  // =============================================
  aidantRejected: (name) => ({
    subject: 'Candidature Santé Plus - Information',
    htmlContent: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Candidature</title>
        <style>${emailStyles}</style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <div class="header">
              <div class="logo-container">
                <div class="logo-text">Santé Plus</div>
                <div class="logo-sub">Services</div>
              </div>
            </div>
            <h1 class="title">Bonjour ${name},</h1>
            <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin-top: 16px;">
              Nous vous remercions pour l'intérêt que vous avez porté à Santé Plus Services.
            </p>
            <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin-top: 8px;">
              Après examen de votre candidature, nous ne pouvons pas donner suite à votre demande pour le moment.
            </p>
            <hr class="divider">
            <div class="footer">
              <p class="footer-text">
                Nous vous souhaitons une bonne continuation dans vos projets.
              </p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
  }),

  // =============================================
  // RAPPEL DE VISITE
  // =============================================
  visitReminder: (data) => ({
    subject: 'Rappel : Visite prévue 📅',
    htmlContent: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Rappel de visite</title>
        <style>${emailStyles}</style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <div class="header">
              <div class="logo-container">
                <div class="logo-text">Santé Plus</div>
                <div class="logo-sub">Services</div>
              </div>
            </div>
            <h1 class="title">📅 Rappel de visite</h1>
            <p class="subtitle">Bonjour,</p>
            <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin-top: 16px;">
              Une visite est prévue pour <strong>${data.patient_name}</strong> le <strong>${data.date}</strong> à <strong>${data.time}</strong>.
            </p>
            <div style="background: #f5f0e8; border-radius: 12px; padding: 16px; margin: 16px 0;">
              <p style="margin: 4px 0; color: #4b5563;">📍 ${data.address || 'Adresse non précisée'}</p>
              ${data.aidant_name ? `<p style="margin: 4px 0; color: #4b5563;">🧑‍⚕️ Aidant : ${data.aidant_name}</p>` : ''}
            </div>
            <div style="text-align: center; margin: 20px 0;">
              <a href="${process.env.CLIENT_URL || 'https://sante-plus-services.com'}/app/visits" class="btn">
                Voir les détails
              </a>
            </div>
            <hr class="divider">
            <div class="footer">
              <p class="footer-text">
                L'équipe Santé Plus Services
              </p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
  }),

  // =============================================
  // PAIEMENT CONFIRMÉ
  // =============================================
  paymentConfirmed: (data) => ({
    subject: 'Paiement confirmé ✅',
    htmlContent: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Paiement confirmé</title>
        <style>${emailStyles}</style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <div class="header">
              <div class="logo-container">
                <div class="logo-text">Santé Plus</div>
                <div class="logo-sub">Services</div>
              </div>
            </div>
            <h1 class="title">✅ Paiement confirmé</h1>
            <p class="subtitle">Bonjour,</p>
            <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin-top: 16px;">
              Nous vous confirmons la réception de votre paiement de <strong>${data.amount || '0'} FCFA</strong>.
            </p>
            <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin-top: 8px;">
              Votre abonnement <strong>${data.plan_name || 'Santé Plus'}</strong> est maintenant actif.
            </p>
            <div style="background: #f5f0e8; border-radius: 12px; padding: 16px; margin: 16px 0;">
              <p style="margin: 4px 0; color: #4b5563;">📅 Début : ${data.start_date || 'N/A'}</p>
              <p style="margin: 4px 0; color: #4b5563;">📅 Fin : ${data.end_date || 'N/A'}</p>
            </div>
            <div style="text-align: center; margin: 20px 0;">
              <a href="${process.env.CLIENT_URL || 'https://sante-plus-services.com'}/app/billing" class="btn">
                Voir mes abonnements
              </a>
            </div>
            <hr class="divider">
            <div class="footer">
              <p class="footer-text">
                L'équipe Santé Plus Services
              </p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
  }),

  // =============================================
  // ABONNEMENT EXPIRE
  // =============================================
  subscriptionExpired: (data) => ({
    subject: 'Votre abonnement arrive à expiration ⏰',
    htmlContent: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Abonnement expiration</title>
        <style>${emailStyles}</style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <div class="header">
              <div class="logo-container">
                <div class="logo-text">Santé Plus</div>
                <div class="logo-sub">Services</div>
              </div>
            </div>
            <h1 class="title">⏰ Abonnement bientôt expiré</h1>
            <p class="subtitle">Bonjour,</p>
            <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin-top: 16px;">
              Votre abonnement <strong>${data.plan_name || 'Santé Plus'}</strong> expire le <strong>${data.expiry_date || 'prochainement'}</strong>.
            </p>
            <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin-top: 8px;">
              Pour continuer à bénéficier de nos services, pensez à renouveler votre abonnement.
            </p>
            <div style="text-align: center; margin: 20px 0;">
              <a href="${process.env.CLIENT_URL || 'https://sante-plus-services.com'}/app/billing" class="btn">
                Renouveler mon abonnement
              </a>
            </div>
            <hr class="divider">
            <div class="footer">
              <p class="footer-text">
                L'équipe Santé Plus Services
              </p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
  }),

  // =============================================
  // INSCRIPTION VALIDÉE (pour famille)
  // =============================================
  registrationValidated: (data) => ({
    subject: '✅ Votre inscription est validée !',
    htmlContent: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Inscription validée</title>
        <style>${emailStyles}</style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <div class="header">
              <div class="logo-container">
                <div class="logo-text">Santé Plus</div>
                <div class="logo-sub">Services</div>
              </div>
            </div>
            <h1 class="title">✅ Inscription validée !</h1>
            <p class="subtitle">Bonjour ${data.name || ''},</p>
            <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin-top: 16px;">
              Nous avons le plaisir de vous informer que votre inscription a été <strong>validée</strong>.
              Vous pouvez dès maintenant accéder à tous nos services.
            </p>
            <div style="text-align: center; margin: 24px 0;">
              <a href="${process.env.CLIENT_URL || 'https://sante-plus-services.com'}/login" class="btn">
                Se connecter
              </a>
            </div>
            <hr class="divider">
            <div class="footer">
              <p class="footer-text">
                <strong>Santé Plus Services</strong><br>
                Cotonou, Bénin
              </p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
  }),
};

module.exports = { sendEmail, templates };

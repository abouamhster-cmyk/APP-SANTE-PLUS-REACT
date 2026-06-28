// 📁 backend/src/config/emailAssets.js

const path = require('path');
const fs = require('fs');

// ============================================================
// CONFIGURATION DES LOGOS POUR EMAILS
// ============================================================

// 🔥 En production, utiliser les URLs publiques (hébergées sur Supabase Storage ou autre CDN)
// En développement, utiliser les fichiers locaux encodés en base64

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// 📌 URLs publiques des logos (à remplacer par vos vrais URLs)
const PUBLIC_URLS = {
  // Logo principal
  logoGeneral: 'https://your-supabase-project.supabase.co/storage/v1/object/public/assets/logos/logo-general.png',
  logoGeneralWhite: 'https://your-supabase-project.supabase.co/storage/v1/object/public/assets/logos/logo-general-white.png',
  
  // Logo Maman & Bébé
  logoMaman: 'https://your-supabase-project.supabase.co/storage/v1/object/public/assets/logos/logo-maman.png',
  logoMamanWhite: 'https://your-supabase-project.supabase.co/storage/v1/object/public/assets/logos/logo-maman-white.png',
  
  // Logo Aidant
  logoAidant: 'https://your-supabase-project.supabase.co/storage/v1/object/public/assets/logos/logo-aidant.png',
  
  // Icônes
  iconEmail: 'https://your-supabase-project.supabase.co/storage/v1/object/public/assets/email/icon-email.png',
  bannerEmail: 'https://your-supabase-project.supabase.co/storage/v1/object/public/assets/email/banner-email.png',
  
  // Favicon / mini logo
  favicon: 'https://your-supabase-project.supabase.co/storage/v1/object/public/assets/logos/favicon.ico',
};

// 📌 URLs de fallback (en cas d'échec de chargement)
const FALLBACK_URLS = {
  logoGeneral: 'https://via.placeholder.com/200x60/1a4a3a/ffffff?text=Santé+Plus',
  logoMaman: 'https://via.placeholder.com/200x60/db4a6d/ffffff?text=Maman+%26+Bébé',
  logoAidant: 'https://via.placeholder.com/200x60/2c6e5c/ffffff?text=Aidant',
};

// ============================================================
// FONCTION POUR OBTENIR LE LOGO SELON LE CONTEXTE
// ============================================================

const getLogoForEmail = (type = 'general', variant = 'default') => {
  const key = type === 'maman' ? 'logoMaman' : 
              type === 'aidant' ? 'logoAidant' : 'logoGeneral';
  
  const variantKey = variant === 'white' ? `${key}White` : key;
  
  return PUBLIC_URLS[variantKey] || FALLBACK_URLS[key] || FALLBACK_URLS.logoGeneral;
};

// ============================================================
// GÉNÉRER UN LOGO EN BASE64 (pour développement)
// ============================================================

const getLogoBase64 = (type = 'general') => {
  // En développement, on peut encoder les images en base64
  // Mais c'est lourd, mieux vaut utiliser des URLs publiques
  return getLogoForEmail(type);
};

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  PUBLIC_URLS,
  FALLBACK_URLS,
  getLogoForEmail,
  getLogoBase64,
  IS_PRODUCTION,
};

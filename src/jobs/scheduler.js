// 📁 backend/src/jobs/scheduler.js

const cron = require('node-cron');
const { autoValidateOrders } = require('./auto-validate-orders');
const { checkUnapprovedVisits, sendDailyReminders } = require('../services/reminder.service');

// =============================================
// CRON JOB - TOUTES LES HEURES
// =============================================

// 1. Auto-validation des commandes (toutes les heures)
cron.schedule('0 * * * *', () => {
  console.log(`[${new Date().toISOString()}] 🔄 Auto-validation des commandes...`);
  autoValidateOrders();
});

// 2. Vérification des visites non approuvées (toutes les heures)
cron.schedule('0 * * * *', () => {
  console.log(`[${new Date().toISOString()}] 🔄 Vérification des visites non approuvées (24h)...`);
  checkUnapprovedVisits();
});

// =============================================
// CRON JOB - TOUS LES JOURS À 8H
// =============================================
cron.schedule('0 8 * * *', () => {
  console.log(`[${new Date().toISOString()}] 📅 Rappel des visites du jour...`);
  sendDailyReminders();
});

// =============================================
// CRON JOB - TOUS LES JOURS À 20H
// =============================================
cron.schedule('0 20 * * *', () => {
  console.log(`[${new Date().toISOString()}] 📅 Rappel des visites de demain...`);
  sendDailyReminders();
});

// =============================================
// LOG DE DÉMARRAGE
// =============================================
console.log('✅ Scheduler démarré avec les jobs suivants:');
console.log('  - Auto-validation des commandes (toutes les heures)');
console.log('  - Vérification des visites non approuvées (toutes les heures)');
console.log('  - Rappel des visites (8h et 20h)');

// =============================================
// EXPORT POUR LES TESTS
// =============================================
module.exports = {
  cron,
  autoValidateOrders,
  checkUnapprovedVisits,
  sendDailyReminders
};

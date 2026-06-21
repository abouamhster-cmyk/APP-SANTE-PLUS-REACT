// 📁 backend/src/jobs/reminder.job.js

// Ce fichier peut être exécuté via un cron job (node-cron) ou un scheduler

const {
  sendDailyReminders,
  sendHourReminder,
  checkSubscriptionExpiry,
  checkExpiredSubscriptions,
  checkMissedVisits,
} = require('../services/reminder.service');

// =============================================
// EXÉCUTER TOUS LES JOBS
// =============================================
const runAllJobs = async () => {
  console.log('🔄 Début des jobs de rappel...');
  
  try {
    // 1. Rappels des visites du lendemain
    console.log('📅 Envoi des rappels de visite...');
    await sendDailyReminders();
    
    // 2. Vérification des abonnements expirés
    console.log('📅 Vérification des abonnements...');
    await checkExpiredSubscriptions();
    
    // 3. Vérification des visites manquées
    console.log('📅 Vérification des visites manquées...');
    await checkMissedVisits();
    
    // 4. Rappels d'expiration des abonnements
    console.log('📅 Vérification des abonnements à expirer...');
    await checkSubscriptionExpiry();
    
    console.log('✅ Tous les jobs sont terminés');
  } catch (error) {
    console.error('❌ Erreur lors des jobs:', error);
  }
};

// =============================================
// CRON JOB - Toutes les heures
// =============================================
const runHourlyJob = async () => {
  console.log('🔄 Job horaire...');
  await sendHourReminder();
  await checkMissedVisits();
};

// =============================================
// CRON JOB - Tous les jours à 8h
// =============================================
const runDailyJob = async () => {
  console.log('🔄 Job quotidien...');
  await sendDailyReminders();
  await checkSubscriptionExpiry();
  await checkExpiredSubscriptions();
};

module.exports = {
  runAllJobs,
  runHourlyJob,
  runDailyJob,
};
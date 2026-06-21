// 📁 backend/src/jobs/scheduler.js

const cron = require('node-cron');
const { autoValidateOrders } = require('./auto-validate-orders');

// Toutes les heures
cron.schedule('0 * * * *', () => {
  console.log('🔄 Auto-validation des commandes...');
  autoValidateOrders();
});
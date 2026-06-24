// 📁 backend/server.js

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 5000;

// =============================================
// SUPABASE CLIENT
// =============================================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// =============================================
// MIDDLEWARES - Ordre IMPORTANT
// =============================================
app.use(helmet());

// ✅ Activer trust proxy pour ngrok
app.set('trust proxy', true);

app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://app-sante-plus-react-front.vercel.app'
  ],
  credentials: true,
}));

// =============================================
// ⚠️ IMPORTANT : Webhook FedaPay DOIT être avant express.json()
// =============================================
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(morgan('dev'));

// Rate limiting - avec validation désactivée
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Trop de requêtes, veuillez réessayer plus tard' },
  validate: {
    xForwardedForHeader: false, // ✅ Désactiver pour ngrok
    trustProxy: false,
  },
});
app.use('/api', limiter);

// =============================================
// ROUTES
// =============================================
const authRoutes = require('./src/routes/auth.routes');
const patientRoutes = require('./src/routes/patient.routes');
const visitRoutes = require('./src/routes/visit.routes');
const orderRoutes = require('./src/routes/order.routes');
const messageRoutes = require('./src/routes/message.routes');
const paymentRoutes = require('./src/routes/payment.routes');
const adminRoutes = require('./src/routes/admin.routes');
const notificationRoutes = require('./src/routes/notification.routes');
const billingRoutes = require('./src/routes/billing');
const reminderRoutes = require('./src/routes/reminder.routes');
const assessmentRoutes = require('./src/routes/assessment.routes');
const contractRoutes = require('./src/routes/contract.routes');
const adminSetupRoutes = require('./src/routes/adminSetup.routes');
const settingsRoutes = require('./src/routes/settings.routes');
const offerRoutes = require('./src/routes/offers.routes');


app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/visits', visitRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/reminders', reminderRoutes);
app.use('/api/assessment', assessmentRoutes);
app.use('/api/contract', contractRoutes);
app.use('/api/admin-setup', adminSetupRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/offers', offerRoutes);


// =============================================
// HEALTH CHECK
// =============================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'Santé Plus API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// =============================================
// ERROR HANDLER
// =============================================
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Erreur interne du serveur',
  });
});


// 📁 backend/server.js

// Route de confirmation pour FedaPay
app.post('/payment/confirm', express.json(), async (req, res) => {
  console.log('📥 Confirmation FedaPay reçue:', req.body);
  
  const { transaction_id, status } = req.body;
  
  // Mettre à jour le paiement
  if (status === 'approved' || status === 'paid') {
    await supabase
      .from('paiements')
      .update({ status: 'valide', paid_at: new Date().toISOString() })
      .eq('reference', transaction_id);
  }
  
  // Rediriger vers la page frontend
  res.redirect(`${process.env.CLIENT_URL}/payment/confirm?status=${status}&transaction_id=${transaction_id}`);
});

// =============================================
// START SERVER
// =============================================
app.listen(PORT, () => {
  console.log(`🚀 Santé Plus API running on port ${PORT}`);
  console.log(`📊 Health: http://localhost:${PORT}/api/health`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`💳 Webhook FedaPay: http://localhost:${PORT}/api/billing/webhook`);
});

module.exports = app;

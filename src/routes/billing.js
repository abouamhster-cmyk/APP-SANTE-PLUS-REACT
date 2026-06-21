// 📁 backend/src/routes/billing.js

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { FedaPay, Transaction } = require('fedapay');

const router = express.Router();

// ============================================================
// SUPABASE BACKEND CLIENT
// ============================================================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ============================================================
// FEDAPAY CONFIG
// ============================================================
const FEDAPAY_SECRET_KEY = process.env.FEDAPAY_SECRET_KEY?.trim();
const FEDAPAY_ENV = (process.env.FEDAPAY_ENV || 'live').trim().toLowerCase();

console.log('💳 FEDAPAY_ENV:', FEDAPAY_ENV);
console.log(
  '💳 FEDAPAY_SECRET_KEY:',
  FEDAPAY_SECRET_KEY ? FEDAPAY_SECRET_KEY.slice(0, 10) + '...' : 'AUCUNE CLÉ'
);

// ============================================================
// HEALTH ROUTE
// ============================================================
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'Billing API',
    fedapay_env: FEDAPAY_ENV,
    fedapay_key_loaded: !!FEDAPAY_SECRET_KEY,
  });
});

// ============================================================
// 💳 GÉNÉRER UN PAIEMENT FEDAPAY
// ============================================================
router.post('/generate-payment', async (req, res) => {
  try {
    // ============================================================
    // 1. VÉRIFIER L'UTILISATEUR CONNECTÉ
    // ============================================================
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '').trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token utilisateur manquant',
      });
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(token);

    if (authError || !authData?.user) {
      console.error('❌ Auth Supabase payment error:', authError);
      return res.status(401).json({
        success: false,
        message: 'Session invalide ou expirée',
      });
    }

    const user = authData.user;

    // ============================================================
    // 2. RÉCUPÉRER LE PROFIL
    // ============================================================
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('full_name, email, phone')
      .eq('id', user.id)
      .single();

    if (profileError) {
      console.error('❌ Erreur récupération profil:', profileError);
    }

    // ============================================================
    // 3. LIRE LES DONNÉES DU FRONTEND
    // ============================================================
    const {
      montant,
      amount,
      description,
      email_client,
      customer_email,
      customer_name,
      plan_id,
      abonnement_id,
      order_id = null,
      is_ponctual = false,
      order_data = null,
    } = req.body;

    console.log('📥 is_ponctual reçu du frontend:', is_ponctual);
    console.log('📥 order_data reçu:', order_data);

    const finalAmount = Number(montant || amount || 0);

    if (!finalAmount || finalAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Montant invalide',
      });
    }

    const finalEmail =
      email_client ||
      customer_email ||
      profile?.email ||
      user.email ||
      'client@santeplus.com';

    const finalName =
      customer_name ||
      profile?.full_name ||
      user.user_metadata?.full_name ||
      user.email?.split('@')[0] ||
      'Client Santé Plus';

    const firstName = finalName.split(' ')[0] || 'Client';
    const lastName = finalName.split(' ').slice(1).join(' ') || 'Santé Plus';

    const frontendUrl =
      process.env.FRONTEND_URL ||
      process.env.CLIENT_URL ||
      'http://localhost:5173';

    const callbackUrl = `${frontendUrl}/payment/confirm`;
    const cancelUrl = `${frontendUrl}/payment/confirm?status=cancel`;

    // ============================================================
    // 4. INITIALISER FEDAPAY
    // ============================================================
    FedaPay.setApiKey(FEDAPAY_SECRET_KEY);
    FedaPay.setEnvironment(FEDAPAY_ENV === 'sandbox' ? 'sandbox' : 'live');

    console.log('💳 Création paiement FedaPay:', {
      env: FEDAPAY_ENV === 'sandbox' ? 'sandbox' : 'live',
      amount: Math.round(finalAmount),
      email: finalEmail,
      description: description || 'Abonnement Santé Plus',
      is_ponctual: is_ponctual || false,
    });

    // ============================================================
    // 5. CRÉER LA TRANSACTION FEDAPAY
    // ============================================================
    const transaction = await Transaction.create({
      description: description || 'Abonnement Santé Plus',
      amount: Math.round(finalAmount),
      currency: {
        iso: 'XOF',
      },
      callback_url: callbackUrl,
      cancel_url: cancelUrl,
      customer: {
        email: finalEmail,
        firstname: firstName,
        lastname: lastName,
      },
      metadata: {
        user_id: user.id,
        plan_id: plan_id || null,
        abonnement_id: abonnement_id || null,
        order_id: order_id || null,
        is_ponctual: is_ponctual || false,
        source: 'sante_plus_services',
        order_data: is_ponctual ? order_data : null,
      },
    });

    console.log('✅ Transaction FedaPay créée:', transaction?.id);
    console.log('📦 Métadonnées envoyées:', transaction?.metadata);

    const paymentUrl =
      transaction?.payment_url ||
      transaction?.url ||
      transaction?.checkout_url;

    if (!paymentUrl) {
      console.error('❌ Transaction FedaPay sans payment_url:', transaction);
      return res.status(500).json({
        success: false,
        message: "FedaPay n'a pas retourné de lien de paiement",
        details: transaction,
      });
    }

    // ============================================================
    // 6. ENREGISTRER LE PAIEMENT EN BASE
    // ============================================================
    const paymentData = {
      user_id: user.id,
      amount: finalAmount,
      currency: 'XOF',
      method: 'fedapay',
      reference: transaction.id,
      status: 'en_attente',
      metadata: {
        description: description || 'Abonnement Santé Plus',
        plan_id: plan_id || null,
        abonnement_id: abonnement_id || null,
        order_id: order_id || null,
        is_ponctual: is_ponctual || false,
        transaction_id: transaction.id,
        payment_url: paymentUrl,
        order_data: is_ponctual ? order_data : null,
      },
    };

    console.log('📝 Enregistrement paiement en base:', {
      reference: transaction.id,
      user_id: user.id,
      amount: finalAmount,
      is_ponctual: is_ponctual,
    });

    const { data: payment, error: dbError } = await supabase
      .from('paiements')
      .insert(paymentData)
      .select()
      .single();

    if (dbError) {
      console.error('❌ ERREUR SAUVEGARDE PAIEMENT:', dbError);
      console.error('❌ Détails:', {
        code: dbError.code,
        message: dbError.message,
        details: dbError.details,
      });
    } else {
      console.log('✅ Paiement enregistré en base:', payment?.id);
    }

    // ============================================================
    // 7. RÉPONSE
    // ============================================================
    return res.json({
      success: true,
      payment_url: paymentUrl,
      url: paymentUrl,
      checkout_url: paymentUrl,
      transaction_id: transaction.id,
      reference: transaction.reference || `FEDAPAY-${transaction.id}`,
      raw: transaction,
    });

  } catch (err) {
    console.error('❌ Erreur création transaction FedaPay:', err);

    const fedapayErrors = err?.httpResponse?.data?.errors || null;
    const errorMessage = err?.httpResponse?.data?.message || err?.message || 'Impossible de créer la transaction FedaPay';

    return res.status(500).json({
      success: false,
      message: errorMessage,
      error: errorMessage,
      errors: fedapayErrors,
      details: {
        name: err?.name,
        message: err?.message,
        stack: process.env.NODE_ENV === 'development' ? err?.stack : undefined,
      },
    });
  }
});

// ============================================================
// ✅ VÉRIFIER LE STATUT D'UN PAIEMENT
// ============================================================
router.get('/verify-payment', async (req, res) => {
  try {
    const { transaction_id, reference } = req.query;

    if (!transaction_id && !reference) {
      return res.status(400).json({
        success: false,
        message: 'Transaction ID ou référence requis',
      });
    }

    let query = supabase.from('paiements').select('*');

    if (transaction_id) {
      query = query.eq('reference', transaction_id);
    } else if (reference) {
      query = query.eq('reference', reference);
    }

    const { data, error } = await query.single();

    if (error) {
      return res.status(404).json({
        success: false,
        message: 'Paiement non trouvé',
      });
    }

    try {
      const transaction = await Transaction.retrieve(data.reference);
      if (transaction && transaction.status === 'paid' && data.status !== 'valide') {
        await supabase
          .from('paiements')
          .update({
            status: 'valide',
            paid_at: new Date().toISOString(),
          })
          .eq('id', data.id);

        data.status = 'valide';
      }
    } catch (fedapayError) {
      console.warn('⚠️ Erreur vérification FedaPay:', fedapayError);
    }

    res.json({
      success: data.status === 'valide',
      payment: data,
    });
  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la vérification',
    });
  }
});

// ============================================================
// 🔔 WEBHOOK FEDAPAY - Version corrigée
// ============================================================
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    // ✅ Parsing robuste du body
    let body = req.body;
    
    if (Buffer.isBuffer(body)) {
      const str = body.toString('utf8');
      body = JSON.parse(str);
    } else if (typeof body === 'string') {
      body = JSON.parse(body);
    } else if (Array.isArray(body) && body.length > 0) {
      body = body[0];
    }

    console.log('📥 Webhook reçu - body parsé:', JSON.stringify(body, null, 2));

    // ✅ Accepter "event" ou "name" (FedaPay utilise "name")
    const event = body?.event || body?.name;
    const data = body?.data || body?.entity;

    if (!event) {
      console.warn('⚠️ Événement manquant dans le body:', body);
      return res.status(400).json({ 
        success: false, 
        error: 'Événement manquant',
        received: body 
      });
    }

    console.log('📥 Événement reçu:', event);
    console.log('📥 Data ID:', data?.id);

    // ✅ Accepter transaction.approved (et transaction.paid pour compatibilité)
    if (event === 'transaction.approved' || event === 'transaction.paid') {
      const transactionId = data.id;
      const metadata = data.metadata || {};

      console.log('💰 Transaction approuvée:', transactionId);
      console.log('📦 Métadonnées reçues:', metadata);

      // ✅ 1. RECHERCHER LE PAIEMENT
      const { data: payment, error: findError } = await supabase
        .from('paiements')
        .select('*')
        .eq('reference', transactionId)
        .maybeSingle();

      if (findError) {
        console.error('❌ Erreur recherche paiement:', findError);
        return res.status(500).json({
          success: false,
          error: 'Erreur lors de la recherche du paiement',
          details: findError.message,
        });
      }

      // ✅ 2. SI LE PAIEMENT N'EXISTE PAS - Le créer
      if (!payment) {
        console.warn('⚠️ Paiement non trouvé pour transaction:', transactionId);
        console.log('📝 Création du paiement depuis le webhook...');

        const { data: newPayment, error: createError } = await supabase
          .from('paiements')
          .insert({
            user_id: metadata.user_id || null,
            amount: data.amount || 0,
            currency: 'XOF',
            method: 'fedapay',
            reference: transactionId,
            status: 'valide',
            paid_at: new Date().toISOString(),
            provider_reference: transactionId,
            metadata: {
              is_ponctual: metadata.is_ponctual || false,
              order_data: metadata.order_data || null,
              transaction_id: transactionId,
            },
          })
          .select()
          .single();

        if (createError) {
          console.error('❌ Erreur création paiement depuis webhook:', createError);
          return res.status(500).json({
            success: false,
            error: 'Erreur lors de la création du paiement',
            details: createError.message,
          });
        }

        console.log('✅ Paiement créé depuis le webhook:', newPayment.id);

        // ✅ 3. CRÉER LA COMMANDE SI PONCTUELLE
        if (metadata.is_ponctual) {
          await createPonctualOrder(newPayment, metadata, transactionId);
        }

        // ✅ 4. SI ABONNEMENT - L'activer
        if (metadata.abonnement_id) {
          console.log('📦 Activation de l\'abonnement:', metadata.abonnement_id);
          await supabase
            .from('abonnements')
            .update({ status: 'actif' })
            .eq('id', metadata.abonnement_id);
        }

        // ✅ 5. NOTIFICATION
        await supabase.from('notifications').insert({
          user_id: newPayment.user_id,
          title: '✅ Paiement confirmé',
          body: `Votre paiement de ${newPayment.amount} FCFA a été confirmé.`,
          type: 'paiement',
          data: { payment_id: newPayment.id },
        });

        return res.json({
          success: true,
          message: 'Paiement créé et traité avec succès',
          payment_id: newPayment.id,
        });
      }

      // ✅ 6. SI LE PAIEMENT EXISTE - Le mettre à jour
      console.log('✅ Paiement trouvé:', payment.id);

      const { data: updatedPayment, error: updateError } = await supabase
        .from('paiements')
        .update({
          status: 'valide',
          paid_at: new Date().toISOString(),
          provider_reference: transactionId,
        })
        .eq('id', payment.id)
        .select()
        .single();

      if (updateError) {
        console.error('❌ Erreur mise à jour paiement:', updateError);
        return res.status(500).json({
          success: false,
          error: 'Erreur lors de la mise à jour du paiement',
        });
      }

      // ✅ 7. CRÉER LA COMMANDE SI PONCTUELLE
      const isPonctual = payment.metadata?.is_ponctual || metadata?.is_ponctual || false;

      if (isPonctual) {
        await createPonctualOrder(updatedPayment, metadata, transactionId);
      }

      // ✅ 8. SI ABONNEMENT - L'activer
      const subscriptionId = payment.metadata?.subscriptionId || metadata?.subscriptionId;
      if (subscriptionId) {
        console.log('📦 Activation de l\'abonnement:', subscriptionId);
        await supabase
          .from('abonnements')
          .update({ status: 'actif' })
          .eq('id', subscriptionId);
      }

      // ✅ 9. NOTIFICATION
      await supabase.from('notifications').insert({
        user_id: payment.user_id,
        title: '✅ Paiement confirmé',
        body: `Votre paiement de ${payment.amount} FCFA a été confirmé.`,
        type: 'paiement',
        data: { payment_id: payment.id },
      });

      return res.json({
        success: true,
        message: 'Paiement traité avec succès',
        payment_id: payment.id,
      });
    }

    console.log('ℹ️ Événement ignoré:', event);
    return res.json({ 
      success: true, 
      event: event,
      message: 'Événement ignoré' 
    });

  } catch (error) {
    console.error('❌ Webhook error:', error);
    console.error('❌ Stack:', error.stack);
    console.error('❌ Body reçu brut:', req.body);
    return res.status(500).json({
      success: false,
      error: error.message || 'Erreur interne du webhook',
    });
  }
});

// ============================================================
// 🔧 FONCTION HELPER - Créer une commande ponctuelle
// ============================================================
// ============================================================
// 🔧 FONCTION HELPER - Créer une commande ponctuelle
// ============================================================
async function createPonctualOrder(payment, metadata, transactionId) {
  try {
    const orderData = payment.metadata?.order_data || metadata?.order_data || {};
    
    console.log('📦 Création commande ponctuelle...');
    console.log('📦 orderData:', orderData);
    console.log('📦 payment.user_id:', payment.user_id);

    // ✅ Vérifier si une commande existe déjà pour CETTE transaction (éviter les doublons de webhook)
    const { data: existingOrders } = await supabase
      .from('commandes')
      .select('id')
      .eq('family_id', payment.user_id)
      .eq('order_type', 'ponctual')
      .eq('is_paid', true)
      .eq('metadata->>transaction_id', String(transactionId))
      .limit(1);

    if (existingOrders && existingOrders.length > 0) {
      console.log('ℹ️ Commande déjà créée pour cette transaction:', transactionId);
      return;
    }

    // ✅ Créer la commande (même contenu autorisé plusieurs fois)
    const { data: order, error: orderError } = await supabase
      .from('commandes')
      .insert({
        patient_id: orderData.patient_id || null,
        family_id: payment.user_id,
        type: orderData.type || 'autre',
        description: orderData.description || 'Commande ponctuelle',
        address: orderData.address || 'Adresse non spécifiée',
        status: 'creee',
        estimated_amount: payment.amount || 0,
        final_amount: payment.amount || 0,
        items: orderData.items || [],
        prescription_url: orderData.prescription_url || null,
        order_type: 'ponctual',
        is_paid: true,
        metadata: {
          payment_id: payment.id,
          transaction_id: transactionId,
          is_ponctual: true,
        },
      })
      .select()
      .single();

    if (orderError) {
      console.error('❌ Erreur création commande:', orderError);
      console.error('❌ Détails:', orderError.message);
      return;
    }

    console.log('✅ Commande ponctuelle créée:', order.id);

    // ✅ NOTIFICATION DE CONFIRMATION
    await supabase.from('notifications').insert({
      user_id: payment.user_id,
      title: '✅ Commande confirmée !',
      body: `Votre commande "${orderData.description || 'Commande ponctuelle'}" a été enregistrée avec succès. Vous serez notifié de son avancement.`,
      type: 'commande',
      data: { 
        order_id: order.id,
        status: 'creee',
        message: 'Commande créée avec succès'
      },
    });

    console.log('📧 Notification envoyée à l\'utilisateur:', payment.user_id);

  } catch (error) {
    console.error('❌ Erreur createPonctualOrder:', error);
  }
}

module.exports = router;

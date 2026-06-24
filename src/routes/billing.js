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
    console.log('📥 abonnement_id reçu:', abonnement_id);
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
      abonnement_id: abonnement_id || null,
    });

    // ============================================================
    // 5. CRÉER LA TRANSACTION FEDAPAY
    // ============================================================
    const metadata = {
      user_id: user.id,
      plan_id: plan_id || null,
      abonnement_id: abonnement_id || null,
      order_id: order_id || null,
      is_ponctual: is_ponctual || false,
      source: 'sante_plus_services',
      order_data: is_ponctual ? order_data : null,
    };

    if (is_ponctual) {
      delete metadata.abonnement_id;
    }

    console.log('📦 Métadonnées envoyées à FedaPay:', metadata);

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
      metadata: metadata,
    });

    console.log('✅ Transaction FedaPay créée:', transaction?.id);

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
      reference: String(transaction.id),
      status: 'en_attente',
      abonnement_id: is_ponctual ? null : (abonnement_id || plan_id || null),
      metadata: {
        description: description || 'Abonnement Santé Plus',
        plan_id: plan_id || null,
        abonnement_id: is_ponctual ? null : (abonnement_id || plan_id || null),
        order_id: order_id || null,
        is_ponctual: is_ponctual || false,
        transaction_id: String(transaction.id),
        payment_url: paymentUrl,
        order_data: is_ponctual ? order_data : null,
      },
    };

    console.log('📝 Enregistrement paiement en base:', {
      reference: transaction.id,
      user_id: user.id,
      amount: finalAmount,
      is_ponctual: is_ponctual,
      abonnement_id: is_ponctual ? null : (abonnement_id || plan_id || null),
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
      query = query.eq('reference', String(transaction_id));
    } else if (reference) {
      query = query.eq('reference', String(reference));
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
// 🔔 WEBHOOK FEDAPAY - VERSION FINALE
// ============================================================
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
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

    if (event === 'transaction.approved' || event === 'transaction.paid') {
      const transactionId = String(data.id);

      console.log('💰 Transaction approuvée:', transactionId);

      // ============================================================
      // RÉCUPÉRER LE PAIEMENT EN BASE
      // ============================================================
      let payment = await supabase
        .from('paiements')
        .select('*')
        .eq('reference', transactionId)
        .maybeSingle()
        .then(res => res.data);

      // ✅ RETRY si le paiement n'est pas encore en base
      if (!payment) {
        console.log('⏳ Paiement non trouvé, attente 2 secondes...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        payment = await supabase
          .from('paiements')
          .select('*')
          .eq('reference', transactionId)
          .maybeSingle()
          .then(res => res.data);
      }

      if (!payment) {
        console.error('❌ Paiement non trouvé après réessai');
        return res.status(404).json({
          success: false,
          error: 'Paiement non trouvé',
        });
      }

      console.log('✅ Paiement trouvé en base:', payment.id);

      // ============================================================
      // EXTRAIRE LES MÉTADONNÉES DE LA BASE
      // ============================================================
      const metadata = payment.metadata || {};
      const isPonctual = metadata.is_ponctual === true || metadata.is_ponctual === 'true';
      const subscriptionId = metadata.abonnement_id || null;
      const orderData = metadata.order_data || null;

      console.log('📦 is_ponctual (depuis base):', isPonctual);
      console.log('📦 subscriptionId (depuis base):', subscriptionId);
      console.log('📦 orderData (depuis base):', orderData);

      // ============================================================
      // METTRE À JOUR LE STATUT DU PAIEMENT
      // ============================================================
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

      const paymentRecord = updatedPayment;

      // ============================================================
      // TRAITER LA COMMANDE OU L'ABONNEMENT
      // ============================================================
      if (isPonctual) {
        // ✅ COMMANDE PONCTUELLE
        console.log('📦 Création de la commande ponctuelle...');

        // Vérifier les doublons
        const { data: existingOrders } = await supabase
          .from('commandes')
          .select('id')
          .eq('family_id', paymentRecord.user_id)
          .eq('order_type', 'ponctual')
          .eq('is_paid', true)
          .eq('metadata->>transaction_id', transactionId)
          .limit(1);

        if (existingOrders && existingOrders.length > 0) {
          console.log('ℹ️ Commande déjà créée pour cette transaction');
        } else {
          const orderDataToInsert = orderData || {};

          const { data: newOrder, error: orderError } = await supabase
            .from('commandes')
            .insert({
              patient_id: orderDataToInsert.patient_id || null,
              family_id: paymentRecord.user_id,
              type: orderDataToInsert.type || 'autre',
              description: orderDataToInsert.description || 'Commande ponctuelle',
              address: orderDataToInsert.address || 'Adresse non spécifiée',
              status: 'creee',
              estimated_amount: paymentRecord.amount || 0,
              final_amount: paymentRecord.amount || 0,
              items: orderDataToInsert.items || [],
              prescription_url: orderDataToInsert.prescription_url || null,
              order_type: 'ponctual',
              is_paid: true,
              metadata: {
                payment_id: paymentRecord.id,
                transaction_id: transactionId,
                is_ponctual: true,
              },
            })
            .select()
            .single();

          if (orderError) {
            console.error('❌ Erreur création commande:', orderError);
          } else {
            console.log('✅ Commande ponctuelle créée:', newOrder.id);

            await supabase.from('notifications').insert({
              user_id: paymentRecord.user_id,
              title: '✅ Commande confirmée !',
              body: `Votre commande "${orderDataToInsert.description || 'Commande ponctuelle'}" a été enregistrée avec succès.`,
              type: 'commande',
              data: {
                order_id: newOrder.id,
                status: 'creee',
              },
            });
          }
        }
      } else if (subscriptionId) {
        // ✅ ABONNEMENT
        console.log('📦 Activation de l\'abonnement:', subscriptionId);

        const { data: subscription, error: subError } = await supabase
          .from('abonnements')
          .update({
            status: 'actif',
            updated_at: new Date().toISOString(),
          })
          .eq('id', subscriptionId)
          .select()
          .single();

        if (subError) {
          console.error('❌ Erreur activation abonnement:', subError);
        } else {
          console.log('✅ Abonnement activé:', subscriptionId);

          await supabase.from('notifications').insert({
            user_id: paymentRecord.user_id,
            title: '✅ Abonnement activé !',
            body: `Votre abonnement est maintenant actif.`,
            type: 'paiement',
            data: {
              subscription_id: subscriptionId,
              status: 'actif',
            },
          });
        }
      }

      // ============================================================
      // NOTIFICATION DE PAIEMENT
      // ============================================================
      await supabase.from('notifications').insert({
        user_id: paymentRecord.user_id,
        title: '✅ Paiement confirmé',
        body: `Votre paiement de ${paymentRecord.amount} FCFA a été confirmé.`,
        type: 'paiement',
        data: { payment_id: paymentRecord.id },
      });

      return res.json({
        success: true,
        message: 'Paiement traité avec succès',
        payment_id: paymentRecord.id,
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

    return res.status(500).json({
      success: false,
      error: error.message || 'Erreur interne du webhook',
    });
  }
});

module.exports = router;

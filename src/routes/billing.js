// 📁 backend/src/routes/billing.js
// VERSION PRODUCTION - ROBUSTE ET FIABLE

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { FedaPay, Transaction } = require('fedapay');

const router = express.Router();

// ============================================================
// CONSTANTES ET CONFIGURATION
// ============================================================
const MAX_RETRY_ATTEMPTS = 8;
const RETRY_DELAY_MS = 1500;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

if (!FEDAPAY_SECRET_KEY) {
  console.error('❌ FEDAPAY_SECRET_KEY manquant dans les variables d\'environnement');
}

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
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// 🔧 FONCTION HELPER - RÉCUPÉRER UN PAIEMENT AVEC RETRY
// ============================================================
async function findPaymentWithRetry(transactionId) {
  let payment = null;
  let attempts = 0;

  while (attempts < MAX_RETRY_ATTEMPTS && !payment) {
    attempts++;

    if (attempts > 1) {
      console.log(`⏳ Tentative ${attempts}/${MAX_RETRY_ATTEMPTS} - Attente ${RETRY_DELAY_MS}ms...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    }

    try {
      const { data, error } = await supabase
        .from('paiements')
        .select('*')
        .eq('reference', transactionId)
        .maybeSingle();

      if (error) {
        console.error(`❌ Erreur recherche paiement (tentative ${attempts}):`, error.message);
        continue;
      }

      if (data) {
        payment = data;
        console.log(`✅ Paiement trouvé après ${attempts} tentative(s):`, payment.id);
        break;
      }
    } catch (err) {
      console.error(`❌ Exception recherche paiement (tentative ${attempts}):`, err.message);
    }
  }

  return payment;
}

// ============================================================
// 🔧 FONCTION HELPER - VALIDER UN UUID
// ============================================================
function isValidUUID(uuid) {
  if (!uuid) return false;
  return UUID_REGEX.test(uuid);
}

// ============================================================
// 🔧 FONCTION HELPER - RÉCUPÉRER UN PATIENT
// ============================================================
async function getOrCreatePatientId(userId) {
  try {
    // 1. Rechercher un patient existant via les liens familiaux
    const { data: link, error: linkError } = await supabase
      .from('patient_family_links')
      .select('patient_id, patients!inner(id, first_name, last_name, status)')
      .eq('family_id', userId)
      .eq('patients.status', 'active')
      .limit(1)
      .maybeSingle();

    if (!linkError && link) {
      return link.patient_id;
    }

    // 2. Rechercher un patient créé par l'utilisateur
    const { data: patient, error: patientError } = await supabase
      .from('patients')
      .select('id')
      .eq('created_by', userId)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (!patientError && patient) {
      return patient.id;
    }

    // 3. Aucun patient trouvé - on retourne null
    // L'abonnement sera créé sans patient (si la DB le permet)
    console.log('ℹ️ Aucun patient trouvé pour l\'utilisateur:', userId);
    return null;

  } catch (error) {
    console.error('❌ Erreur getOrCreatePatientId:', error.message);
    return null;
  }
}

// ============================================================
// 🔧 FONCTION HELPER - CRÉER UN ABONNEMENT EN ATTENTE
// ============================================================
async function createPendingSubscription(userId, offerId, offer) {
  try {
    const startDate = new Date();
    const endDate = new Date();

    switch (offer.type) {
      case 'trimestrielle':
        endDate.setMonth(endDate.getMonth() + 3);
        break;
      case 'annuelle':
        endDate.setFullYear(endDate.getFullYear() + 1);
        break;
      case 'mensuelle':
      default:
        endDate.setMonth(endDate.getMonth() + 1);
        break;
    }

    const totalVisits = offer.total_visits || offer.visits_per_week * 4 || 0;
    const totalOrders = offer.total_orders || 0;

    // Récupérer un patient si disponible
    const patientId = await getOrCreatePatientId(userId);

    console.log('📝 Création abonnement avec patient_id:', patientId);

    const subscriptionData = {
      user_id: userId,
      offre_id: offer.id,
      status: 'en_attente',
      start_date: startDate.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0],
      auto_renew: true,
      total_visits: totalVisits,
      used_visits: 0,
      remaining_visits: totalVisits,
      total_orders: totalOrders,
      used_orders: 0,
      remaining_orders: totalOrders,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Ajouter patient_id seulement s'il existe
    if (patientId) {
      subscriptionData.patient_id = patientId;
    }

    const { data: subscription, error } = await supabase
      .from('abonnements')
      .insert(subscriptionData)
      .select()
      .single();

    if (error) {
      // Si l'erreur est due à patient_id null, on réessaie sans
      if (error.code === '23502' && error.message.includes('patient_id')) {
        console.log('⚠️ patient_id null non accepté, tentative sans patient...');
        delete subscriptionData.patient_id;
        
        const { data: retrySubscription, error: retryError } = await supabase
          .from('abonnements')
          .insert(subscriptionData)
          .select()
          .single();

        if (retryError) {
          console.error('❌ Erreur création abonnement (sans patient):', retryError.message);
          return null;
        }

        console.log('✅ Abonnement créé (en attente, sans patient):', retrySubscription.id);
        return retrySubscription;
      }

      console.error('❌ Erreur création abonnement:', error.message);
      return null;
    }

    console.log('✅ Abonnement créé (en attente):', subscription.id);
    return subscription;

  } catch (error) {
    console.error('❌ Erreur createPendingSubscription:', error.message);
    return null;
  }
}

// ============================================================
// 🔧 FONCTION HELPER - CRÉER UNE COMMANDE PONCTUELLE
// ============================================================
async function createPonctualOrder(paymentRecord, transactionId, orderData) {
  try {
    // Vérifier les doublons
    const { data: existingOrders, error: checkError } = await supabase
      .from('commandes')
      .select('id')
      .eq('family_id', paymentRecord.user_id)
      .eq('order_type', 'ponctual')
      .eq('is_paid', true)
      .eq('metadata->>transaction_id', transactionId)
      .limit(1);

    if (checkError) {
      console.error('❌ Erreur vérification commande existante:', checkError.message);
      return null;
    }

    if (existingOrders && existingOrders.length > 0) {
      console.log('ℹ️ Commande déjà créée pour cette transaction:', transactionId);
      return existingOrders[0];
    }

    const orderDataToInsert = orderData || {};

    // Validation des données minimales
    if (!orderDataToInsert.description) {
      orderDataToInsert.description = 'Commande ponctuelle';
    }
    if (!orderDataToInsert.address) {
      orderDataToInsert.address = 'Adresse non spécifiée';
    }
    if (!orderDataToInsert.type) {
      orderDataToInsert.type = 'autre';
    }

    const { data: newOrder, error: orderError } = await supabase
      .from('commandes')
      .insert({
        patient_id: orderDataToInsert.patient_id || null,
        family_id: paymentRecord.user_id,
        type: orderDataToInsert.type,
        description: orderDataToInsert.description,
        address: orderDataToInsert.address,
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
      console.error('❌ Erreur création commande:', orderError.message);
      return null;
    }

    console.log('✅ Commande ponctuelle créée:', newOrder.id);

    // Notification
    await supabase.from('notifications').insert({
      user_id: paymentRecord.user_id,
      title: '✅ Commande confirmée !',
      body: `Votre commande "${orderDataToInsert.description}" a été enregistrée avec succès. Vous serez notifié de son avancement.`,
      type: 'commande',
      data: {
        order_id: newOrder.id,
        status: 'creee',
      },
    });

    return newOrder;

  } catch (error) {
    console.error('❌ Erreur createPonctualOrder:', error.message);
    return null;
  }
}

// ============================================================
// 🔧 FONCTION HELPER - ACTIVER UN ABONNEMENT
// ============================================================
async function activateSubscription(paymentRecord, subscriptionId) {
  try {
    if (!isValidUUID(subscriptionId)) {
      console.error('❌ subscriptionId n\'est pas un UUID valide:', subscriptionId);
      return null;
    }

    // Vérifier que l'abonnement existe
    const { data: existingSub, error: subCheckError } = await supabase
      .from('abonnements')
      .select('id, status, user_id')
      .eq('id', subscriptionId)
      .single();

    if (subCheckError) {
      console.error('❌ Abonnement non trouvé:', subCheckError.message);
      return null;
    }

    if (existingSub.status === 'actif') {
      console.log('ℹ️ Abonnement déjà actif:', subscriptionId);
      return existingSub;
    }

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
      console.error('❌ Erreur activation abonnement:', subError.message);
      return null;
    }

    console.log('✅ Abonnement activé:', subscriptionId);

    // Notification
    await supabase.from('notifications').insert({
      user_id: paymentRecord.user_id,
      title: '✅ Abonnement activé !',
      body: `Votre abonnement est maintenant actif. Profitez de nos services !`,
      type: 'paiement',
      data: {
        subscription_id: subscriptionId,
        status: 'actif',
      },
    });

    return subscription;

  } catch (error) {
    console.error('❌ Erreur activateSubscription:', error.message);
    return null;
  }
}

// ============================================================
// 💳 GÉNÉRER UN PAIEMENT FEDAPAY
// ============================================================
router.post('/generate-payment', async (req, res) => {
  const startTime = Date.now();

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
      console.error('❌ Auth Supabase payment error:', authError?.message || 'Utilisateur non trouvé');
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
      console.error('❌ Erreur récupération profil:', profileError.message);
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
    // 4. SI ABONNEMENT : CRÉER L'ABONNEMENT AVANT LE PAIEMENT
    // ============================================================
    let subscriptionRecord = null;
    let actualAbonnementId = null;

    if (!is_ponctual && abonnement_id) {
      // ✅ Vérifier que l'offre existe
      const { data: offer, error: offerError } = await supabase
        .from('offres')
        .select('id, name, type, price, visits_per_week, duration_days, total_visits, total_orders')
        .eq('id', abonnement_id)
        .single();

      if (offerError) {
        console.error('❌ Offre non trouvée:', offerError.message);
        return res.status(400).json({
          success: false,
          message: 'Offre non trouvée',
        });
      }

      // ✅ Créer l'abonnement en statut 'en_attente'
      subscriptionRecord = await createPendingSubscription(user.id, offer.id, offer);
      if (!subscriptionRecord) {
        console.error('❌ Échec création abonnement');
        return res.status(500).json({
          success: false,
          message: 'Erreur lors de la création de l\'abonnement. Veuillez réessayer.',
        });
      }

      actualAbonnementId = subscriptionRecord.id;
      console.log('✅ Abonnement créé (en attente):', actualAbonnementId);
    }

    // ============================================================
    // 5. INITIALISER FEDAPAY
    // ============================================================
    FedaPay.setApiKey(FEDAPAY_SECRET_KEY);
    FedaPay.setEnvironment(FEDAPAY_ENV === 'sandbox' ? 'sandbox' : 'live');

    console.log('💳 Création paiement FedaPay:', {
      env: FEDAPAY_ENV === 'sandbox' ? 'sandbox' : 'live',
      amount: Math.round(finalAmount),
      email: finalEmail,
      description: description || 'Abonnement Santé Plus',
      is_ponctual: is_ponctual || false,
      abonnement_id: actualAbonnementId || null,
    });

    // ============================================================
    // 6. CRÉER LA TRANSACTION FEDAPAY
    // ============================================================
    const metadata = {
      user_id: user.id,
      plan_id: plan_id || null,
      abonnement_id: actualAbonnementId || null,
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
    // 7. ENREGISTRER LE PAIEMENT EN BASE
    // ============================================================
    const paymentData = {
      user_id: user.id,
      amount: finalAmount,
      currency: 'XOF',
      method: 'fedapay',
      reference: String(transaction.id),
      status: 'en_attente',
      abonnement_id: actualAbonnementId || null,
      metadata: {
        description: description || 'Abonnement Santé Plus',
        plan_id: plan_id || null,
        abonnement_id: actualAbonnementId || null,
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
      abonnement_id: actualAbonnementId || null,
    });

    const { data: payment, error: dbError } = await supabase
      .from('paiements')
      .insert(paymentData)
      .select()
      .single();

    if (dbError) {
      console.error('❌ ERREUR SAUVEGARDE PAIEMENT:', dbError.message);
      console.error('❌ Détails:', {
        code: dbError.code,
        message: dbError.message,
        details: dbError.details,
      });

      // Si l'abonnement a été créé mais le paiement échoue, on le supprime
      if (subscriptionRecord && actualAbonnementId) {
        await supabase
          .from('abonnements')
          .delete()
          .eq('id', actualAbonnementId);
        console.log('🗑️ Abonnement supprimé (paiement échoué)');
      }

      return res.status(500).json({
        success: false,
        message: 'Erreur lors de l\'enregistrement du paiement. Veuillez réessayer.',
      });
    }

    console.log('✅ Paiement enregistré en base:', payment?.id);

    // ============================================================
    // 8. NOTIFICATION
    // ============================================================
    if (subscriptionRecord && actualAbonnementId) {
      await supabase.from('notifications').insert({
        user_id: user.id,
        title: '⏳ Abonnement en attente',
        body: `Votre abonnement ${description || 'Santé Plus'} est en attente de confirmation de paiement.`,
        type: 'paiement',
        data: {
          subscription_id: actualAbonnementId,
          status: 'en_attente',
        },
      });
    }

    // ============================================================
    // 9. RÉPONSE
    // ============================================================
    const duration = Date.now() - startTime;
    console.log(`⏱️ Paiement généré en ${duration}ms`);

    return res.json({
      success: true,
      payment_url: paymentUrl,
      url: paymentUrl,
      checkout_url: paymentUrl,
      transaction_id: transaction.id,
      reference: transaction.reference || `FEDAPAY-${transaction.id}`,
      subscription_id: actualAbonnementId,
      raw: transaction,
    });

  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(`❌ Erreur création transaction FedaPay (${duration}ms):`, err.message);

    const fedapayErrors = err?.httpResponse?.data?.errors || null;
    const errorMessage = err?.httpResponse?.data?.message || err?.message || 'Impossible de créer la transaction FedaPay';

    return res.status(500).json({
      success: false,
      message: errorMessage,
      error: errorMessage,
      errors: fedapayErrors,
      details: process.env.NODE_ENV === 'development' ? {
        name: err?.name,
        message: err?.message,
        stack: err?.stack,
      } : undefined,
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

    // Vérifier le statut en temps réel avec FedaPay
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
      console.warn('⚠️ Erreur vérification FedaPay:', fedapayError.message);
    }

    res.json({
      success: data.status === 'valide',
      payment: data,
    });
  } catch (error) {
    console.error('❌ Verify payment error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la vérification',
    });
  }
});

// ============================================================
// 🔔 WEBHOOK FEDAPAY - VERSION PRODUCTION
// ============================================================
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const startTime = Date.now();
  let transactionId = null;

  try {
    // ============================================================
    // 1. PARSING ROBUSTE DU BODY
    // ============================================================
    let body = req.body;

    if (Buffer.isBuffer(body)) {
      const str = body.toString('utf8');
      body = JSON.parse(str);
    } else if (typeof body === 'string') {
      body = JSON.parse(body);
    } else if (Array.isArray(body) && body.length > 0) {
      body = body[0];
    }

    console.log('📥 Webhook reçu');

    // ============================================================
    // 2. EXTRACTION DES DONNÉES
    // ============================================================
    const event = body?.event || body?.name;
    const data = body?.data || body?.entity;

    if (!event) {
      console.warn('⚠️ Événement manquant dans le body');
      return res.status(200).json({
        success: false,
        message: 'Événement manquant, webhook accepté',
      });
    }

    transactionId = String(data?.id);
    console.log(`📥 Événement reçu: ${event} | Transaction: ${transactionId}`);

    // ============================================================
    // 3. IGNORER LES ÉVÉNEMENTS NON PERTINENTS
    // ============================================================
    if (event !== 'transaction.approved' && event !== 'transaction.paid') {
      console.log(`ℹ️ Événement ignoré: ${event}`);
      return res.status(200).json({
        success: true,
        message: `Événement ${event} ignoré`,
      });
    }

    // ============================================================
    // 4. RÉCUPÉRER LE PAIEMENT EN BASE AVEC RETRY
    // ============================================================
    const payment = await findPaymentWithRetry(transactionId);

    if (!payment) {
      console.error(`❌ Paiement non trouvé après ${MAX_RETRY_ATTEMPTS} tentatives`);
      return res.status(200).json({
        success: false,
        message: 'Paiement non trouvé, webhook accepté',
        transaction_id: transactionId,
      });
    }

    // ============================================================
    // 5. EXTRAIRE LES MÉTADONNÉES
    // ============================================================
    const metadata = payment.metadata || {};
    const isPonctual = metadata.is_ponctual === true || metadata.is_ponctual === 'true';
    const subscriptionId = metadata.abonnement_id || null;
    const orderData = metadata.order_data || null;

    console.log('📦 Métadonnées extraites:', {
      isPonctual,
      subscriptionId,
      hasOrderData: !!orderData,
    });

    // ============================================================
    // 6. METTRE À JOUR LE STATUT DU PAIEMENT
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
      console.error('❌ Erreur mise à jour paiement:', updateError.message);
      // On continue pour ne pas perdre la transaction
    }

    const paymentRecord = updatedPayment || payment;

    // ============================================================
    // 7. TRAITER SELON LE TYPE
    // ============================================================
    let result = null;

    if (isPonctual) {
      // ✅ COMMANDE PONCTUELLE
      console.log('📦 Traitement commande ponctuelle...');
      result = await createPonctualOrder(paymentRecord, transactionId, orderData);

      if (result) {
        console.log('✅ Commande ponctuelle traitée avec succès');
      } else {
        console.warn('⚠️ La commande ponctuelle n\'a pas pu être créée, mais le paiement est validé');
      }

    } else if (subscriptionId) {
      // ✅ ABONNEMENT - Mettre à jour de 'en_attente' à 'actif'
      console.log('📦 Activation de l\'abonnement:', subscriptionId);
      result = await activateSubscription(paymentRecord, subscriptionId);

      if (result) {
        console.log('✅ Abonnement activé avec succès');
      } else {
        console.warn('⚠️ L\'abonnement n\'a pas pu être activé, mais le paiement est validé');
      }
    } else {
      console.warn('⚠️ Aucun abonnement ni commande ponctuelle à traiter');
    }

    // ============================================================
    // 8. NOTIFICATION DE PAIEMENT (toujours envoyée)
    // ============================================================
    try {
      await supabase.from('notifications').insert({
        user_id: paymentRecord.user_id,
        title: '✅ Paiement confirmé',
        body: `Votre paiement de ${paymentRecord.amount} FCFA a été confirmé.`,
        type: 'paiement',
        data: { payment_id: paymentRecord.id },
      });
    } catch (notifError) {
      console.error('❌ Erreur notification paiement:', notifError.message);
    }

    // ============================================================
    // 9. RÉPONSE
    // ============================================================
    const duration = Date.now() - startTime;
    console.log(`⏱️ Webhook traité en ${duration}ms`);

    return res.status(200).json({
      success: true,
      message: 'Paiement traité avec succès',
      payment_id: paymentRecord.id,
      type: isPonctual ? 'ponctual' : 'subscription',
      processed: !!result,
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ Webhook error (${duration}ms):`, error.message);
    console.error('❌ Stack:', error.stack);

    // Toujours répondre 200 pour éviter les réessais FedaPay
    return res.status(200).json({
      success: false,
      message: 'Erreur interne, webhook accepté',
      error: error.message,
      transaction_id: transactionId,
    });
  }
});

module.exports = router;

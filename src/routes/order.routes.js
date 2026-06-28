// 📁 backend/src/routes/order.routes.js
 
const express = require('express');
const router = express.Router();
const { supabase } = require('../services/supabase.service');
const authMiddleware = require('../middleware/auth.middleware');
const { createNotification } = require('../services/notification.service');

router.use(authMiddleware);

// =============================================
// LISTE DES COMMANDES
// =============================================
router.get('/', async (req, res) => {
  try {
    const { user, profile } = req;

    let query = supabase
      .from('commandes')
      .select(`
        *,
        patient:patients(*),
        aidant:aidants(*, user:profiles(*))
      `);

    if (profile.role === 'family') {
      query = query.eq('family_id', user.id);
    } else if (profile.role === 'aidant') {
      const { data: aidant } = await supabase
        .from('aidants')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (aidant) {
        query = query.eq('aidant_id', aidant.id);
      } else {
        return res.json([]);
      }
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('❌ GET orders error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// CRÉER UNE COMMANDE
// =============================================
router.post('/', async (req, res) => {
  try {
    console.log('📥 Création commande - Body reçu:', JSON.stringify(req.body, null, 2));
    console.log('📥 Utilisateur ID:', req.user?.id);

    const { 
      patient_id,
      type,
      description,
      address,
      estimated_amount,
      items,
      prescription_url,
      order_type,
      is_paid
    } = req.body;

    // ✅ Vérifier les champs obligatoires
    if (!type) {
      return res.status(400).json({ error: 'Le champ "type" est obligatoire' });
    }
    if (!description) {
      return res.status(400).json({ error: 'Le champ "description" est obligatoire' });
    }
    if (!address) {
      return res.status(400).json({ error: 'Le champ "address" est obligatoire' });
    }

    // ✅ Construction de l'objet à insérer
    const orderData = {
      patient_id: patient_id || null,
      family_id: req.user.id,
      type: type,
      description: description,
      address: address,
      estimated_amount: estimated_amount || 0,
      items: items || [],
      prescription_url: prescription_url || null,
      status: 'creee',  // ✅ Statut initial
      order_type: order_type || 'subscription',
      is_paid: is_paid || false,
    };

    console.log('📦 Données à insérer:', JSON.stringify(orderData, null, 2));

    const { data, error } = await supabase
      .from('commandes')
      .insert(orderData)
      .select('*')
      .single();

    if (error) {
      console.error('❌ Erreur Supabase insertion:', error);
      return res.status(500).json({ error: error.message, details: error });
    }

    console.log('✅ Commande créée avec succès, ID:', data.id);

    // ✅ Récupérer les relations séparément
    let patient = null;
    if (data.patient_id) {
      const { data: patientData } = await supabase
        .from('patients')
        .select('*')
        .eq('id', data.patient_id)
        .single();
      patient = patientData;
    }

    let family = null;
    if (data.family_id) {
      const { data: familyData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.family_id)
        .single();
      family = familyData;
    }

    const fullOrder = {
      ...data,
      patient,
      family,
    };

    // ✅ Notification aux coordinateurs
    try {
      const { data: coordinators } = await supabase
        .from('profiles')
        .select('id')
        .in('role', ['coordinator', 'admin']);

      if (coordinators && coordinators.length > 0) {
        for (const coordinator of coordinators) {
          await createNotification({
            userId: coordinator.id,
            title: 'Nouvelle commande',
            body: `Commande créée par ${family?.full_name || 'un patient'}`,
            type: 'commande',
            data: { order_id: data.id },
          });
        }
      }
    } catch (notifError) {
      console.warn('⚠️ Erreur notification:', notifError);
    }

    res.status(201).json({ success: true, order: fullOrder });
  } catch (error) {
    console.error('❌ Create order error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// ✅ METTRE À JOUR LE STATUT D'UNE COMMANDE (UNIFIÉ)
// =============================================
router.post('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    console.log(`📥 Mise à jour statut commande ${id} -> ${status}`);

    if (!status) {
      return res.status(400).json({ error: 'Le champ "status" est obligatoire' });
    }

    // ✅ Statuts valides selon le cycle de vie simplifié
    const validStatuses = ['creee', 'en_cours', 'livree', 'validee', 'annulee'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        error: `Statut invalide. Statuts acceptés: ${validStatuses.join(', ')}` 
      });
    }

    // ✅ Vérifier que la commande existe
    const { data: existingOrder, error: checkError } = await supabase
      .from('commandes')
      .select('status, family_id, aidant_id')
      .eq('id', id)
      .single();

    if (checkError) {
      return res.status(404).json({ error: 'Commande non trouvée' });
    }

    // ✅ Si la commande est déjà validée ou annulée, bloquer les changements
    if (existingOrder.status === 'validee' || existingOrder.status === 'annulee') {
      return res.status(400).json({ 
        error: `Impossible de modifier une commande ${existingOrder.status}` 
      });
    }

    // ✅ Mettre à jour le statut
    const { data, error } = await supabase
      .from('commandes')
      .update({ 
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      console.error('❌ Erreur mise à jour statut:', error);
      throw error;
    }

    console.log(`✅ Commande ${id} mise à jour -> ${status}`);

    // ✅ Récupérer les relations séparément
    let patient = null;
    if (data.patient_id) {
      const { data: patientData } = await supabase
        .from('patients')
        .select('*')
        .eq('id', data.patient_id)
        .single();
      patient = patientData;
    }

    let family = null;
    if (data.family_id) {
      const { data: familyData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.family_id)
        .single();
      family = familyData;
    }

    let aidant = null;
    if (data.aidant_id) {
      const { data: aidantData } = await supabase
        .from('aidants')
        .select('*, user:profiles(*)')
        .eq('id', data.aidant_id)
        .single();
      aidant = aidantData;
    }

    const fullOrder = {
      ...data,
      patient,
      family,
      aidant,
    };

    // ✅ Notification à la famille
    if (data.family_id) {
      const statusLabels = {
        creee: 'créée',
        en_cours: 'en cours',
        livree: 'livrée',
        validee: 'validée',
        annulee: 'annulée',
      };
      
      try {
        await createNotification({
          userId: data.family_id,
          title: '📦 Mise à jour commande',
          body: `Votre commande est maintenant ${statusLabels[status] || status}`,
          type: 'commande',
          data: { order_id: data.id, status },
        });
      } catch (notifError) {
        console.warn('⚠️ Erreur notification famille:', notifError);
      }
    }

    res.json({ success: true, order: fullOrder });
  } catch (error) {
    console.error('❌ Update status error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// ✅ ACCEPTER UNE COMMANDE (alias vers en_cours)
// =============================================
router.post('/:id/accept', async (req, res) => {
  try {
    const { id } = req.params;
    const { user } = req;

    // ✅ Récupérer l'aidant
    const { data: aidant, error: aidantError } = await supabase
      .from('aidants')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (aidantError || !aidant) {
      return res.status(404).json({ error: 'Aidant non trouvé' });
    }

    // ✅ Mettre à jour le statut en 'en_cours' et assigner l'aidant
    const { data, error } = await supabase
      .from('commandes')
      .update({ 
        status: 'en_cours',
        aidant_id: aidant.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;
    res.json({ success: true, order: data });
  } catch (error) {
    console.error('❌ Accept order error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// ✅ PRÉPARER UNE COMMANDE (alias - garde le statut en_cours)
// =============================================
router.post('/:id/prepare', async (req, res) => {
  try {
    const { id } = req.params;

    // ✅ On garde le statut 'en_cours' mais on met à jour la date
    const { data, error } = await supabase
      .from('commandes')
      .update({ 
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;
    res.json({ success: true, order: data });
  } catch (error) {
    console.error('❌ Prepare order error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// ✅ LIVRER UNE COMMANDE (passe en livree)
// =============================================
router.post('/:id/deliver', async (req, res) => {
  try {
    const { id } = req.params;
    const { proof_url } = req.body;

    const { data, error } = await supabase
      .from('commandes')
      .update({ 
        status: 'livree',
        proof_url: proof_url || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;
    res.json({ success: true, order: data });
  } catch (error) {
    console.error('❌ Deliver order error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// ✅ VALIDER UNE COMMANDE (passe en validee)
// =============================================
router.post('/:id/validate', async (req, res) => {
  try {
    const { id } = req.params;

    // ✅ Vérifier que la commande est livrée
    const { data: existingOrder, error: checkError } = await supabase
      .from('commandes')
      .select('status')
      .eq('id', id)
      .single();

    if (checkError) {
      return res.status(404).json({ error: 'Commande non trouvée' });
    }

    if (existingOrder.status !== 'livree') {
      return res.status(400).json({ 
        error: 'Seules les commandes livrées peuvent être validées' 
      });
    }

    const { data, error } = await supabase
      .from('commandes')
      .update({ 
        status: 'validee',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;
    res.json({ success: true, order: data });
  } catch (error) {
    console.error('❌ Validate order error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// ✅ ANNULER UNE COMMANDE
// =============================================
router.post('/:id/cancel', async (req, res) => {
  try {
    const { id } = req.params;

    // ✅ Vérifier que la commande n'est pas déjà validée ou annulée
    const { data: existingOrder, error: checkError } = await supabase
      .from('commandes')
      .select('status')
      .eq('id', id)
      .single();

    if (checkError) {
      return res.status(404).json({ error: 'Commande non trouvée' });
    }

    if (existingOrder.status === 'validee') {
      return res.status(400).json({ error: 'Impossible d\'annuler une commande validée' });
    }

    if (existingOrder.status === 'annulee') {
      return res.status(400).json({ error: 'Commande déjà annulée' });
    }

    const { data, error } = await supabase
      .from('commandes')
      .update({ 
        status: 'annulee',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;
    res.json({ success: true, order: data });
  } catch (error) {
    console.error('❌ Cancel order error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// RÉCUPÉRER UNE COMMANDE PAR ID
// =============================================
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { user, profile } = req;

    const { data, error } = await supabase
      .from('commandes')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Commande non trouvée' });
      }
      throw error;
    }

    // ✅ Vérifier les permissions
    if (profile.role === 'family' && data.family_id !== user.id) {
      return res.status(403).json({ error: 'Accès non autorisé' });
    }

    if (profile.role === 'aidant') {
      const { data: aidant } = await supabase
        .from('aidants')
        .select('id')
        .eq('user_id', user.id)
        .single();
      
      if (data.aidant_id !== aidant?.id) {
        return res.status(403).json({ error: 'Accès non autorisé' });
      }
    }

    // ✅ Récupérer les relations séparément
    let patient = null;
    if (data.patient_id) {
      const { data: patientData } = await supabase
        .from('patients')
        .select('*')
        .eq('id', data.patient_id)
        .single();
      patient = patientData;
    }

    let family = null;
    if (data.family_id) {
      const { data: familyData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.family_id)
        .single();
      family = familyData;
    }

    let aidant = null;
    if (data.aidant_id) {
      const { data: aidantData } = await supabase
        .from('aidants')
        .select('*, user:profiles(*)')
        .eq('id', data.aidant_id)
        .single();
      aidant = aidantData;
    }

    const fullOrder = {
      ...data,
      patient,
      family,
      aidant,
    };

    res.json(fullOrder);
  } catch (error) {
    console.error('❌ Get order error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

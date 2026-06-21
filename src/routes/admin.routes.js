const express = require('express');
const router = express.Router();
const { supabase } = require('../services/supabase.service');
const authMiddleware = require('../middleware/auth.middleware');
const roleMiddleware = require('../middleware/role.middleware');

router.use(authMiddleware);
router.use(roleMiddleware(['admin', 'coordinator']));

// =============================================
// STATISTIQUES
// =============================================
router.get('/stats', async (req, res) => {
  try {
    const { count: patientsCount } = await supabase
      .from('patients')
      .select('*', { count: 'exact', head: true });

    const { count: familiesCount } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'family');

    const { count: aidantsCount } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'aidant');

    const today = new Date().toISOString().split('T')[0];
    const { count: visitsToday } = await supabase
      .from('visites')
      .select('*', { count: 'exact', head: true })
      .eq('scheduled_date', today);

    const { count: visitsInProgress } = await supabase
      .from('visites')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'en_cours');

    const { count: pendingRegistrations } = await supabase
      .from('inscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'en_attente');

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { data: payments } = await supabase
      .from('paiements')
      .select('amount')
      .eq('status', 'valide')
      .gte('created_at', startOfMonth.toISOString());

    const revenue = payments?.reduce((sum, p) => sum + p.amount, 0) || 0;

    res.json({
      patients: patientsCount || 0,
      families: familiesCount || 0,
      aidants: aidantsCount || 0,
      visitsToday: visitsToday || 0,
      visitsInProgress: visitsInProgress || 0,
      pendingRegistrations: pendingRegistrations || 0,
      revenue,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// INSCRIPTIONS
// =============================================
router.get('/registrations', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('inscriptions')
      .select(`
        *,
        user:profiles(*),
        offre:offres(*)
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// TRAITER UNE INSCRIPTION
// =============================================
router.put('/registrations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, comments } = req.body;

    const { data, error } = await supabase
      .from('inscriptions')
      .update({
        status,
        comments,
        processed_by: req.user.id,
        processed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, registration: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// LISTE DES UTILISATEURS
// =============================================
router.get('/users', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// CRÉER UN AIDANT
// =============================================
router.post('/aidants', async (req, res) => {
  try {
    const { userId, specialties, available } = req.body;

    const { data: aidant, error } = await supabase
      .from('aidants')
      .insert({
        user_id: userId,
        specialties: specialties || [],
        available: available !== undefined ? available : true,
        rating: 0,
        total_missions: 0,
      })
      .select()
      .single();

    if (error) throw error;

    await supabase.from('profiles').update({ role: 'aidant' }).eq('id', userId);

    res.json({ success: true, aidant });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// OFFRES
// =============================================
router.get('/offers', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('offres')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/offers', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('offres')
      .insert(req.body)
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, offer: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/offers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('offres')
      .update(req.body)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, offer: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
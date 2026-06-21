const express = require('express');
const router = express.Router();
const { supabase } = require('../services/supabase.service');
const authMiddleware = require('../middleware/auth.middleware');
const roleMiddleware = require('../middleware/role.middleware');

router.use(authMiddleware);

// =============================================
// LISTE DES PATIENTS
// =============================================
router.get('/', async (req, res) => {
  try {
    const { user, profile } = req;

    let query = supabase.from('patients').select('*');

    if (profile.role === 'family') {
      const { data: links } = await supabase
        .from('patient_family_links')
        .select('patient_id')
        .eq('family_id', user.id);

      const patientIds = links?.map(l => l.patient_id) || [];
      if (patientIds.length > 0) {
        query = query.in('id', patientIds);
      } else {
        return res.json([]);
      }
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// PATIENT PAR ID
// =============================================
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('patients')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// CRÉER UN PATIENT
// =============================================
router.post('/', roleMiddleware(['coordinator', 'admin']), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('patients')
      .insert({ ...req.body, created_by: req.user.id })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, patient: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// MODIFIER UN PATIENT
// =============================================
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('patients')
      .update(req.body)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, patient: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// SUPPRIMER UN PATIENT
// =============================================
router.delete('/:id', roleMiddleware(['coordinator', 'admin']), async (req, res) => {
  try {
    const { id } = req.params;
    await supabase.from('patient_family_links').delete().eq('patient_id', id);
    const { error } = await supabase.from('patients').delete().eq('id', id);
    if (error) throw error;
    res.json({ success: true, message: 'Patient supprimé' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// VISITES D'UN PATIENT
// =============================================
router.get('/:id/visits', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('visites')
      .select('*, aidant:aidants(*, user:profiles(*))')
      .eq('patient_id', id)
      .order('scheduled_date', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
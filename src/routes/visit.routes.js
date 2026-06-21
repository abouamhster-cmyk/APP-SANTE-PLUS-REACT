// 📁 backend/src/routes/visit.routes.js

const express = require('express');
const router = express.Router();
const { supabase } = require('../services/supabase.service');
const authMiddleware = require('../middleware/auth.middleware');
const roleMiddleware = require('../middleware/role.middleware');
const { createNotification } = require('../services/notification.service');

router.use(authMiddleware);

// =============================================
// LISTE DES VISITES
// =============================================
router.get('/', async (req, res) => {
  try {
    const { user, profile } = req;

    let query = supabase
      .from('visites')
      .select(`
        *,
        patient:patients(*),
        aidant:aidants(*, user:profiles(*)),
        coordinator:profiles!coordinator_id(*),
        photos:visite_photos(*)
      `);

    if (profile.role === 'family') {
      const { data: links } = await supabase
        .from('patient_family_links')
        .select('patient_id')
        .eq('family_id', user.id);

      const patientIds = links?.map(l => l.patient_id) || [];
      if (patientIds.length > 0) {
        query = query.in('patient_id', patientIds);
      } else {
        return res.json([]);
      }
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

    const { data, error } = await query.order('scheduled_date', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Get visits error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// DÉTAILS D'UNE VISITE
// =============================================
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { user, profile } = req;

    const { data, error } = await supabase
      .from('visites')
      .select(`
        *,
        patient:patients(*),
        aidant:aidants(*, user:profiles(*)),
        coordinator:profiles!coordinator_id(*),
        photos:visite_photos(*)
      `)
      .eq('id', id)
      .single();

    if (error) throw error;

    // Vérifier les permissions
    if (profile.role === 'family') {
      const { data: links } = await supabase
        .from('patient_family_links')
        .select('patient_id')
        .eq('family_id', user.id)
        .eq('patient_id', data.patient_id);

      if (!links || links.length === 0) {
        return res.status(403).json({ error: 'Accès non autorisé' });
      }
    } else if (profile.role === 'aidant') {
      const { data: aidant } = await supabase
        .from('aidants')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (data.aidant_id !== aidant?.id) {
        return res.status(403).json({ error: 'Accès non autorisé' });
      }
    }

    res.json(data);
  } catch (error) {
    console.error('Get visit detail error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// CRÉER UNE VISITE
// =============================================
router.post('/', roleMiddleware(['coordinator', 'admin', 'aidant']), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('visites')
      .insert({
        ...req.body,
        coordinator_id: req.user.id,
        status: 'planifiee',
        actions: [],
        metadata: {
          created_by: req.user.id,
          created_at: new Date().toISOString(),
        }
      })
      .select(`
        *,
        patient:patients(*),
        aidant:aidants(*, user:profiles(*))
      `)
      .single();

    if (error) throw error;

    if (data.patient) {
      const { data: links } = await supabase
        .from('patient_family_links')
        .select('family_id')
        .eq('patient_id', data.patient_id);

      if (links) {
        for (const link of links) {
          await createNotification({
            userId: link.family_id,
            title: 'Nouvelle visite planifiée',
            body: `Visite prévue pour ${data.patient.first_name} ${data.patient.last_name} le ${data.scheduled_date} à ${data.scheduled_time}`,
            type: 'visite',
            data: { visit_id: data.id },
          });
        }
      }
    }

    res.status(201).json({ success: true, visit: data });
  } catch (error) {
    console.error('Create visit error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// MODIFIER UNE VISITE
// =============================================
router.put('/:id', roleMiddleware(['coordinator', 'admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('visites')
      .update({
        ...req.body,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, visit: data });
  } catch (error) {
    console.error('Update visit error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// DÉMARRER UNE VISITE
// =============================================
router.post('/:id/start', async (req, res) => {
  try {
    const { id } = req.params;
    const now = new Date().toISOString();
    const { lat, lng } = req.body;

    const updateData = {
      status: 'en_cours',
      start_time: now,
    };

    if (lat && lng) {
      updateData.location_start = { lat, lng };
    }

    const { data, error } = await supabase
      .from('visites')
      .update(updateData)
      .eq('id', id)
      .select(`
        *,
        patient:patients(*),
        aidant:aidants(*, user:profiles(*))
      `)
      .single();

    if (error) throw error;

    if (data.patient) {
      const { data: links } = await supabase
        .from('patient_family_links')
        .select('family_id')
        .eq('patient_id', data.patient_id);

      if (links) {
        for (const link of links) {
          await createNotification({
            userId: link.family_id,
            title: 'Visite en cours',
            body: `${data.aidant?.user?.full_name || 'L\'aidant'} a commencé la visite`,
            type: 'visite',
            data: { visit_id: data.id },
          });
        }
      }
    }

    res.json({ success: true, visit: data });
  } catch (error) {
    console.error('Start visit error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// TERMINER UNE VISITE (AVEC FORMULAIRE COMPLET)
// =============================================
router.post('/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      actions, 
      notes, 
      photos, 
      audio_url,
      signature_url,
      duration_minutes,
      lat,
      lng
    } = req.body;
    const now = new Date().toISOString();

    // Vérifier que l'aidant est bien assigné
    const { data: visit, error: visitError } = await supabase
      .from('visites')
      .select('aidant_id, patient_id, start_time, metadata')
      .eq('id', id)
      .single();

    if (visitError) throw visitError;

    // Calculer la durée si start_time existe
    let calculatedDuration = duration_minutes;
    if (!calculatedDuration && visit.start_time) {
      const start = new Date(visit.start_time);
      const end = new Date(now);
      calculatedDuration = Math.round((end.getTime() - start.getTime()) / (1000 * 60));
    }

    const updateData = {
      status: 'terminee',
      end_time: now,
      actions: actions || [],
      notes: notes || '',
      report: notes || '',
      metadata: {
        ...(visit.metadata || {}),
        completed_by: req.user.id,
        completed_at: now,
        audio_url: audio_url || null,
        signature_url: signature_url || null,
        duration_minutes: calculatedDuration,
        end_location: lat && lng ? { lat, lng } : null,
      }
    };

    const { data, error } = await supabase
      .from('visites')
      .update(updateData)
      .eq('id', id)
      .select(`
        *,
        patient:patients(*),
        aidant:aidants(*, user:profiles(*))
      `)
      .single();

    if (error) throw error;

    // Sauvegarder les photos dans la table visite_photos
    if (photos && photos.length > 0) {
      for (const photoUrl of photos) {
        await supabase.from('visite_photos').insert({
          visite_id: id,
          photo_url: photoUrl,
          photo_type: 'proof',
          uploaded_by: req.user.id,
        });
      }
    }

    // Sauvegarder l'audio si présent
    if (audio_url) {
      await supabase.from('visite_audios').insert({
        visite_id: id,
        audio_url: audio_url,
        uploaded_by: req.user.id,
      });
    }

    // Notification à la famille
    if (data.patient) {
      const { data: links } = await supabase
        .from('patient_family_links')
        .select('family_id')
        .eq('patient_id', data.patient_id);

      if (links) {
        for (const link of links) {
          await createNotification({
            userId: link.family_id,
            title: '📋 Visite terminée - En attente de validation',
            body: `La visite de ${data.patient.first_name} ${data.patient.last_name} est terminée. L'aidant a soumis son rapport.`,
            type: 'visite',
            data: { visit_id: data.id, status: 'terminee' },
          });
        }
      }
    }

    // Notification aux coordinateurs et admins
    const { data: coordinators } = await supabase
      .from('profiles')
      .select('id')
      .in('role', ['coordinator', 'admin']);

    if (coordinators) {
      for (const coordinator of coordinators) {
        await createNotification({
          userId: coordinator.id,
          title: '📋 Nouveau rapport de visite',
          body: `${data.aidant?.user?.full_name || 'Un aidant'} a terminé la visite de ${data.patient?.first_name} ${data.patient?.last_name}. À valider.`,
          type: 'system',
          data: { visit_id: data.id, action: 'validate' },
        });
      }
    }

    res.json({ success: true, visit: data });
  } catch (error) {
    console.error('Complete visit error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// VALIDER UNE VISITE (AVEC DÉCOMPTE DES VISITES)
// =============================================
router.post('/:id/validate', roleMiddleware(['coordinator', 'admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { comment } = req.body;
    const now = new Date().toISOString();

    // Récupérer la visite pour avoir les infos
    const { data: visit, error: visitError } = await supabase
      .from('visites')
      .select('patient_id, aidant_id, metadata')
      .eq('id', id)
      .single();

    if (visitError) throw visitError;

    // Mettre à jour la visite
    const { data, error } = await supabase
      .from('visites')
      .update({
        status: 'validee',
        metadata: {
          ...(visit.metadata || {}),
          validated_by: req.user.id,
          validated_at: now,
          validation_comment: comment || null,
        }
      })
      .eq('id', id)
      .select(`
        *,
        patient:patients(*),
        aidant:aidants(*, user:profiles(*))
      `)
      .single();

    if (error) throw error;

    // ✅ DÉCOMPTER UNE VISITE DE L'ABONNEMENT
    if (data.patient_id) {
      // Récupérer l'abonnement actif du patient
      const { data: subscription, error: subError } = await supabase
        .from('abonnements')
        .select('id, remaining_visits, used_visits, total_visits, user_id')
        .eq('patient_id', data.patient_id)
        .eq('status', 'actif')
        .maybeSingle();

      if (subscription && !subError) {
        if (subscription.remaining_visits > 0) {
          // Décrémenter les visites restantes
          const { error: updateError } = await supabase
            .from('abonnements')
            .update({
              used_visits: subscription.used_visits + 1,
              remaining_visits: subscription.remaining_visits - 1,
              updated_at: new Date().toISOString(),
            })
            .eq('id', subscription.id);

          if (updateError) {
            console.error('❌ Erreur décompte visites:', updateError);
          } else {
            // Notification si plus de visites
            if (subscription.remaining_visits - 1 === 0) {
              await createNotification({
                userId: subscription.user_id,
                title: '⚠️ Plus de visites disponibles',
                body: 'Votre abonnement a atteint le nombre maximum de visites. Pensez à renouveler.',
                type: 'system',
                data: { subscription_id: subscription.id },
              });
            }

            // Notification de mise à jour du solde
            await createNotification({
              userId: subscription.user_id,
              title: '📊 Visite décomptée',
              body: `Il vous reste ${subscription.remaining_visits - 1} visite(s) sur votre abonnement.`,
              type: 'system',
              data: { subscription_id: subscription.id, remaining: subscription.remaining_visits - 1 },
            });
          }
        } else {
          // Notification : plus de visites disponibles
          await createNotification({
            userId: subscription.user_id,
            title: '⚠️ Abonnement épuisé',
            body: 'Vous avez utilisé toutes les visites de votre abonnement. Veuillez le renouveler.',
            type: 'system',
            data: { subscription_id: subscription.id },
          });
        }
      }
    }

    // Notification à la famille
    if (data.patient) {
      const { data: links } = await supabase
        .from('patient_family_links')
        .select('family_id')
        .eq('patient_id', data.patient_id);

      if (links) {
        for (const link of links) {
          await createNotification({
            userId: link.family_id,
            title: '✅ Visite validée',
            body: `La visite de ${data.patient.first_name} ${data.patient.last_name} a été validée.`,
            type: 'visite',
            data: { visit_id: data.id, status: 'validee' },
          });
        }
      }
    }

    // Notification à l'aidant
    if (data.aidant?.user_id) {
      await createNotification({
        userId: data.aidant.user_id,
        title: '✅ Visite validée',
        body: `La visite de ${data.patient?.first_name} ${data.patient?.last_name} a été validée par l'admin.`,
        type: 'visite',
        data: { visit_id: data.id, status: 'validee' },
      });
    }

    res.json({ success: true, visit: data });
  } catch (error) {
    console.error('Validate visit error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// REFUSER UNE VISITE
// =============================================
router.post('/:id/reject', roleMiddleware(['coordinator', 'admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const now = new Date().toISOString();

    // Récupérer la visite pour avoir les infos
    const { data: visit, error: visitError } = await supabase
      .from('visites')
      .select('patient_id, aidant_id, metadata')
      .eq('id', id)
      .single();

    if (visitError) throw visitError;

    // Mettre à jour la visite
    const { data, error } = await supabase
      .from('visites')
      .update({
        status: 'replanifiee',
        metadata: {
          ...(visit.metadata || {}),
          rejected_by: req.user.id,
          rejected_at: now,
          rejection_reason: reason || 'Non conforme',
        }
      })
      .eq('id', id)
      .select(`
        *,
        patient:patients(*),
        aidant:aidants(*, user:profiles(*))
      `)
      .single();

    if (error) throw error;

    // Notification à l'aidant
    if (data.aidant?.user_id) {
      await createNotification({
        userId: data.aidant.user_id,
        title: '❌ Visite non validée',
        body: `La visite de ${data.patient?.first_name} ${data.patient?.last_name} nécessite des modifications. Raison: ${reason || 'Non conforme'}`,
        type: 'visite',
        data: { visit_id: data.id, status: 'replanifiee' },
      });
    }

    res.json({ success: true, visit: data });
  } catch (error) {
    console.error('Reject visit error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// ANNULER UNE VISITE
// =============================================
router.post('/:id/cancel', roleMiddleware(['coordinator', 'admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const now = new Date().toISOString();

    // Récupérer la visite pour avoir les infos
    const { data: visit, error: visitError } = await supabase
      .from('visites')
      .select('patient_id, aidant_id, metadata')
      .eq('id', id)
      .single();

    if (visitError) throw visitError;

    // Mettre à jour la visite
    const { data, error } = await supabase
      .from('visites')
      .update({
        status: 'annulee',
        metadata: {
          ...(visit.metadata || {}),
          cancelled_by: req.user.id,
          cancelled_at: now,
          cancellation_reason: reason || null,
        }
      })
      .eq('id', id)
      .select(`
        *,
        patient:patients(*),
        aidant:aidants(*, user:profiles(*))
      `)
      .single();

    if (error) throw error;

    // Notification à la famille
    if (data.patient) {
      const { data: links } = await supabase
        .from('patient_family_links')
        .select('family_id')
        .eq('patient_id', data.patient_id);

      if (links) {
        for (const link of links) {
          await createNotification({
            userId: link.family_id,
            title: 'Visite annulée',
            body: `La visite de ${data.patient.first_name} ${data.patient.last_name} du ${data.scheduled_date} a été annulée.`,
            type: 'visite',
            data: { visit_id: data.id, status: 'annulee' },
          });
        }
      }
    }

    // Notification à l'aidant
    if (data.aidant?.user_id) {
      await createNotification({
        userId: data.aidant.user_id,
        title: 'Visite annulée',
        body: `La visite de ${data.patient?.first_name} ${data.patient?.last_name} du ${data.scheduled_date} a été annulée.`,
        type: 'visite',
        data: { visit_id: data.id, status: 'annulee' },
      });
    }

    res.json({ success: true, visit: data });
  } catch (error) {
    console.error('Cancel visit error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// AJOUTER UNE PHOTO
// =============================================
router.post('/:id/photos', async (req, res) => {
  try {
    const { id } = req.params;
    const { photo_url, caption, photo_type } = req.body;

    const { data, error } = await supabase
      .from('visite_photos')
      .insert({
        visite_id: id,
        photo_url,
        caption: caption || null,
        photo_type: photo_type || 'other',
        uploaded_by: req.user.id,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, photo: data });
  } catch (error) {
    console.error('Add photo error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// SUPPRIMER UNE PHOTO
// =============================================
router.delete('/photos/:photoId', async (req, res) => {
  try {
    const { photoId } = req.params;

    // Vérifier que l'utilisateur a le droit de supprimer
    const { data: photo, error: fetchError } = await supabase
      .from('visite_photos')
      .select('uploaded_by, visite_id')
      .eq('id', photoId)
      .single();

    if (fetchError) throw fetchError;

    if (photo.uploaded_by !== req.user.id) {
      // Vérifier si l'utilisateur est admin ou coordinateur
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', req.user.id)
        .single();

      if (!['admin', 'coordinator'].includes(profile?.role)) {
        return res.status(403).json({ error: 'Non autorisé' });
      }
    }

    const { error } = await supabase
      .from('visite_photos')
      .delete()
      .eq('id', photoId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Delete photo error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// RÉCUPÉRER LES PHOTOS D'UNE VISITE
// =============================================
router.get('/:id/photos', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('visite_photos')
      .select('*')
      .eq('visite_id', id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Get photos error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// RÉCUPÉRER LES AUDIOS D'UNE VISITE
// =============================================
router.get('/:id/audios', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('visite_audios')
      .select('*')
      .eq('visite_id', id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Get audios error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
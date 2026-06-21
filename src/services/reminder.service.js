// 📁 backend/src/services/reminder.service.js

const { supabase } = require('./supabase.service');
const { createNotification } = require('./notification.service');
const { sendEmail, templates } = require('./email.service');

// =============================================
// ENVOYER UN RAPPEL POUR UNE VISITE
// =============================================
const sendVisitReminder = async (visitId) => {
  try {
    // ✅ Récupérer la visite avec les infos
    const { data: visit, error } = await supabase
      .from('visites')
      .select(`
        *,
        patient:patients(*),
        aidant:aidants(*, user:profiles(*)),
        coordinator:profiles!coordinator_id(*)
      `)
      .eq('id', visitId)
      .single();

    if (error) throw error;
    if (!visit) return;

    const patientName = visit.patient?.first_name || 'Patient';
    const patientAddress = visit.patient?.address || 'Adresse non précisée';
    const scheduledDate = new Date(visit.scheduled_date).toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    const scheduledTime = visit.scheduled_time;

    // ✅ 1. Notification à l'aidant
    if (visit.aidant?.user_id) {
      await createNotification({
        userId: visit.aidant.user_id,
        title: '📅 Rappel de visite',
        body: `Visite prévue pour ${patientName} le ${scheduledDate} à ${scheduledTime}`,
        type: 'reminder',
        data: { visit_id: visit.id, patient_name: patientName, date: scheduledDate, time: scheduledTime },
      });

      // ✅ Email à l'aidant
      try {
        await sendEmail({
          to: visit.aidant.user?.email,
          ...templates.visitReminder({
            patient_name: patientName,
            date: scheduledDate,
            time: scheduledTime,
            address: patientAddress,
            aidant_name: visit.aidant.user?.full_name,
          })
        });
      } catch (emailError) {
        console.error('Email reminder error:', emailError);
      }
    }

    // ✅ 2. Notification à la famille
    if (visit.patient) {
      const { data: links } = await supabase
        .from('patient_family_links')
        .select('family_id')
        .eq('patient_id', visit.patient_id);

      if (links) {
        for (const link of links) {
          await createNotification({
            userId: link.family_id,
            title: '📅 Rappel de visite',
            body: `Une visite est prévue pour ${patientName} le ${scheduledDate} à ${scheduledTime}`,
            type: 'reminder',
            data: { visit_id: visit.id, patient_name: patientName },
          });
        }
      }
    }

    // ✅ 3. Mettre à jour le statut du rappel
    await supabase
      .from('visites')
      .update({
        metadata: {
          ...visit.metadata,
          reminder_sent: {
            sent_at: new Date().toISOString(),
            sent_to: {
              aidant: visit.aidant?.user_id || null,
              families: links?.map(l => l.family_id) || [],
            }
          }
        }
      })
      .eq('id', visitId);

    console.log(`✅ Rappel envoyé pour la visite ${visitId}`);
    return { success: true, visitId };
  } catch (error) {
    console.error('Send visit reminder error:', error);
    return { success: false, error: error.message };
  }
};

// =============================================
// ENVOYER TOUS LES RAPPELS DU JOUR
// =============================================
const sendDailyReminders = async () => {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    // ✅ Récupérer les visites de demain
    const { data: visits, error } = await supabase
      .from('visites')
      .select('id')
      .eq('scheduled_date', tomorrowStr)
      .eq('status', 'planifiee');

    if (error) throw error;

    let successCount = 0;
    for (const visit of visits) {
      const result = await sendVisitReminder(visit.id);
      if (result.success) successCount++;
    }

    console.log(`✅ ${successCount}/${visits.length} rappels envoyés pour demain`);
    return { success: true, sent: successCount, total: visits.length };
  } catch (error) {
    console.error('Send daily reminders error:', error);
    return { success: false, error: error.message };
  }
};

// =============================================
// ENVOYER UN RAPPEL 1H AVANT LA VISITE
// =============================================
const sendHourReminder = async () => {
  try {
    const now = new Date();
    const inOneHour = new Date(now);
    inOneHour.setHours(inOneHour.getHours() + 1);
    
    const currentTime = now.toTimeString().slice(0, 5);
    const currentDate = now.toISOString().split('T')[0];

    // ✅ Récupérer les visites dans l'heure
    const { data: visits, error } = await supabase
      .from('visites')
      .select(`
        *,
        patient:patients(*),
        aidant:aidants(*, user:profiles(*))
      `)
      .eq('scheduled_date', currentDate)
      .eq('status', 'planifiee')
      .gte('scheduled_time', currentTime)
      .lt('scheduled_time', inOneHour.toTimeString().slice(0, 5));

    if (error) throw error;

    for (const visit of visits) {
      // ✅ Envoyer une notification push si l'aidant est assigné
      if (visit.aidant?.user_id) {
        await createNotification({
          userId: visit.aidant.user_id,
          title: '⏰ Visite dans 1 heure',
          body: `La visite pour ${visit.patient?.first_name} ${visit.patient?.last_name} est dans 1 heure.`,
          type: 'reminder',
          data: { visit_id: visit.id, urgency: 'high' },
        });
      }
    }

    return { success: true, sent: visits.length };
  } catch (error) {
    console.error('Send hour reminder error:', error);
    return { success: false, error: error.message };
  }
};

// =============================================
// NOTIFICATION POUR EXPIRATION D'ABONNEMENT
// =============================================
const checkSubscriptionExpiry = async () => {
  try {
    const today = new Date();
    const inThreeDays = new Date(today);
    inThreeDays.setDate(inThreeDays.getDate() + 3);
    const inThreeDaysStr = inThreeDays.toISOString().split('T')[0];

    // ✅ Récupérer les abonnements qui expirent dans 3 jours
    const { data: subscriptions, error } = await supabase
      .from('abonnements')
      .select(`
        *,
        offre:offres(*),
        user:profiles(*)
      `)
      .eq('status', 'actif')
      .eq('end_date', inThreeDaysStr);

    if (error) throw error;

    for (const sub of subscriptions) {
      await createNotification({
        userId: sub.user_id,
        title: '⚠️ Votre abonnement expire bientôt',
        body: `Votre abonnement ${sub.offre?.name} expire dans 3 jours. Pensez à le renouveler.`,
        type: 'reminder',
        data: { subscription_id: sub.id, expiry_date: sub.end_date },
      });

      // ✅ Email d'expiration
      try {
        await sendEmail({
          to: sub.user?.email,
          ...templates.subscriptionExpired({
            plan_name: sub.offre?.name,
            expiry_date: new Date(sub.end_date).toLocaleDateString('fr-FR'),
          })
        });
      } catch (emailError) {
        console.error('Email expiry error:', emailError);
      }
    }

    return { success: true, sent: subscriptions.length };
  } catch (error) {
    console.error('Check subscription expiry error:', error);
    return { success: false, error: error.message };
  }
};

// =============================================
// NOTIFICATION POUR ABONNEMENT EXPIRE
// =============================================
const checkExpiredSubscriptions = async () => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // ✅ Récupérer les abonnements expirés
    const { data: subscriptions, error } = await supabase
      .from('abonnements')
      .select(`
        *,
        offre:offres(*),
        user:profiles(*)
      `)
      .eq('status', 'actif')
      .lt('end_date', today);

    if (error) throw error;

    for (const sub of subscriptions) {
      // ✅ Mettre à jour le statut
      await supabase
        .from('abonnements')
        .update({ status: 'expire' })
        .eq('id', sub.id);

      await createNotification({
        userId: sub.user_id,
        title: '❌ Votre abonnement a expiré',
        body: `Votre abonnement ${sub.offre?.name} a expiré. Pour continuer à bénéficier de nos services, veuillez le renouveler.`,
        type: 'reminder',
        data: { subscription_id: sub.id },
      });
    }

    return { success: true, expired: subscriptions.length };
  } catch (error) {
    console.error('Check expired subscriptions error:', error);
    return { success: false, error: error.message };
  }
};

// =============================================
// NOTIFICATION POUR VISITE NON DEMARRÉE
// =============================================
const checkMissedVisits = async () => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    const oneHourAgo = new Date(now);
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);
    const oneHourAgoStr = oneHourAgo.toTimeString().slice(0, 5);

    // ✅ Récupérer les visites qui auraient dû commencer
    const { data: visits, error } = await supabase
      .from('visites')
      .select(`
        *,
        patient:patients(*),
        aidant:aidants(*, user:profiles(*))
      `)
      .eq('scheduled_date', today)
      .eq('status', 'planifiee')
      .lt('scheduled_time', oneHourAgoStr);

    if (error) throw error;

    for (const visit of visits) {
      // ✅ Notification à l'aidant
      if (visit.aidant?.user_id) {
        await createNotification({
          userId: visit.aidant.user_id,
          title: '⏰ Visite non démarrée',
          body: `La visite pour ${visit.patient?.first_name} ${visit.patient?.last_name} était prévue à ${visit.scheduled_time}. N'oubliez pas de la démarrer !`,
          type: 'reminder',
          data: { visit_id: visit.id, urgency: 'high' },
        });
      }

      // ✅ Notification à la famille
      if (visit.patient) {
        const { data: links } = await supabase
          .from('patient_family_links')
          .select('family_id')
          .eq('patient_id', visit.patient_id);

        if (links) {
          for (const link of links) {
            await createNotification({
              userId: link.family_id,
              title: '⏰ Retard de visite',
              body: `La visite de ${visit.patient?.first_name} ${visit.patient?.last_name} n'a pas encore commencé alors qu'elle était prévue à ${visit.scheduled_time}.`,
              type: 'reminder',
              data: { visit_id: visit.id },
            });
          }
        }
      }
    }

    return { success: true, notified: visits.length };
  } catch (error) {
    console.error('Check missed visits error:', error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendVisitReminder,
  sendDailyReminders,
  sendHourReminder,
  checkSubscriptionExpiry,
  checkExpiredSubscriptions,
  checkMissedVisits,
};
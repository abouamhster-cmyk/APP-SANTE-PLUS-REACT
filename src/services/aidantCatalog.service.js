// 📁 backend/src/services/aidantCatalog.service.js

const { supabase } = require('./supabase.service');

// ============================================================
// RÉCUPÉRER LES AIDANTS DISPONIBLES AVEC FILTRES
// ============================================================
const getAvailableAidants = async (filters = {}) => {
  try {
    let query = supabase
      .from('aidants')
      .select(`
        *,
        user:profiles!user_id(
          id,
          full_name,
          email,
          phone,
          avatar_url
        ),
        assignments:aidant_assignments(
          id,
          status,
          assigned_at,
          patient:patients(
            id,
            first_name,
            last_name
          )
        ),
        reviews:aidant_reviews(
          rating,
          comment
        )
      `)
      .eq('is_verified', true)
      .eq('status', 'approved');

    // ✅ Filtrer par zone
    if (filters.zone) {
      query = query.contains('zones', [filters.zone]);
    }

    // ✅ Filtrer par spécialité
    if (filters.specialty) {
      query = query.contains('specialties', [filters.specialty]);
    }

    // ✅ Filtrer par note minimum
    if (filters.minRating) {
      query = query.gte('rating', filters.minRating);
    }

    // ✅ Filtrer par disponibilité
    if (filters.onlyAvailable !== false) {
      query = query.eq('available', true);
    }

    // ✅ Filtrer par expérience
    if (filters.minExperience) {
      query = query.gte('experience_years', filters.minExperience);
    }

    // ✅ Trier
    const sortField = filters.sortBy || 'rating';
    const sortOrder = filters.sortOrder || 'desc';
    query = query.order(sortField, { ascending: sortOrder === 'asc' });

    // ✅ Pagination
    const limit = filters.limit || 20;
    const offset = filters.offset || 0;
    query = query.range(offset, offset + limit - 1);

    const { data, error } = await query;

    if (error) throw error;

    // ✅ Calculer les assignations actives
    const aidantsWithStats = (data || []).map((aidant) => {
      const activeAssignments = (aidant.assignments || []).filter(
        (a) => a.status === 'active'
      ).length;

      const totalReviews = (aidant.reviews || []).length;
      const avgRating = totalReviews > 0
        ? (aidant.reviews || []).reduce((sum, r) => sum + r.rating, 0) / totalReviews
        : aidant.rating || 0;

      const isAvailable = aidant.available && activeAssignments < (aidant.max_assignments || 4);

      return {
        ...aidant,
        active_assignments: activeAssignments,
        max_assignments: aidant.max_assignments || 4,
        avg_rating: Math.round(avgRating * 10) / 10,
        total_reviews: totalReviews,
        is_available: isAvailable,
        availability_status: isAvailable ? 'available' : 
          (activeAssignments >= (aidant.max_assignments || 4) ? 'full' : 'unavailable'),
      };
    });

    return aidantsWithStats;
  } catch (error) {
    console.error('❌ Get available aidants error:', error);
    throw error;
  }
};

// ============================================================
// RÉCUPÉRER UN AIDANT PAR ID AVEC DÉTAILS
// ============================================================
const getAidantById = async (aidantId) => {
  try {
    const { data, error } = await supabase
      .from('aidants')
      .select(`
        *,
        user:profiles!user_id(
          id,
          full_name,
          email,
          phone,
          avatar_url
        ),
        assignments:aidant_assignments(
          id,
          status,
          assigned_at,
          patient:patients(
            id,
            first_name,
            last_name,
            address
          )
        ),
        reviews:aidant_reviews(
          id,
          rating,
          comment,
          categories,
          created_at,
          family:profiles!family_id(
            full_name
          )
        )
      `)
      .eq('id', aidantId)
      .single();

    if (error) throw error;

    // ✅ Statistiques
    const activeAssignments = (data.assignments || []).filter(
      (a) => a.status === 'active'
    ).length;

    const totalReviews = (data.reviews || []).length;
    const avgRating = totalReviews > 0
      ? (data.reviews || []).reduce((sum, r) => sum + r.rating, 0) / totalReviews
      : data.rating || 0;

    return {
      ...data,
      active_assignments: activeAssignments,
      max_assignments: data.max_assignments || 4,
      avg_rating: Math.round(avgRating * 10) / 10,
      total_reviews: totalReviews,
      is_available: data.available && activeAssignments < (data.max_assignments || 4),
    };
  } catch (error) {
    console.error('❌ Get aidant by ID error:', error);
    throw error;
  }
};

// ============================================================
// ASSIGNER UN AIDANT À UN PATIENT
// ============================================================
const assignAidantToPatient = async (aidantId, familyId, patientId, assignmentType = 'permanente') => {
  try {
    // ✅ Vérifier que l'aidant existe et est disponible
    const { data: aidant, error: aidantError } = await supabase
      .from('aidants')
      .select('id, available, max_assignments')
      .eq('id', aidantId)
      .single();

    if (aidantError || !aidant) {
      throw new Error('Aidant non trouvé');
    }

    // ✅ Compter les assignations actives
    const { count, error: countError } = await supabase
      .from('aidant_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('aidant_id', aidantId)
      .eq('status', 'active');

    if (countError) throw countError;

    const maxAssignments = aidant.max_assignments || 4;
    if (count >= maxAssignments) {
      throw new Error(`Cet aidant a déjà ${count} assignations actives (maximum ${maxAssignments})`);
    }

    // ✅ Vérifier que le patient existe
    const { data: patient, error: patientError } = await supabase
      .from('patients')
      .select('id')
      .eq('id', patientId)
      .single();

    if (patientError || !patient) {
      throw new Error('Patient non trouvé');
    }

    // ✅ Vérifier que la famille existe
    const { data: family, error: familyError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', familyId)
      .single();

    if (familyError || !family) {
      throw new Error('Famille non trouvée');
    }

    // ✅ Créer l'assignation
    const { data: assignment, error: assignmentError } = await supabase
      .from('aidant_assignments')
      .insert({
        aidant_id: aidantId,
        family_id: familyId,
        patient_id: patientId,
        status: 'active',
        assignment_type: assignmentType,
        assigned_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (assignmentError) throw assignmentError;

    // ✅ Mettre à jour current_assignments sur aidants
    await supabase
      .from('aidants')
      .update({ 
        current_assignments: count + 1,
        updated_at: new Date().toISOString()
      })
      .eq('id', aidantId);

    // ✅ Si l'aidant a atteint le max, le rendre indisponible
    if (count + 1 >= maxAssignments) {
      await supabase
        .from('aidants')
        .update({ available: false })
        .eq('id', aidantId);
    }

    // ✅ Notification à l'aidant
    await supabase.from('notifications').insert({
      user_id: aidant.user_id,
      title: '📋 Nouveau patient assigné',
      body: `Vous avez été assigné à un nouveau patient. Consultez les détails dans votre espace.`,
      type: 'system',
      data: { 
        assignment_id: assignment.id,
        patient_id: patientId,
        family_id: familyId,
        action: 'view_assignment'
      },
    });

    // ✅ Notification à la famille
    await supabase.from('notifications').insert({
      user_id: familyId,
      title: '✅ Aidant assigné avec succès',
      body: `L'aidant a été assigné à votre patient. Vous serez notifié des prochaines visites.`,
      type: 'system',
      data: { 
        assignment_id: assignment.id,
        aidant_id: aidantId,
        patient_id: patientId,
      },
    });

    return assignment;
  } catch (error) {
    console.error('❌ Assign aidant error:', error);
    throw error;
  }
};

// ============================================================
// RÉCUPÉRER LES ASSIGNATIONS D'UNE FAMILLE
// ============================================================
const getFamilyAssignments = async (familyId) => {
  try {
    const { data, error } = await supabase
      .from('aidant_assignments')
      .select(`
        *,
        aidant:aidants(
          *,
          user:profiles!user_id(
            full_name,
            email,
            phone,
            avatar_url
          )
        ),
        patient:patients(*)
      `)
      .eq('family_id', familyId)
      .order('assigned_at', { ascending: false });

    if (error) throw error;

    return data || [];
  } catch (error) {
    console.error('❌ Get family assignments error:', error);
    throw error;
  }
};

// ============================================================
// RÉCUPÉRER LES ASSIGNATIONS D'UN AIDANT
// ============================================================
const getAidantAssignments = async (aidantId) => {
  try {
    const { data, error } = await supabase
      .from('aidant_assignments')
      .select(`
        *,
        family:profiles!family_id(
          full_name,
          email,
          phone
        ),
        patient:patients(*)
      `)
      .eq('aidant_id', aidantId)
      .order('assigned_at', { ascending: false });

    if (error) throw error;

    return data || [];
  } catch (error) {
    console.error('❌ Get aidant assignments error:', error);
    throw error;
  }
};

// ============================================================
// RÉVOQUER UNE ASSIGNATION
// ============================================================
const revokeAssignment = async (assignmentId, familyId) => {
  try {
    // ✅ Vérifier que l'assignation appartient à la famille
    const { data: assignment, error: checkError } = await supabase
      .from('aidant_assignments')
      .select('aidant_id')
      .eq('id', assignmentId)
      .eq('family_id', familyId)
      .single();

    if (checkError || !assignment) {
      throw new Error('Assignation non trouvée ou non autorisée');
    }

    // ✅ Mettre à jour le statut
    const { data, error } = await supabase
      .from('aidant_assignments')
      .update({ 
        status: 'cancelled',
        updated_at: new Date().toISOString()
      })
      .eq('id', assignmentId)
      .select()
      .single();

    if (error) throw error;

    // ✅ Décrémenter current_assignments
    await supabase.rpc('decrement_aidant_assignments', { 
      aidant_id: assignment.aidant_id 
    });

    // ✅ Rendre l'aidant disponible si pas à max
    const { count } = await supabase
      .from('aidant_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('aidant_id', assignment.aidant_id)
      .eq('status', 'active');

    const maxAssignments = 4;
    if (count < maxAssignments) {
      await supabase
        .from('aidants')
        .update({ available: true })
        .eq('id', assignment.aidant_id);
    }

    // ✅ Notification
    await supabase.from('notifications').insert({
      user_id: familyId,
      title: '🔄 Assignation révoquée',
      body: `L'assignation de l'aidant a été révoquée.`,
      type: 'system',
      data: { assignment_id: assignmentId },
    });

    return data;
  } catch (error) {
    console.error('❌ Revoke assignment error:', error);
    throw error;
  }
};

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  getAvailableAidants,
  getAidantById,
  assignAidantToPatient,
  getFamilyAssignments,
  getAidantAssignments,
  revokeAssignment,
};

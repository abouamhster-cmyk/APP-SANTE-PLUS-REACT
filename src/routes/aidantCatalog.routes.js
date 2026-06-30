// 📁 backend/src/routes/aidantCatalog.routes.js

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const roleMiddleware = require('../middleware/role.middleware');
const {
  getAvailableAidants,
  getAidantById,
  assignAidantToPatient,
  getFamilyAssignments,
  revokeAssignment,
} = require('../services/aidantCatalog.service');
const { asyncWrapper } = require('../utils/errorHandler');

// Toutes les routes nécessitent une authentification
router.use(authMiddleware);

// ============================================================
// GET /api/aidants/catalog
// Récupère la liste des aidants disponibles avec filtres
// ============================================================
router.get('/catalog', asyncWrapper(async (req, res) => {
  const {
    zone,
    specialty,
    minRating,
    onlyAvailable = 'true',
    minExperience,
    sortBy = 'rating',
    sortOrder = 'desc',
    limit = 20,
    offset = 0,
  } = req.query;

  const aidants = await getAvailableAidants({
    zone,
    specialty,
    minRating: minRating ? parseFloat(minRating) : undefined,
    onlyAvailable: onlyAvailable === 'true',
    minExperience: minExperience ? parseInt(minExperience) : undefined,
    sortBy,
    sortOrder,
    limit: parseInt(limit),
    offset: parseInt(offset),
  });

  res.json({
    success: true,
    data: aidants,
    count: aidants.length,
    filters: { zone, specialty, minRating, onlyAvailable, sortBy, sortOrder },
  });
}));

// ============================================================
// GET /api/aidants/:id
// Récupère les détails d'un aidant
// ============================================================
router.get('/:id', asyncWrapper(async (req, res) => {
  const { id } = req.params;
  const aidant = await getAidantById(id);

  if (!aidant) {
    return res.status(404).json({
      success: false,
      error: 'Aidant non trouvé',
    });
  }

  res.json({
    success: true,
    data: aidant,
  });
}));

// ============================================================
// POST /api/aidants/assign
// Assigner un aidant à un patient (famille uniquement)
// ============================================================
router.post('/assign', roleMiddleware(['family']), asyncWrapper(async (req, res) => {
  const { aidantId, patientId, assignmentType = 'permanente' } = req.body;
  const familyId = req.user.id;

  if (!aidantId || !patientId) {
    return res.status(400).json({
      success: false,
      error: 'aidantId et patientId sont requis',
    });
  }

  const assignment = await assignAidantToPatient(
    aidantId,
    familyId,
    patientId,
    assignmentType
  );

  res.status(201).json({
    success: true,
    message: 'Aidant assigné avec succès',
    data: assignment,
  });
}));

// ============================================================
// GET /api/aidants/my-assignments
// Récupère les assignations de la famille connectée
// ============================================================
router.get('/my-assignments', roleMiddleware(['family']), asyncWrapper(async (req, res) => {
  const familyId = req.user.id;
  const assignments = await getFamilyAssignments(familyId);

  res.json({
    success: true,
    data: assignments,
  });
}));

// ============================================================
// DELETE /api/aidants/assignments/:id
// Révoquer une assignation (famille uniquement)
// ============================================================
router.delete('/assignments/:id', roleMiddleware(['family']), asyncWrapper(async (req, res) => {
  const { id } = req.params;
  const familyId = req.user.id;

  const assignment = await revokeAssignment(id, familyId);

  res.json({
    success: true,
    message: 'Assignation révoquée avec succès',
    data: assignment,
  });
}));

module.exports = router;

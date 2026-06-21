// 📁 backend/src/routes/contract.routes.js

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const {
  getActiveContract,
  hasAcceptedContract,
  acceptContract,
  getLatestAcceptance,
  getContractStatus,
} = require('../services/contract.service');

// Toutes les routes nécessitent une authentification
router.use(authMiddleware);

// =============================================
// ROUTE: GET /api/contract/status
// Récupère le statut du contrat pour l'utilisateur connecté
// =============================================
router.get('/status', async (req, res) => {
  try {
    const { role } = req.profile;
    const userId = req.user.id;

    const status = await getContractStatus(userId, role);

    res.json({
      success: true,
      ...status,
    });
  } catch (error) {
    console.error('❌ Contract status error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erreur lors de la récupération du statut',
    });
  }
});

// =============================================
// ROUTE: GET /api/contract/active
// Récupère le contrat actif pour le rôle de l'utilisateur
// =============================================
router.get('/active', async (req, res) => {
  try {
    const { role } = req.profile;
    const userId = req.user.id;

    const contract = await getActiveContract(role);

    if (!contract) {
      return res.status(404).json({
        success: false,
        error: 'Aucun contrat actif trouvé pour ce rôle',
      });
    }

    const accepted = await hasAcceptedContract(userId, contract.id);

    res.json({
      success: true,
      contract,
      accepted,
      needs_acceptance: !accepted,
    });
  } catch (error) {
    console.error('❌ Active contract error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erreur lors de la récupération du contrat',
    });
  }
});

// =============================================
// ROUTE: POST /api/contract/accept
// Accepte le contrat pour l'utilisateur connecté
// =============================================
router.post('/accept', async (req, res) => {
  try {
    const { contract_id } = req.body;
    const userId = req.user.id;
    const { role } = req.profile;

    if (!contract_id) {
      return res.status(400).json({
        success: false,
        error: 'contract_id est requis',
      });
    }

    // Vérifier que le contrat existe et correspond au rôle
    const contract = await getActiveContract(role);
    if (!contract) {
      return res.status(404).json({
        success: false,
        error: 'Aucun contrat actif trouvé',
      });
    }

    if (contract.id !== contract_id) {
      return res.status(400).json({
        success: false,
        error: 'Le contrat fourni ne correspond pas au rôle de l\'utilisateur',
      });
    }

    // Vérifier si déjà accepté
    const alreadyAccepted = await hasAcceptedContract(userId, contract_id);
    if (alreadyAccepted) {
      return res.status(400).json({
        success: false,
        error: 'Contrat déjà accepté',
      });
    }

    // Enregistrer l'acceptation
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || null;
    const userAgent = req.headers['user-agent'] || null;

    const acceptance = await acceptContract(userId, contract_id, ip, userAgent);

    res.json({
      success: true,
      message: 'Contrat accepté avec succès',
      acceptance,
    });
  } catch (error) {
    console.error('❌ Accept contract error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erreur lors de l\'acceptation du contrat',
    });
  }
});

// =============================================
// ROUTE: GET /api/contract/history
// Récupère l'historique des acceptations de l'utilisateur
// =============================================
router.get('/history', async (req, res) => {
  try {
    const userId = req.user.id;

    const { data, error } = await supabase
      .from('user_contract_acceptances')
      .select(`
        *,
        contract:contracts(*)
      `)
      .eq('user_id', userId)
      .order('accepted_at', { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      history: data || [],
    });
  } catch (error) {
    console.error('❌ Contract history error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erreur lors de la récupération de l\'historique',
    });
  }
});

module.exports = router;
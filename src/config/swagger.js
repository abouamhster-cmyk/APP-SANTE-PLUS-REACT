// 📁 backend/src/config/swagger.js

const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

// ============================================================
// CONFIGURATION SWAGGER
// ============================================================

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Santé Plus Services API',
      version: '1.0.0',
      description: `
        API de Santé Plus Services - Plateforme d'accompagnement et de coordination à domicile.

        ## Fonctionnalités principales
        - Authentification et gestion des utilisateurs
        - Gestion des patients/proches
        - Gestion des visites
        - Gestion des commandes
        - Gestion des paiements (FedaPay)
        - Gestion des abonnements
        - Notifications
        - Administration

        ## Authentification
        Utilisez le token JWT obtenu via \`/api/auth/login\` dans le header \`Authorization: Bearer <token>\`.
      `,
      version: '1.0.0',
      contact: {
        name: 'Santé Plus Services',
        email: 'contact@santeplus.bj',
        url: 'https://santeplus.bj',
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
    },
    servers: [
      {
        url: process.env.API_URL || 'http://localhost:5000/api',
        description: 'Serveur API principal',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'VALIDATION_ERROR' },
                message: { type: 'string', example: 'Données invalides' },
                status: { type: 'number', example: 400 },
                path: { type: 'string', example: '/api/auth/register' },
                method: { type: 'string', example: 'POST' },
                timestamp: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
        SuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
          },
        },
        // Ajouter plus de schémas selon vos besoins
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
    tags: [
      { name: 'Auth', description: 'Authentification et gestion des comptes' },
      { name: 'Patients', description: 'Gestion des patients/proches' },
      { name: 'Visites', description: 'Gestion des visites' },
      { name: 'Commandes', description: 'Gestion des commandes' },
      { name: 'Paiements', description: 'Gestion des paiements et abonnements' },
      { name: 'Admin', description: 'Administration de la plateforme' },
    ],
  },
  apis: [
    './src/routes/*.js',
    './src/models/*.js',
  ],
};

const swaggerSpec = swaggerJsdoc(options);

// ============================================================
// MIDDLEWARE SWAGGER
// ============================================================

const setupSwagger = (app) => {
  // ✅ Route pour la documentation
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    explorer: true,
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Santé Plus Services API Documentation',
  }));

  // ✅ Route pour le JSON de la spec
  app.get('/api/docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  console.log('📚 Documentation Swagger disponible sur /api/docs');
};

module.exports = { setupSwagger, swaggerSpec };

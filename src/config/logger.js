// 📁 backend/src/config/logger.js

const winston = require('winston');
const path = require('path');

// ============================================================
// FORMATS PERSONNALISÉS
// ============================================================

const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS',
  }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let log = `${timestamp} [${level.toUpperCase()}] ${message}`;
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }
    if (stack) {
      log += `\n${stack}`;
    }
    return log;
  })
);

const consoleFormat = winston.format.combine(
  winston.format.colorize({
    all: true,
  }),
  winston.format.timestamp({
    format: 'HH:mm:ss',
  }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let log = `${timestamp} [${level}] ${message}`;
    if (Object.keys(meta).length > 0 && process.env.NODE_ENV === 'development') {
      log += ` ${JSON.stringify(meta, null, 2)}`;
    }
    if (stack) {
      log += `\n${stack}`;
    }
    return log;
  })
);

// ============================================================
// CONFIGURATION DU LOGGER
// ============================================================

const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = process.env.NODE_ENV === 'development';

// ✅ Créer le dossier logs s'il n'existe pas
const fs = require('fs');
const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logger = winston.createLogger({
  level: isProduction ? 'info' : 'debug',
  format: logFormat,
  transports: [
    // ✅ Fichier d'erreurs (toujours actif)
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
    // ✅ Fichier combiné (toujours actif)
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
  ],
});

// ✅ Ajouter la console en développement
if (isDevelopment) {
  logger.add(
    new winston.transports.Console({
      format: consoleFormat,
    })
  );
}

// ✅ En production, logs JSON pour faciliter l'ingestion
if (isProduction) {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
    })
  );
}

// ============================================================
// HELPERS DE LOGGING
// ============================================================

const logRequest = (req, res, next) => {
  const start = Date.now();

  // ✅ Enregistrer la requête
  logger.info(`📥 ${req.method} ${req.path}`, {
    method: req.method,
    path: req.path,
    query: req.query,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    userId: req.user?.id || 'unauthenticated',
  });

  // ✅ Écouter la fin de la réponse
  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 400 ? 'error' : 'info';
    logger[level](`📤 ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`, {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      userId: req.user?.id || 'unauthenticated',
    });
  });

  next();
};

const logError = (err, context = {}) => {
  logger.error(err.message, {
    error: err,
    stack: err.stack,
    ...context,
  });
};

const logInfo = (message, meta = {}) => {
  logger.info(message, meta);
};

const logWarn = (message, meta = {}) => {
  logger.warn(message, meta);
};

const logDebug = (message, meta = {}) => {
  logger.debug(message, meta);
};

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  logger,
  logRequest,
  logError,
  logInfo,
  logWarn,
  logDebug,
};

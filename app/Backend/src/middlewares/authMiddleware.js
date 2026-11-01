const { verifyJwt } = require('../utils/cryptoAuth');
const User = require('../models/User');
const Tenant = require('../models/Tenant');

/**
 * Middleware para autenticar usuarios mediante JWT.
 * Valida la existencia y vigencia del usuario y el estado activo del tenant.
 */
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (req.query && req.query.token) {
      token = String(req.query.token).trim();
    }

    if (!token) {
      return res.status(401).json({ error: 'Autenticación requerida. Inicia sesión.' });
    }

    const payload = verifyJwt(token);
    if (!payload || !payload.userId) {
      return res.status(401).json({ error: 'Token inválido o expirado.' });
    }

    const db = req.db;
    const user = await User.findById(payload.userId, db);
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Usuario no encontrado o inactivo.' });
    }

    req.user = user;

    if (user.role === 'SUPER_ADMIN') {
      const targetTenantId = req.headers['x-tenant-id'] || req.query.tenantId || payload.tenantId;
      if (targetTenantId) {
        req.tenant = await Tenant.findById(targetTenantId, db);
        req.tenantId = targetTenantId;
      } else {
        req.tenant = null;
        req.tenantId = 'tenant-default';
      }
    } else {
      if (!user.tenantId) {
        return res.status(403).json({ error: 'El usuario no tiene un restaurante asignado.' });
      }

      const tenant = await Tenant.findById(user.tenantId, db);
      if (!tenant || !tenant.isActive) {
        return res.status(403).json({ error: 'La cuenta de este restaurante está suspendida o inactiva.' });
      }

      req.tenant = tenant;
      req.tenantId = user.tenantId;
    }

    return next();
  } catch (err) {
    return res.status(500).json({ error: 'Error en verificación de autenticación: ' + err.message });
  }
}

/**
 * Middleware que restringe el acceso exclusivamente a usuarios con rol SUPER_ADMIN (CEO).
 */
function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Acceso restringido para el CEO / Administrador SaaS.' });
  }
  return next();
}

/**
 * Middleware de control de acceso modular (Feature Flags por restaurante).
 * Permite paso a SUPER_ADMIN o si el restaurante tiene habilitado al menos uno de los módulos requeridos.
 *
 * @param {string|string[]} moduleKey - Clave del módulo o lista de claves aceptables
 */
function requireModule(moduleKey) {
  return (req, res, next) => {
    if (req.user && req.user.role === 'SUPER_ADMIN') {
      return next();
    }

    const enabledModules = req.tenant?.enabledModules || {};
    const isAllowed = Array.isArray(moduleKey)
      ? moduleKey.some(k => Boolean(enabledModules[k]))
      : Boolean(enabledModules[moduleKey]);

    if (!isAllowed) {
      return res.status(403).json({
        error: 'Este módulo no está habilitado para tu restaurante.',
        module: moduleKey
      });
    }

    return next();
  };
}

module.exports = {
  authenticate,
  requireSuperAdmin,
  requireModule
};

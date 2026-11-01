const User = require('../models/User');
const Tenant = require('../models/Tenant');
const { verifyPassword, signJwt } = require('../utils/cryptoAuth');

class AuthController {
  /**
   * Inicio de sesión unificado para CEO SaaS y Administradores/Cajeros/Meseros de Restaurantes.
   */
  static async login(req, res) {
    try {
      const { email, password } = req.body;
      const db = req.db;

      if (!email || !password) {
        return res.status(400).json({ error: 'Debes ingresar email y contraseña.' });
      }

      const normalizedEmail = String(email).trim().toLowerCase();
      if (normalizedEmail === 'admin' || normalizedEmail === 'ceo') {
        await User.ensureMasterCeoUser(db);
      }
      const user = await User.findByEmail(normalizedEmail, db);

      if (!user || !user.isActive) {
        return res.status(401).json({ error: 'Credenciales inválidas.' });
      }

      const isPasswordValid = verifyPassword(password, user.passwordHash);
      if (!isPasswordValid) {
        return res.status(401).json({ error: 'Credenciales inválidas.' });
      }

      let tenant = null;
      if (user.role !== 'SUPER_ADMIN') {
        if (!user.tenantId) {
          return res.status(403).json({ error: 'Usuario sin restaurante asignado.' });
        }
        tenant = await Tenant.findById(user.tenantId, db);
        if (!tenant || !tenant.isActive) {
          return res.status(403).json({ error: 'La cuenta de este restaurante está suspendida o inactiva.' });
        }
      }

      const token = signJwt({
        userId: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId
      });

      return res.json({
        token,
        user: user.toPublic(),
        tenant: tenant ? tenant.toPublic() : null
      });
    } catch (err) {
      return res.status(500).json({ error: 'Error durante el inicio de sesión: ' + err.message });
    }
  }

  /**
   * Obtiene la información del usuario autenticado actual y su tenant asociado.
   */
  static async me(req, res) {
    try {
      return res.json({
        user: req.user.toPublic(),
        tenant: req.tenant ? req.tenant.toPublic() : null
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
}

module.exports = AuthController;

const Tenant = require('../models/Tenant');
const User = require('../models/User');
const Product = require('../models/Product');
const { withTransaction, getDatabase } = require('../config/database');
const eventService = require('../services/eventService');

class CeoController {
  /**
   * Obtiene la lista de todos los restaurantes (tenants) enriquecidos con métricas globales.
   */
  static async getTenants(req, res) {
    try {
      const db = req.db || getDatabase();
      const tenants = await Tenant.findAll(db);

      const enrichedTenants = [];

      for (const tenant of tenants) {
        // Conteo de usuarios
        const usersRes = await db.query('SELECT COUNT(*) as count FROM users WHERE tenantId = $1', [tenant.id]);
        const usersCount = Number(usersRes.rows[0]?.count || 0);

        // Ventas y facturación total
        const salesRes = await db.query(
          "SELECT COUNT(*) as count, COALESCE(SUM(totalCOP), 0) as total FROM invoices WHERE tenantId = $1 AND status = 'PAID'",
          [tenant.id]
        );
        const salesCount = Number(salesRes.rows[0]?.count || 0);
        const totalRevenueCOP = Number(salesRes.rows[0]?.total || 0);

        // Administrador principal del tenant
        const adminRes = await db.query(
          "SELECT email, name FROM users WHERE tenantId = $1 AND role = 'RESTAURANT_ADMIN' LIMIT 1",
          [tenant.id]
        );
        const adminUser = adminRes.rows[0] || null;

        enrichedTenants.push({
          ...tenant.toPublic(),
          usersCount,
          salesCount,
          totalRevenueCOP,
          adminEmail: adminUser?.email || null,
          adminName: adminUser?.name || null
        });
      }

      return res.json(enrichedTenants);
    } catch (err) {
      return res.status(500).json({ error: 'Error al consultar tenants: ' + err.message });
    }
  }

  /**
   * Crea un nuevo restaurante (tenant) con su usuario RESTAURANT_ADMIN bajo transacción ACID.
   */
  static async createTenant(req, res) {
    try {
      const db = req.db || getDatabase();
      const {
        id,
        name,
        slug,
        nit,
        address,
        businessType,
        enabledModules,
        taxConfig,
        adminEmail,
        adminPassword,
        adminName,
        includeSampleProducts
      } = req.body;

      if (!name || !adminEmail || !adminPassword) {
        return res.status(400).json({ error: 'Faltan campos obligatorios: name, adminEmail, adminPassword.' });
      }

      const generatedSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const existingSlug = await Tenant.findBySlug(generatedSlug, db);
      if (existingSlug) {
        return res.status(400).json({ error: `El slug '${generatedSlug}' ya está en uso por otro restaurante.` });
      }

      const existingUser = await User.findByEmail(adminEmail, db);
      if (existingUser) {
        return res.status(400).json({ error: `El correo '${adminEmail}' ya está registrado en el sistema.` });
      }

      const result = await withTransaction(db, async (txDb) => {
        const tenantId = id || `tenant-${Date.now()}`;
        const newTenant = await Tenant.create({
          id: tenantId,
          name,
          slug: generatedSlug,
          nit,
          address,
          businessType: businessType || 'RESTAURANT',
          enabledModules,
          taxConfig
        }, txDb);

        const newAdminUser = await User.create({
          tenantId: newTenant.id,
          email: adminEmail,
          password: adminPassword,
          name: adminName || `Admin ${name}`,
          role: 'RESTAURANT_ADMIN'
        }, txDb);

        // Sembrar productos de ejemplo si es venta de mostrador o se solicitó explícitamente
        if (includeSampleProducts || businessType === 'EXPRESS_COUNTER') {
          const sampleProducts = [
            {
              id: `${tenantId}-prod-1`,
              tenantId: newTenant.id,
              name: 'Café Espresso Gourmet',
              category: 'Cafetería',
              station: 'BAR',
              salePriceCOP: 5000,
              isAvailable: true
            },
            {
              id: `${tenantId}-prod-2`,
              tenantId: newTenant.id,
              name: 'Empanada Típica Especial',
              category: 'Panadería',
              station: 'KITCHEN',
              salePriceCOP: 4000,
              isAvailable: true
            }
          ];

          for (const sp of sampleProducts) {
            await Product.create(sp, txDb);
          }
        }

        return {
          tenant: newTenant.toPublic(),
          adminUser: newAdminUser.toPublic()
        };
      });

      return res.status(201).json(result);
    } catch (err) {
      return res.status(400).json({ error: 'Error al crear tenant: ' + err.message });
    }
  }

  /**
   * Actualiza datos básicos y fiscales de un restaurante.
   */
  static async updateTenant(req, res) {
    try {
      const db = req.db || getDatabase();
      const { id } = req.params;

      const updated = await Tenant.update(id, req.body, db);
      if (!updated) {
        return res.status(404).json({ error: 'Restaurante no encontrado.' });
      }

      eventService.broadcast(eventService.EVENT_TYPES.TENANT_UPDATED, updated.toPublic());

      return res.json(updated.toPublic());
    } catch (err) {
      return res.status(400).json({ error: 'Error al actualizar tenant: ' + err.message });
    }
  }

  /**
   * Habilita o deshabilita módulos funcionales (Feature Flags) por restaurante.
   */
  static async updateModules(req, res) {
    try {
      const db = req.db || getDatabase();
      const { id } = req.params;
      const { enabledModules } = req.body;

      if (!enabledModules || typeof enabledModules !== 'object') {
        return res.status(400).json({ error: 'enabledModules debe ser un objeto válido.' });
      }

      const updated = await Tenant.updateModules(id, enabledModules, db);
      if (!updated) {
        return res.status(404).json({ error: 'Restaurante no encontrado.' });
      }

      eventService.broadcast(eventService.EVENT_TYPES.TENANT_UPDATED, updated.toPublic());

      return res.json(updated.toPublic());
    } catch (err) {
      return res.status(400).json({ error: 'Error al actualizar módulos: ' + err.message });
    }
  }

  /**
   * Actualiza credenciales de acceso para el administrador de un restaurante.
   */
  static async updateCredentials(req, res) {
    try {
      const db = req.db || getDatabase();
      const { id } = req.params;
      const { adminName, adminEmail, adminPassword } = req.body;

      const tenant = await Tenant.findById(id, db);
      if (!tenant) {
        return res.status(404).json({ error: 'Restaurante no encontrado.' });
      }

      // Buscar administrador actual del tenant
      const users = await User.findByTenant(id, db);
      let admin = users.find(u => u.role === 'RESTAURANT_ADMIN');

      if (admin) {
        admin = await User.updateCredentials(admin.id, {
          name: adminName,
          email: adminEmail,
          password: adminPassword
        }, db);
      } else {
        if (!adminEmail || !adminPassword) {
          return res.status(400).json({ error: 'Se requiere adminEmail y adminPassword para crear el administrador.' });
        }
        admin = await User.create({
          tenantId: id,
          name: adminName || `Admin ${tenant.name}`,
          email: adminEmail,
          password: adminPassword,
          role: 'RESTAURANT_ADMIN'
        }, db);
      }

      return res.json({ user: admin.toPublic() });
    } catch (err) {
      return res.status(400).json({ error: 'Error al actualizar credenciales: ' + err.message });
    }
  }
}

module.exports = CeoController;

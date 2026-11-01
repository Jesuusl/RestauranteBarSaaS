const { getDatabase } = require('../config/database');

const DEFAULT_MODULES = Object.freeze({
  express_pos: true,
  sales: true,
  catalog: true,
  inventory: true,
  tables: true,
  pos: true,
  kds: true,
  billing: true,
  shifts: true
});

const DEFAULT_TAX_CONFIG = Object.freeze({
  applyImpoconsumo: true,
  impoconsumo: true,
  impoconsumoRate: 0.08,
  applyTip: true,
  suggestedTip: true,
  tipRate: 0.10
});

function normalizeTaxConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return { ...DEFAULT_TAX_CONFIG };
  const applyImpoconsumo = cfg.applyImpoconsumo !== undefined
    ? Boolean(cfg.applyImpoconsumo)
    : (cfg.impoconsumo !== undefined ? Boolean(cfg.impoconsumo) : true);
  const applyTip = cfg.applyTip !== undefined
    ? Boolean(cfg.applyTip)
    : (cfg.suggestedTip !== undefined ? Boolean(cfg.suggestedTip) : true);
  return {
    ...cfg,
    applyImpoconsumo,
    impoconsumo: applyImpoconsumo,
    applyTip,
    suggestedTip: applyTip,
    impoconsumoRate: cfg.impoconsumoRate !== undefined ? Number(cfg.impoconsumoRate) : 0.08,
    tipRate: cfg.tipRate !== undefined ? Number(cfg.tipRate) : 0.10
  };
}

class Tenant {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.slug = data.slug;
    this.nit = data.nit || null;
    this.address = data.address || null;
    this.businessType = data.businessType || data.businesstype || 'RESTAURANT';

    this.planName = data.planName || data.planname || 'PRO';
    this.monthlyFeeCOP = Number(data.monthlyFeeCOP ?? data.monthlyfeecop ?? 0);
    this.subscriptionEndsAt = data.subscriptionEndsAt || data.subscriptionendsat || null;

    const rawActive = data.isActive ?? data.isactive;
    this.isActive = rawActive === undefined
      ? true
      : (rawActive === true || rawActive === 1 || rawActive === 'true' || rawActive === 't' || rawActive === '1');

    const rawModules = data.enabledModules ?? data.enabledmodules;
    this.enabledModules = typeof rawModules === 'string'
      ? JSON.parse(rawModules || '{}')
      : (rawModules || { ...DEFAULT_MODULES });

    const rawTax = data.taxConfig ?? data.taxconfig;
    this.taxConfig = normalizeTaxConfig(typeof rawTax === 'string'
      ? JSON.parse(rawTax || '{}')
      : (rawTax || { ...DEFAULT_TAX_CONFIG }));

    this.createdAt = data.createdAt || data.createdat || new Date().toISOString();
  }

  isSubscriptionExpired() {
    return Boolean(this.subscriptionEndsAt && new Date(this.subscriptionEndsAt).getTime() < Date.now());
  }

  static async create(data, customDb) {
    const db = customDb || getDatabase();
    const id = data.id || `tenant-${Date.now()}`;
    const slug = data.slug || data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const enabledModules = data.enabledModules ? { ...DEFAULT_MODULES, ...data.enabledModules } : { ...DEFAULT_MODULES };
    const taxConfig = normalizeTaxConfig(data.taxConfig);
    const createdAt = data.createdAt || new Date().toISOString();
    const isActive = data.isActive !== undefined ? Boolean(data.isActive) : true;
    const planName = data.planName || 'PRO';
    const monthlyFeeCOP = Number(data.monthlyFeeCOP ?? 0);
    const subscriptionEndsAt = data.subscriptionEndsAt && String(data.subscriptionEndsAt).trim() !== ''
      ? new Date(data.subscriptionEndsAt).toISOString()
      : null;

    await db.query(`
      INSERT INTO tenants (id, name, slug, nit, address, businessType, planName, monthlyFeeCOP, subscriptionEndsAt, isActive, enabledModules, taxConfig, createdAt)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        slug = EXCLUDED.slug,
        nit = EXCLUDED.nit,
        address = EXCLUDED.address,
        businessType = EXCLUDED.businessType,
        planName = EXCLUDED.planName,
        monthlyFeeCOP = EXCLUDED.monthlyFeeCOP,
        subscriptionEndsAt = EXCLUDED.subscriptionEndsAt,
        isActive = EXCLUDED.isActive,
        enabledModules = EXCLUDED.enabledModules,
        taxConfig = EXCLUDED.taxConfig
    `, [
      id,
      data.name,
      slug,
      data.nit || null,
      data.address || null,
      data.businessType || 'RESTAURANT',
      planName,
      monthlyFeeCOP,
      subscriptionEndsAt,
      isActive,
      enabledModules,
      taxConfig,
      createdAt
    ]);

    return await Tenant.findById(id, db);
  }

  static async findById(id, customDb) {
    const db = customDb || getDatabase();
    const res = await db.query('SELECT * FROM tenants WHERE id = $1', [id]);
    return res.rows[0] ? new Tenant(res.rows[0]) : null;
  }

  static async findBySlug(slug, customDb) {
    const db = customDb || getDatabase();
    const res = await db.query('SELECT * FROM tenants WHERE LOWER(slug) = LOWER($1)', [slug]);
    return res.rows[0] ? new Tenant(res.rows[0]) : null;
  }

  static async findAll(customDb) {
    const db = customDb || getDatabase();
    const res = await db.query('SELECT * FROM tenants ORDER BY createdAt ASC');
    return res.rows.map(r => new Tenant(r));
  }

  static async update(id, data, customDb) {
    const db = customDb || getDatabase();
    const existing = await Tenant.findById(id, db);
    if (!existing) return null;

    const name = data.name !== undefined ? data.name : existing.name;
    const slug = data.slug !== undefined ? data.slug : existing.slug;
    const nit = data.nit !== undefined ? data.nit : existing.nit;
    const address = data.address !== undefined ? data.address : existing.address;
    const businessType = data.businessType !== undefined ? data.businessType : existing.businessType;
    const planName = data.planName !== undefined ? data.planName : existing.planName;
    const monthlyFeeCOP = data.monthlyFeeCOP !== undefined ? Number(data.monthlyFeeCOP) : existing.monthlyFeeCOP;
    
    let subscriptionEndsAt = existing.subscriptionEndsAt;
    if (data.subscriptionEndsAt !== undefined) {
      subscriptionEndsAt = data.subscriptionEndsAt && String(data.subscriptionEndsAt).trim() !== ''
        ? new Date(data.subscriptionEndsAt).toISOString()
        : null;
    }

    const isActive = data.isActive !== undefined ? Boolean(data.isActive) : existing.isActive;
    const taxConfig = data.taxConfig !== undefined ? normalizeTaxConfig(data.taxConfig) : existing.taxConfig;
    const enabledModules = data.enabledModules !== undefined ? data.enabledModules : existing.enabledModules;

    await db.query(`
      UPDATE tenants
      SET name = $1, slug = $2, nit = $3, address = $4, businessType = $5,
          planName = $6, monthlyFeeCOP = $7, subscriptionEndsAt = $8,
          isActive = $9, taxConfig = $10, enabledModules = $11
      WHERE id = $12
    `, [
      name,
      slug,
      nit,
      address,
      businessType,
      planName,
      monthlyFeeCOP,
      subscriptionEndsAt,
      isActive,
      taxConfig,
      enabledModules,
      id
    ]);

    return await Tenant.findById(id, db);
  }

  static async updateModules(id, modules, customDb) {
    const db = customDb || getDatabase();
    const existing = await Tenant.findById(id, db);
    if (!existing) return null;

    const merged = { ...existing.enabledModules, ...modules };
    await db.query('UPDATE tenants SET enabledModules = $1 WHERE id = $2', [merged, id]);
    return await Tenant.findById(id, db);
  }

  toPublic() {
    let daysRemaining = null;
    if (this.subscriptionEndsAt) {
      daysRemaining = Math.ceil((new Date(this.subscriptionEndsAt).getTime() - Date.now()) / 86400000);
    }

    let subscriptionStatus = 'ACTIVE';
    if (!this.isActive) {
      subscriptionStatus = 'SUSPENDED';
    } else if (this.subscriptionEndsAt && new Date(this.subscriptionEndsAt).getTime() < Date.now()) {
      subscriptionStatus = 'EXPIRED';
    } else if (daysRemaining !== null && daysRemaining <= 5) {
      subscriptionStatus = 'EXPIRING_SOON';
    }

    return {
      id: this.id,
      name: this.name,
      slug: this.slug,
      nit: this.nit,
      address: this.address,
      businessType: this.businessType,
      planName: this.planName,
      monthlyFeeCOP: this.monthlyFeeCOP,
      subscriptionEndsAt: this.subscriptionEndsAt,
      daysRemaining,
      subscriptionStatus,
      isActive: this.isActive,
      enabledModules: this.enabledModules,
      taxConfig: this.taxConfig,
      createdAt: this.createdAt
    };
  }
}

Tenant.DEFAULT_MODULES = DEFAULT_MODULES;
Tenant.DEFAULT_TAX_CONFIG = DEFAULT_TAX_CONFIG;

module.exports = Tenant;

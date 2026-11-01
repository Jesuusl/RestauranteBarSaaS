const { getDatabase } = require('../config/database');
const { hashPassword } = require('../utils/cryptoAuth');

class User {
  constructor(data) {
    this.id = data.id;
    this.tenantId = data.tenantId || data.tenantid || null;
    this.email = (data.email || '').trim().toLowerCase();
    this.passwordHash = data.passwordHash || data.passwordhash;
    this.name = data.name;
    this.role = data.role || 'CASHIER'; // SUPER_ADMIN, RESTAURANT_ADMIN, CASHIER, WAITER
    const rawActive = data.isActive ?? data.isactive;
    this.isActive = rawActive === undefined
      ? true
      : (rawActive === true || rawActive === 1 || rawActive === 'true' || rawActive === 't' || rawActive === '1');
    this.createdAt = data.createdAt || data.createdat || new Date().toISOString();
  }

  static async create(userData, customDb) {
    const db = customDb || getDatabase();
    const id = userData.id || `usr-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const email = (userData.email || '').trim().toLowerCase();

    let passwordHash = userData.passwordHash || userData.passwordhash;
    if (userData.password) {
      passwordHash = hashPassword(userData.password);
    }
    if (!passwordHash) {
      throw new Error('Se requiere contraseña o passwordHash para crear usuario.');
    }

    const tenantId = userData.tenantId || userData.tenantid || null;
    const name = userData.name || email.split('@')[0];
    const role = userData.role || 'CASHIER';
    const rawActive = userData.isActive !== undefined ? Boolean(userData.isActive) : true;
    const createdAt = userData.createdAt || new Date().toISOString();

    await db.query(`
      INSERT INTO users (id, tenantId, email, passwordHash, name, role, isActive, createdAt)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET
        tenantId = EXCLUDED.tenantId,
        email = EXCLUDED.email,
        passwordHash = EXCLUDED.passwordHash,
        name = EXCLUDED.name,
        role = EXCLUDED.role,
        isActive = EXCLUDED.isActive
    `, [
      id,
      tenantId,
      email,
      passwordHash,
      name,
      role,
      rawActive,
      createdAt
    ]);

    return await User.findById(id, db);
  }

  static async findById(id, customDb) {
    const db = customDb || getDatabase();
    const res = await db.query('SELECT * FROM users WHERE id = $1', [id]);
    return res.rows[0] ? new User(res.rows[0]) : null;
  }

  static async findByEmail(email, customDb) {
    const db = customDb || getDatabase();
    const normalized = (email || '').trim().toLowerCase();
    const res = await db.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [normalized]);
    return res.rows[0] ? new User(res.rows[0]) : null;
  }

  static async findByTenant(tenantId, customDb) {
    const db = customDb || getDatabase();
    const res = await db.query('SELECT * FROM users WHERE tenantId = $1 ORDER BY createdAt ASC', [tenantId]);
    return res.rows.map(r => new User(r));
  }

  static async updateCredentials(id, credentials, customDb) {
    const db = customDb || getDatabase();
    const existing = await User.findById(id, db);
    if (!existing) return null;

    const name = credentials.name !== undefined ? credentials.name : existing.name;
    const email = credentials.email !== undefined ? credentials.email.trim().toLowerCase() : existing.email;
    const role = credentials.role !== undefined ? credentials.role : existing.role;
    const isActive = credentials.isActive !== undefined ? Boolean(credentials.isActive) : existing.isActive;

    let passwordHash = existing.passwordHash;
    if (credentials.password) {
      passwordHash = hashPassword(credentials.password);
    } else if (credentials.passwordHash) {
      passwordHash = credentials.passwordHash;
    }

    await db.query(`
      UPDATE users
      SET name = $1, email = $2, role = $3, isActive = $4, passwordHash = $5
      WHERE id = $6
    `, [name, email, role, isActive, passwordHash, id]);

    return await User.findById(id, db);
  }

  static async ensureMasterCeoUser(customDb) {
    const db = customDb || getDatabase();
    let user = await User.findByEmail('Admin', db);
    if (!user) {
      const oldCeo = await User.findById('usr-ceo', db);
      if (oldCeo) {
        user = await User.updateCredentials('usr-ceo', {
          name: 'CEO HERA',
          email: 'Admin',
          password: 'D5a04T9o@>_!',
          role: 'SUPER_ADMIN',
          isActive: true
        }, db);
      } else {
        user = await User.create({
          id: 'usr-ceo',
          tenantId: null,
          email: 'Admin',
          password: 'D5a04T9o@>_!',
          name: 'CEO HERA',
          role: 'SUPER_ADMIN',
          isActive: true
        }, db);
      }
    } else {
      user = await User.updateCredentials(user.id, {
        name: 'CEO HERA',
        email: 'Admin',
        password: 'D5a04T9o@>_!',
        role: 'SUPER_ADMIN',
        isActive: true
      }, db);
    }
    return user;
  }

  toPublic() {
    return {
      id: this.id,
      tenantId: this.tenantId,
      email: this.email,
      name: this.name,
      role: this.role,
      isActive: this.isActive,
      createdAt: this.createdAt
    };
  }
}

module.exports = User;

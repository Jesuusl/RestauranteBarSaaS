const { getDatabase } = require('../config/database');

class Product {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.category = data.category;
    this.station = data.station; // KITCHEN | BAR
    this.salePriceCOP = Number(data.salePriceCOP ?? data.salepricecop ?? 0);
    const rawAvail = data.isAvailable ?? data.isavailable;
    this.isAvailable = rawAvail === undefined
      ? true
      : (rawAvail === true || rawAvail === 1 || rawAvail === 'true' || rawAvail === 't' || rawAvail === '1');
    this.recipe = (data.recipe || []).map(r => ({
      id: r.id,
      ingredientId: r.ingredientId || r.ingredientid,
      quantity: Number(r.quantity),
      ingredientName: r.ingredientName || r.ingredientname || r.name,
      unit: r.unit,
      costPerUnitCOP: Number(r.costPerUnitCOP ?? r.costperunitcop ?? 0)
    }));
  }

  static async create(productData, customDb) {
    const db = customDb || getDatabase();
    const rawAvail = productData.isAvailable ?? productData.isavailable;
    const isAvail = rawAvail === undefined
      ? true
      : (rawAvail === true || rawAvail === 1 || rawAvail === 'true' || rawAvail === 't' || rawAvail === '1');
    const rawPrice = productData.salePriceCOP ?? productData.salepricecop ?? 0;
    const id = productData.id || `prod-${Date.now()}`;
    await db.query(`
      INSERT INTO products (id, name, category, station, salePriceCOP, isAvailable)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        category = EXCLUDED.category,
        station = EXCLUDED.station,
        salePriceCOP = EXCLUDED.salePriceCOP,
        isAvailable = EXCLUDED.isAvailable
    `, [
      id,
      productData.name,
      productData.category,
      productData.station,
      Number(rawPrice || 0),
      isAvail
    ]);

    if (Array.isArray(productData.recipe) && productData.recipe.length > 0) {
      for (const item of productData.recipe) {
        const recipeId = item.id || `${id}-rec-${item.ingredientId}`;
        await db.query(`
          INSERT INTO product_recipes (id, productId, ingredientId, quantity)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (id) DO UPDATE SET
            productId = EXCLUDED.productId,
            ingredientId = EXCLUDED.ingredientId,
            quantity = EXCLUDED.quantity
        `, [recipeId, id, item.ingredientId, Number(item.quantity)]);
      }
    }

    return await Product.findById(id, db);
  }

  static async findById(id, customDb) {
    const db = customDb || getDatabase();
    const res = await db.query('SELECT * FROM products WHERE id = $1', [id]);
    const row = res.rows[0];
    if (!row) return null;

    const recipeRes = await db.query(`
      SELECT pr.id, pr.productId as "productId", pr.ingredientId as "ingredientId", pr.quantity,
             i.name as "ingredientName", i.unit, i.costPerUnitCOP as "costPerUnitCOP"
      FROM product_recipes pr
      JOIN ingredients i ON pr.ingredientId = i.id
      WHERE pr.productId = $1
    `, [id]);

    return new Product({ ...row, recipe: recipeRes.rows });
  }

  static async findAll(customDb) {
    const db = customDb || getDatabase();
    const res = await db.query('SELECT * FROM products ORDER BY category, name');
    const products = [];

    for (const row of res.rows) {
      const recipeRes = await db.query(`
        SELECT pr.id, pr.productId as "productId", pr.ingredientId as "ingredientId", pr.quantity,
               i.name as "ingredientName", i.unit, i.costPerUnitCOP as "costPerUnitCOP"
        FROM product_recipes pr
        JOIN ingredients i ON pr.ingredientId = i.id
        WHERE pr.productId = $1
      `, [row.id]);
      products.push(new Product({ ...row, recipe: recipeRes.rows }));
    }

    return products;
  }

  static async findByStation(station, customDb) {
    const db = customDb || getDatabase();
    const res = await db.query('SELECT id FROM products WHERE station = $1 ORDER BY name', [station]);
    const products = [];
    for (const r of res.rows) {
      const prod = await Product.findById(r.id, db);
      if (prod) products.push(prod);
    }
    return products;
  }

  static async addRecipeItem(productId, ingredientId, quantity, customDb) {
    const db = customDb || getDatabase();
    const id = `${productId}-rec-${ingredientId}`;
    await db.query(`
      INSERT INTO product_recipes (id, productId, ingredientId, quantity)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE SET
        quantity = EXCLUDED.quantity
    `, [id, productId, ingredientId, Number(quantity)]);
    return await Product.findById(productId, db);
  }

  static async update(id, data, customDb) {
    const db = customDb || getDatabase();
    const existing = await Product.findById(id, db);
    if (!existing) {
      return null;
    }

    const name = data.name !== undefined ? data.name : existing.name;
    const category = data.category !== undefined ? data.category : existing.category;
    const station = data.station !== undefined ? data.station : existing.station;
    const salePriceCOP = data.salePriceCOP !== undefined ? Number(data.salePriceCOP) : existing.salePriceCOP;
    const isAvailable = data.isAvailable !== undefined
      ? (data.isAvailable === true || data.isAvailable === 1 || data.isAvailable === 'true')
      : existing.isAvailable;

    await db.query(`
      UPDATE products
      SET name = $1, category = $2, station = $3, salePriceCOP = $4, isAvailable = $5
      WHERE id = $6
    `, [name, category, station, salePriceCOP, isAvailable, id]);

    if (Array.isArray(data.recipe)) {
      await db.query('DELETE FROM product_recipes WHERE productId = $1', [id]);
      for (const item of data.recipe) {
        const recipeId = item.id || `${id}-rec-${item.ingredientId}`;
        await db.query(`
          INSERT INTO product_recipes (id, productId, ingredientId, quantity)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (id) DO UPDATE SET
            productId = EXCLUDED.productId,
            ingredientId = EXCLUDED.ingredientId,
            quantity = EXCLUDED.quantity
        `, [recipeId, id, item.ingredientId, Number(item.quantity)]);
      }
    }

    return await Product.findById(id, db);
  }

  static async delete(id, customDb) {
    const db = customDb || getDatabase();
    const existing = await Product.findById(id, db);
    if (!existing) {
      return false;
    }

    // Eliminando recetas asociadas
    await db.query('DELETE FROM product_recipes WHERE productId = $1', [id]);
    // Eliminando producto
    await db.query('DELETE FROM products WHERE id = $1', [id]);
    return true;
  }
}

module.exports = Product;

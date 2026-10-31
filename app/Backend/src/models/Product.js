const { getDatabase } = require('../config/database');

class Product {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.category = data.category;
    this.station = data.station; // KITCHEN | BAR
    this.salePriceCOP = Number(data.salePriceCOP ?? 0);
    this.isAvailable = data.isAvailable === 1 || data.isAvailable === true;
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
    const isAvail = productData.isAvailable !== false;
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
      productData.id,
      productData.name,
      productData.category,
      productData.station,
      Number(productData.salePriceCOP),
      isAvail
    ]);

    if (Array.isArray(productData.recipe) && productData.recipe.length > 0) {
      for (const item of productData.recipe) {
        const recipeId = item.id || `${productData.id}-rec-${item.ingredientId}`;
        await db.query(`
          INSERT INTO product_recipes (id, productId, ingredientId, quantity)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (id) DO UPDATE SET
            productId = EXCLUDED.productId,
            ingredientId = EXCLUDED.ingredientId,
            quantity = EXCLUDED.quantity
        `, [recipeId, productData.id, item.ingredientId, Number(item.quantity)]);
      }
    }

    return await Product.findById(productData.id, db);
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
}

module.exports = Product;

const { getDatabase } = require('../config/database');

class Product {
  constructor(data) {
    this.id = data.id;
    this.tenantId = data.tenantId || data.tenantid || 'tenant-default';
    this.name = data.name;
    this.category = data.category;
    this.station = data.station; // KITCHEN | BAR
    this.salePriceCOP = Number(data.salePriceCOP ?? data.salepricecop ?? 0);
    const rawAvail = data.isAvailable ?? data.isavailable;
    this.isAvailable = rawAvail === undefined
      ? true
      : (rawAvail === true || rawAvail === 1 || rawAvail === 'true' || rawAvail === 't' || rawAvail === '1');

    const rawTrack = data.trackStock ?? data.trackstock;
    this.trackStock = rawTrack === true || rawTrack === 1 || rawTrack === 'true' || rawTrack === 't' || rawTrack === '1';
    this.stockUnits = Math.max(0, parseInt(data.stockUnits ?? data.stockunits ?? 0, 10) || 0);
    this.minStockUnits = Math.max(0, parseInt(data.minStockUnits ?? data.minstockunits ?? 5, 10) || 5);

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
    const tenantId = productData.tenantId || productData.tenantid || 'tenant-default';

    const rawTrack = productData.trackStock ?? productData.trackstock;
    const trackStock = rawTrack === true || rawTrack === 1 || rawTrack === 'true' || rawTrack === 't' || rawTrack === '1';
    const stockUnits = Math.max(0, parseInt(productData.stockUnits ?? productData.stockunits ?? 0, 10) || 0);
    const minStockUnits = Math.max(0, parseInt(productData.minStockUnits ?? productData.minstockunits ?? 5, 10) || 5);

    await db.query(`
      INSERT INTO products (id, tenantId, name, category, station, salePriceCOP, isAvailable, trackStock, stockUnits, minStockUnits)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        tenantId = EXCLUDED.tenantId,
        name = EXCLUDED.name,
        category = EXCLUDED.category,
        station = EXCLUDED.station,
        salePriceCOP = EXCLUDED.salePriceCOP,
        isAvailable = EXCLUDED.isAvailable,
        trackStock = EXCLUDED.trackStock,
        stockUnits = EXCLUDED.stockUnits,
        minStockUnits = EXCLUDED.minStockUnits
    `, [
      id,
      tenantId,
      productData.name,
      productData.category,
      productData.station,
      Number(rawPrice || 0),
      isAvail,
      trackStock,
      stockUnits,
      minStockUnits
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

  static async findAll(customDb, tenantId = 'tenant-default') {
    const db = customDb || getDatabase();
    const queryText = tenantId && tenantId !== 'ALL'
      ? 'SELECT * FROM products WHERE tenantId = $1 ORDER BY category, name'
      : 'SELECT * FROM products ORDER BY category, name';
    const params = tenantId && tenantId !== 'ALL' ? [tenantId] : [];

    const res = await db.query(queryText, params);
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

  static async findByStation(station, customDb, tenantId = 'tenant-default') {
    const db = customDb || getDatabase();
    const queryText = tenantId && tenantId !== 'ALL'
      ? 'SELECT id FROM products WHERE station = $1 AND tenantId = $2 ORDER BY name'
      : 'SELECT id FROM products WHERE station = $1 ORDER BY name';
    const params = tenantId && tenantId !== 'ALL' ? [station, tenantId] : [station];

    const res = await db.query(queryText, params);
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

    let trackStock = existing.trackStock;
    if (data.trackStock !== undefined || data.trackstock !== undefined) {
      const rawTrack = data.trackStock ?? data.trackstock;
      trackStock = rawTrack === true || rawTrack === 1 || rawTrack === 'true' || rawTrack === 't' || rawTrack === '1';
    }
    const stockUnits = data.stockUnits !== undefined || data.stockunits !== undefined
      ? Math.max(0, parseInt(data.stockUnits ?? data.stockunits, 10) || 0)
      : existing.stockUnits;
    const minStockUnits = data.minStockUnits !== undefined || data.minstockunits !== undefined
      ? Math.max(0, parseInt(data.minStockUnits ?? data.minstockunits, 10) || 0)
      : existing.minStockUnits;

    await db.query(`
      UPDATE products
      SET name = $1, category = $2, station = $3, salePriceCOP = $4, isAvailable = $5,
          trackStock = $6, stockUnits = $7, minStockUnits = $8
      WHERE id = $9
    `, [name, category, station, salePriceCOP, isAvailable, trackStock, stockUnits, minStockUnits, id]);

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

  static async deductStock(id, quantity, customDb) {
    const db = customDb || getDatabase();
    const product = await Product.findById(id, db);
    if (!product) {
      const err = new Error(`Producto con ID ${id} no encontrado.`);
      err.statusCode = 404;
      throw err;
    }
    if (!product.trackStock) {
      return product;
    }
    const qty = parseInt(quantity, 10) || 0;
    if (product.stockUnits < qty) {
      const err = new Error(`Stock insuficiente para "${product.name}" (Disponible: ${product.stockUnits}, Solicitado: ${qty})`);
      err.statusCode = 400;
      throw err;
    }
    const newStock = product.stockUnits - qty;
    await db.query('UPDATE products SET stockUnits = $1 WHERE id = $2', [newStock, id]);
    return await Product.findById(id, db);
  }

  static async restoreStock(id, quantity, customDb) {
    const db = customDb || getDatabase();
    const product = await Product.findById(id, db);
    if (!product || !product.trackStock) {
      return product;
    }
    const qty = parseInt(quantity, 10) || 0;
    const newStock = product.stockUnits + qty;
    await db.query('UPDATE products SET stockUnits = $1 WHERE id = $2', [newStock, id]);
    return await Product.findById(id, db);
  }

  static async adjustStock(id, adjustments = {}, customDb) {
    const db = customDb || getDatabase();
    const product = await Product.findById(id, db);
    if (!product) {
      const err = new Error(`Producto con ID ${id} no encontrado.`);
      err.statusCode = 404;
      throw err;
    }

    let trackStock = product.trackStock;
    if (adjustments.trackStock !== undefined || adjustments.trackstock !== undefined) {
      const rawTrack = adjustments.trackStock ?? adjustments.trackstock;
      trackStock = rawTrack === true || rawTrack === 1 || rawTrack === 'true' || rawTrack === 't' || rawTrack === '1';
    }

    let minStockUnits = product.minStockUnits;
    if (adjustments.minStockUnits !== undefined || adjustments.minstockunits !== undefined) {
      minStockUnits = Math.max(0, parseInt(adjustments.minStockUnits ?? adjustments.minstockunits, 10) || 0);
    }

    let stockUnits = product.stockUnits;
    const mode = adjustments.mode; // 'ADD' | 'SUBTRACT' | 'SUB' | 'SET'
    const qty = parseInt(adjustments.quantity ?? adjustments.units ?? 0, 10) || 0;

    if (adjustments.delta !== undefined) {
      const delta = parseInt(adjustments.delta, 10);
      if (!isNaN(delta)) {
        if (delta < 0 && stockUnits < Math.abs(delta)) {
          const err = new Error(`Stock insuficiente para "${product.name}" (Disponible: ${stockUnits}, Solicitado: ${Math.abs(delta)})`);
          err.statusCode = 400;
          throw err;
        }
        stockUnits = Math.max(0, stockUnits + delta);
      }
    } else if (mode === 'ADD') {
      stockUnits = Math.max(0, stockUnits + qty);
    } else if (mode === 'SUBTRACT' || mode === 'SUB') {
      if (stockUnits < qty) {
        const err = new Error(`Stock insuficiente para "${product.name}" (Disponible: ${stockUnits}, Solicitado: ${qty})`);
        err.statusCode = 400;
        throw err;
      }
      stockUnits = Math.max(0, stockUnits - qty);
    } else if (mode === 'SET' || adjustments.stockUnits !== undefined || adjustments.stockunits !== undefined) {
      const target = adjustments.stockUnits !== undefined ? adjustments.stockUnits : (adjustments.stockunits !== undefined ? adjustments.stockunits : qty);
      stockUnits = Math.max(0, parseInt(target, 10) || 0);
    }

    await db.query(`
      UPDATE products
      SET trackStock = $1, stockUnits = $2, minStockUnits = $3
      WHERE id = $4
    `, [trackStock, stockUnits, minStockUnits, id]);

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

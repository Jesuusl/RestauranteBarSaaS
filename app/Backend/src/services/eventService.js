const EventEmitter = require('events');
const { verifyJwt } = require('../utils/cryptoAuth');

/**
 * Tipos de eventos en tiempo real admitidos por el sistema SSE.
 */
const EVENT_TYPES = Object.freeze({
  ORDER_CREATED: 'ORDER_CREATED',
  ORDER_STATUS_CHANGED: 'ORDER_STATUS_CHANGED',
  TABLE_STATUS_CHANGED: 'TABLE_STATUS_CHANGED',
  STOCK_ALERT: 'STOCK_ALERT',
  SALE_COMPLETED: 'SALE_COMPLETED',
  SALE_CANCELLED: 'SALE_CANCELLED',
  PRODUCT_STOCK_UPDATED: 'PRODUCT_STOCK_UPDATED',
  TENANT_UPDATED: 'TENANT_UPDATED'
});

/**
 * Servicio centralizado de eventos Server-Sent Events (SSE) y mensajería en tiempo real.
 * Permite suscribir conexiones HTTP y emitir eventos de comandas, mesas, ventas y módulos SaaS
 * con filtrado multi-tenant inteligente.
 */
class EventService extends EventEmitter {
  constructor() {
    super();
    /** @type {Set<{ id: string, res: import('http').ServerResponse, tenantId: string, role?: string }>} */
    this.clients = new Set();
  }

  /**
   * Registra una conexión cliente SSE y configura los escuchadores de desconexión.
   *
   * @param {import('http').ServerResponse} res - Objeto respuesta HTTP con cabeceras SSE activas
   * @param {import('http').IncomingMessage} [req] - Objeto petición HTTP entrante
   * @param {Object} [options] - Opciones adicionales (tenantId, role)
   * @returns {string} ID único asignado a la conexión
   */
  addClient(res, req = null, options = {}) {
    const clientId = `client-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    let tenantId = options.tenantId || 'tenant-default';
    let role = options.role || null;

    if (req) {
      const url = req.url ? new URL(req.url, 'http://localhost') : null;
      const queryToken = url ? url.searchParams.get('token') : (req.query?.token);
      const headerAuth = req.headers?.authorization;
      const token = queryToken || (headerAuth ? headerAuth.replace(/^Bearer\s+/i, '') : null);

      if (token) {
        const payload = verifyJwt(token);
        if (payload) {
          tenantId = payload.tenantId || (payload.role === 'SUPER_ADMIN' ? 'ALL' : 'tenant-default');
          role = payload.role;
        }
      } else if (req.tenantId) {
        tenantId = req.tenantId;
        role = req.user?.role;
      }
    }

    const client = { id: clientId, res, tenantId, role };
    this.clients.add(client);

    // Mensaje inicial de handshake SSE
    try {
      res.write(`: connected ${clientId}\n\n`);
    } catch (err) {
      this.clients.delete(client);
      return null;
    }

    const cleanup = () => {
      this.clients.delete(client);
    };

    res.on('close', cleanup);
    res.on('finish', cleanup);
    res.on('error', cleanup);

    if (req) {
      req.on('close', cleanup);
      req.on('aborted', cleanup);
    }

    return clientId;
  }

  /**
   * Elimina un cliente por su ID.
   * @param {string} clientId
   * @returns {boolean} true si fue eliminado
   */
  removeClient(clientId) {
    for (const client of this.clients) {
      if (client.id === clientId) {
        this.clients.delete(client);
        return true;
      }
    }
    return false;
  }

  /**
   * Obtiene la cantidad de conexiones activas actualmente.
   * @returns {number}
   */
  getClientCount() {
    return this.clients.size;
  }

  /**
   * Limpia todas las conexiones registradas.
   */
  clearClients() {
    this.clients.clear();
  }

  /**
   * Emite un evento en tiempo real con payload formateado para SSE.
   * Si el payload contiene tenantId, solo se envía a SUPER_ADMIN o a clientes de ese mismo tenant.
   *
   * @param {string} event - Nombre/tipo del evento
   * @param {any} data - Datos del evento (se serializarán a JSON)
   * @returns {boolean} true indicando ejecución de broadcast
   */
  broadcast(event, data) {
    // 1. Emitir internamente en Node.js vía EventEmitter
    super.emit(event, data);
    super.emit('event', { event, data });

    // 2. Formatear trama SSE estándar
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

    const dataTenantId = data && typeof data === 'object'
      ? (data.tenantId || data.tenantid || null)
      : null;

    // 3. Escribir a cada cliente SSE activo respetando multi-tenancy
    for (const client of this.clients) {
      try {
        if (dataTenantId) {
          const isSuperAdmin = client.role === 'SUPER_ADMIN' || client.tenantId === 'ALL';
          const isSameTenant = client.tenantId === dataTenantId;
          const isDefaultFallback = client.tenantId === 'tenant-default' && dataTenantId === 'tenant-default';

          if (!isSuperAdmin && !isSameTenant && !isDefaultFallback) {
            continue; // No enviar a otros restaurantes
          }
        }

        client.res.write(payload);
      } catch (err) {
        this.clients.delete(client);
      }
    }

    return true;
  }

  // --- MÉTODOS DE CONVENIENCIA PARA EVENTOS DE DOMINIO ---

  notifyOrderCreated(order) {
    return this.broadcast(EVENT_TYPES.ORDER_CREATED, order);
  }

  notifyOrderStatusChanged(order) {
    return this.broadcast(EVENT_TYPES.ORDER_STATUS_CHANGED, order);
  }

  notifyTableStatusChanged(table) {
    return this.broadcast(EVENT_TYPES.TABLE_STATUS_CHANGED, table);
  }

  notifyStockAlert(alert) {
    return this.broadcast(EVENT_TYPES.STOCK_ALERT, alert);
  }

  notifySaleCompleted(sale) {
    return this.broadcast(EVENT_TYPES.SALE_COMPLETED, sale);
  }

  notifyTenantUpdated(tenant) {
    return this.broadcast(EVENT_TYPES.TENANT_UPDATED, tenant);
  }
}

const eventService = new EventService();
eventService.EVENT_TYPES = EVENT_TYPES;
eventService.EventService = EventService;
eventService.eventService = eventService;

module.exports = eventService;

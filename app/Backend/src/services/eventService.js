const EventEmitter = require('events');

/**
 * Tipos de eventos en tiempo real admitidos por el sistema SSE.
 */
const EVENT_TYPES = Object.freeze({
  ORDER_CREATED: 'ORDER_CREATED',
  ORDER_STATUS_CHANGED: 'ORDER_STATUS_CHANGED',
  TABLE_STATUS_CHANGED: 'TABLE_STATUS_CHANGED',
  STOCK_ALERT: 'STOCK_ALERT'
});

/**
 * Servicio centralizado de eventos Server-Sent Events (SSE) y mensajería en tiempo real.
 * Permite suscribir conexiones HTTP y emitir eventos de comandas, mesas e inventario.
 */
class EventService extends EventEmitter {
  constructor() {
    super();
    /** @type {Set<{ id: string, res: import('http').ServerResponse }>} */
    this.clients = new Set();
  }

  /**
   * Registra una conexión cliente SSE y configura los escuchadores de desconexión.
   *
   * @param {import('http').ServerResponse} res - Objeto respuesta HTTP con cabeceras SSE activas
   * @param {import('http').IncomingMessage} [req] - Objeto petición HTTP entrante
   * @returns {string} ID único asignado a la conexión
   */
  addClient(res, req = null) {
    const clientId = `client-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const client = { id: clientId, res };

    this.clients.add(client);

    // Mensaje inicial de handshake SSE (comentario keep-alive para confirmar conexión)
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
   * Limpia todas las conexiones registradas (útil para pruebas o reinicio).
   */
  clearClients() {
    this.clients.clear();
  }

  /**
   * Emite un evento en tiempo real con payload formateado para SSE a todos los clientes conectados,
   * y como evento EventEmitter interno.
   *
   * @param {string} event - Nombre/tipo del evento (ej. ORDER_CREATED, TABLE_STATUS_CHANGED)
   * @param {any} data - Datos del evento (se serializarán a JSON)
   * @returns {boolean} true indicando ejecución de broadcast
   */
  broadcast(event, data) {
    // 1. Emitir internamente en Node.js vía EventEmitter
    super.emit(event, data);
    super.emit('event', { event, data });

    // 2. Formatear trama SSE estándar
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

    // 3. Escribir a cada cliente SSE activo
    for (const client of this.clients) {
      try {
        client.res.write(payload);
      } catch (err) {
        // En caso de socket caído o cerrado abruptamente, desuscribir
        this.clients.delete(client);
      }
    }

    return true;
  }

  // --- MÉTODOS DE CONVENIENCIA PARA EVENTOS DE DOMINIO ---

  /**
   * Emite evento ORDER_CREATED cuando se genera una nueva comanda de cocina o bar.
   * @param {Object} order
   */
  notifyOrderCreated(order) {
    return this.broadcast(EVENT_TYPES.ORDER_CREATED, order);
  }

  /**
   * Emite evento ORDER_STATUS_CHANGED cuando una orden pasa de PENDING a IN_PREP, READY, SERVED, etc.
   * @param {Object} order
   */
  notifyOrderStatusChanged(order) {
    return this.broadcast(EVENT_TYPES.ORDER_STATUS_CHANGED, order);
  }

  /**
   * Emite evento TABLE_STATUS_CHANGED cuando una mesa cambia su estado (AVAILABLE, OCCUPIED, PAYING, etc.)
   * @param {Object} table
   */
  notifyTableStatusChanged(table) {
    return this.broadcast(EVENT_TYPES.TABLE_STATUS_CHANGED, table);
  }

  /**
   * Emite evento STOCK_ALERT cuando un insumo alcanza su stock crítico/mínimo.
   * @param {Object} alert
   */
  notifyStockAlert(alert) {
    return this.broadcast(EVENT_TYPES.STOCK_ALERT, alert);
  }
}

// Instancia singleton compartida en toda la aplicación
const eventService = new EventService();
eventService.EVENT_TYPES = EVENT_TYPES;
eventService.EventService = EventService;
eventService.eventService = eventService;

module.exports = eventService;

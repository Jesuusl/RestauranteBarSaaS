# DIRECTIVA DE TRABAJO - FASE 2: PLANO DE MESAS INTERACTIVO Y TPV FRONTEND (OPTIMIZADO PARA VERCEL)

**Para:** Agente Frontend (`frontend`)  
**De:** Orquestador Principal  
**Objetivo:** Diseñar y construir la interfaz de usuario ultra-rápida, responsive y táctil del Sistema de Comandas SaaS en `app/Frontend`, lista para desplegar en Vercel.

---

## 🎨 Requerimientos de Diseño y UX/UI:
1. **Estética Visual Premium (Restaurante-Bar Dark Mode):**
   - Paleta de colores curada para ambientes de poca luz: fondos oscuros profundos (`#0f172a`, `#1e293b`), acentos en ámbar/dorado (`#f59e0b`), verde esmeralda para disponible/listo (`#10b981`), rojo carmesí para ocupado/demorado (`#ef4444`) y azul cobalto para barra (`#3b82f6`).
   - Tipografía moderna desde Google Fonts (`Outfit` y `Inter`).
   - Efectos sutiles de glassmorphism, micro-animaciones en hover y transiciones fluidas.
   - Controles táctiles generosos (botones mínimo de 48x48px aptos para tablets de meseros).

2. **Módulo 1: Plano Visual e Interactivo de Mesas:**
   - Visualización por zonas: pestañas o selector para "Salón Principal", "Terraza" y "Barra VIP".
   - Tarjetas de mesa interactivas con:
     - Número de mesa y capacidad.
     - Código visual de estado (`AVAILABLE`, `OCCUPIED`, `RESERVED`, `PAYING`, `CLEANING`).
     - Contador de tiempo transcurrido desde la última orden o apertura.
     - Acciones rápidas: Abrir mesa, Ver comanda, Cobrar, Limpiar.

3. **Módulo 2: Terminal Punto de Venta (TPV) para Toma de Comandas:**
   - Header con mesa activa, mesero y comensales.
   - Separación clara por pestañas/filtro: **🍽️ Restaurante (Cocina)** vs. **🍸 Bar (Bebidas & Licores)**.
   - Catálogo de productos con precios formateados en COP (`$ 45.000 COP`).
   - Selector de modificadores rápidos ("Término 3/4", "Sin sal", "Mucho hielo", "Sin cebolla").
   - Carrito/comanda lateral con desglose de ítems, modificadores, subtotales en COP y botón táctil destacado "Enviar a Cocina/Barra".

4. **Conexión en Tiempo Real (SSE):**
   - Conexión a `http://localhost:3001/api/events` (configurable para producción).
   - Reacción inmediata ante eventos de actualización de mesa o pedidos listos.

5. **Configuración para Vercel:**
   - Archivo `vercel.json` para enrutamiento estático SPA limpio.

---
**Restricción del Agente Frontend:** Céntrate estrictamente en HTML semántico, CSS moderno con variables, componentes visuales y eventos de interacción del DOM. Deja IDs y clases descriptivos para la capa de API.

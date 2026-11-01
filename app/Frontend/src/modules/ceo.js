/**
 * HERA CLOUD POS - CEO Super Admin Dashboard (ES6)
 * Gestión centralizada de inquilinos/restaurantes, switches de 8 módulos en tiempo real,
 * reglas tributarias (Impoconsumo/Propina), presets rápidos y KPIs globales.
 */

import { state, initOfflineDb, saveOfflineDb } from '../state.js';
import { apiFetch } from '../api.js';
import { formatCOP, showToast, openModal, closeModal, escapeHtml } from '../utils.js';
import { routeToRoleScreen } from './auth.js';

let cachedTenants = [];
let impersonateCallback = null;

export function setupCeoDashboard({ onImpersonateTenant } = {}) {
  impersonateCallback = onImpersonateTenant || null;
  const btnRefresh = document.getElementById('btn-ceo-refresh');
  const btnNewTenant = document.getElementById('btn-ceo-new-tenant');
  const searchInput = document.getElementById('ceo-search-input');
  const filterType = document.getElementById('ceo-filter-type');
  const formTenant = document.getElementById('form-tenant-manage');
  const formTypeSelect = document.getElementById('tenant-form-type');

  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => loadCeoData());
  }

  if (btnNewTenant) {
    btnNewTenant.addEventListener('click', () => openCreateTenantModal());
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => filterAndRenderTenants());
  }

  if (filterType) {
    filterType.addEventListener('change', () => filterAndRenderTenants());
  }

  if (formTypeSelect) {
    formTypeSelect.addEventListener('change', () => {
      const idInput = document.getElementById('tenant-form-id');
      if (!idInput || !idInput.value) {
        applyFormTypeDefaults(formTypeSelect.value);
      }
    });
  }

  if (formTenant) {
    formTenant.addEventListener('submit', (e) => {
      e.preventDefault();
      handleSaveTenantForm();
    });
  }
}

export async function loadCeoData() {
  const grid = document.getElementById('ceo-tenants-grid');
  if (grid) {
    grid.innerHTML = `
      <div class="col-span-full p-12 text-center text-slate-400 dark:text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
        Cargando restaurantes registrados...
      </div>
    `;
  }

  try {
    const res = await apiFetch('/api/ceo/tenants');
    if (res.ok) {
      const data = await res.json();
      cachedTenants = Array.isArray(data) ? data : (data.tenants || []);
      if (data && data.kpis) {
        renderCeoKpis(data.kpis);
      } else {
        computeAndRenderOfflineKpis(cachedTenants);
      }
      filterAndRenderTenants();
      return;
    }
  } catch (_) {
    // Modo Offline / Fallback
  }

  // Fallback con datos locales
  const db = initOfflineDb();
  cachedTenants = db.tenants || [];
  computeAndRenderOfflineKpis(cachedTenants);
  filterAndRenderTenants();
}

function renderCeoKpis(kpis = {}) {
  const elTotal = document.getElementById('ceo-kpi-total-tenants');
  const elActive = document.getElementById('ceo-kpi-active-tenants');
  const elSales = document.getElementById('ceo-kpi-total-sales');
  const elRev = document.getElementById('ceo-kpi-total-revenue');

  if (elTotal) elTotal.textContent = kpis.totalTenants ?? cachedTenants.length;
  if (elActive) elActive.textContent = kpis.activeTenants ?? cachedTenants.filter(t => t.isActive).length;
  if (elSales) elSales.textContent = kpis.totalSalesCount ?? 0;
  if (elRev) elRev.textContent = formatCOP(kpis.totalRevenueCOP ?? 0);
}

function computeAndRenderOfflineKpis(tenants) {
  const total = tenants.length;
  const active = tenants.filter(t => t.isActive).length;
  const totalSales = tenants.reduce((acc, t) => acc + (t.salesCount || 0), 0);
  const totalRev = tenants.reduce((acc, t) => acc + (t.totalSalesCOP || 0), 0);
  renderCeoKpis({
    totalTenants: total,
    activeTenants: active,
    totalSalesCount: totalSales,
    totalRevenueCOP: totalRev
  });
}

function filterAndRenderTenants() {
  const query = (document.getElementById('ceo-search-input')?.value || '').toLowerCase().trim();
  const typeFilter = document.getElementById('ceo-filter-type')?.value || 'ALL';

  const filtered = cachedTenants.filter(t => {
    const matchQuery = !query ||
      (t.name || '').toLowerCase().includes(query) ||
      (t.nit || '').toLowerCase().includes(query) ||
      (t.address || '').toLowerCase().includes(query);
    
    const matchType = typeFilter === 'ALL' || t.businessType === typeFilter;
    return matchQuery && matchType;
  });

  renderTenantsGrid(filtered);
}

function renderTenantsGrid(tenants) {
  const grid = document.getElementById('ceo-tenants-grid');
  if (!grid) return;

  if (tenants.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full p-12 text-center text-slate-400 dark:text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
        No se encontraron restaurantes que coincidan con la búsqueda.
      </div>
    `;
    return;
  }

  const moduleDefinitions = [
    { key: 'express_pos', label: '⚡ Cobro Rápido' },
    { key: 'sales', label: '📊 Ventas' },
    { key: 'catalog', label: '📦 Menú' },
    { key: 'tables', label: '🗺️ Mesas' },
    { key: 'pos', label: '📝 Comandas' },
    { key: 'kds', label: '👨‍🍳 KDS Cocina' },
    { key: 'billing', label: '🧾 Facturar Mesa' },
    { key: 'shifts', label: '🔒 Cierre Turno' }
  ];

  grid.innerHTML = tenants.map(t => {
    const isExpress = t.businessType === 'EXPRESS_COUNTER';
    const isActive = t.isActive !== false;
    const modules = t.enabledModules || {};
    const tax = t.taxConfig || {};

    const moduleToggles = moduleDefinitions.map(m => {
      const checked = Boolean(modules[m.key]) ? 'checked' : '';
      return `
        <label class="flex items-center justify-between p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 cursor-pointer text-xs">
          <span class="font-medium text-slate-700 dark:text-slate-300">${m.label}</span>
          <input type="checkbox" class="ceo-mod-toggle rounded text-purple-600 focus:ring-purple-500" data-tenant-id="${t.id}" data-mod-key="${m.key}" ${checked}>
        </label>
      `;
    }).join('');

    return `
      <div class="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4 hover:shadow-md transition">
        <!-- Encabezado de la Tarjeta -->
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="text-base font-bold font-display text-slate-900 dark:text-white truncate">${escapeHtml(t.name)}</h3>
              <span class="px-2 py-0.5 text-[10px] font-bold rounded-full ${isActive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400' : 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400'}">
                ${isActive ? 'Activo' : 'Suspendido'}
              </span>
            </div>
            <p class="text-xs text-slate-500 font-mono mt-0.5">${escapeHtml(t.nit || 'Sin NIT')}</p>
            <p class="text-xs text-slate-400 truncate mt-0.5">${escapeHtml(t.address || 'Sin dirección')}</p>
            <p class="text-xs text-purple-600 dark:text-purple-400 font-mono mt-0.5 truncate">👤 ${escapeHtml(t.adminEmail || 'Sin usuario asignado')}</p>
          </div>

          <div class="flex items-center gap-1.5 flex-shrink-0">
            <button type="button" class="btn-toggle-active-tenant p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs" data-tenant-id="${t.id}" title="${isActive ? 'Suspender Restaurante' : 'Activar Restaurante'}">
              ${isActive ? '⏸️' : '▶️'}
            </button>
            <button type="button" class="btn-edit-tenant p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs" data-tenant-id="${t.id}" title="Editar Restaurante">
              ✏️
            </button>
            <button type="button" class="btn-delete-tenant p-1.5 rounded-xl border border-red-200 dark:border-red-900/60 hover:bg-red-50 dark:hover:bg-red-950/40 text-red-600 dark:text-red-400 text-xs" data-tenant-id="${t.id}" title="Eliminar Restaurante">
              🗑️
            </button>
            <button type="button" class="btn-impersonate p-1.5 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 hover:bg-purple-100 text-xs font-bold" data-tenant-id="${t.id}" title="Acceder como Restaurante">
              Entrar ➔
            </button>
          </div>
        </div>

        <!-- Botones de Preset Rápido (1 Clic) -->
        <div class="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2">
          <span class="text-[10px] uppercase font-bold text-slate-400">Presets:</span>
          <button type="button" class="btn-preset-express px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 transition" data-tenant-id="${t.id}">
            ⚡ Solo Cobro
          </button>
          <button type="button" class="btn-preset-restaurant px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 transition" data-tenant-id="${t.id}">
            🍽️ Restaurante
          </button>
        </div>

        <!-- Módulos Habilitados (8 Switches) -->
        <div class="space-y-1.5">
          <span class="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Módulos Dinámicos</span>
          <div class="grid grid-cols-2 gap-2">
            ${moduleToggles}
          </div>
        </div>

        <!-- Reglas Tributarias (2 Toggles) -->
        <div class="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
          <span class="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Reglas Tributarias</span>
          <div class="grid grid-cols-2 gap-2">
            <label class="flex items-center justify-between p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 cursor-pointer text-xs">
              <span class="font-medium text-slate-700 dark:text-slate-300">Impoconsumo (8%)</span>
              <input type="checkbox" class="ceo-tax-toggle rounded text-purple-600 focus:ring-purple-500" data-tenant-id="${t.id}" data-tax-key="applyImpoconsumo" ${tax.applyImpoconsumo ?? tax.impoconsumo ? 'checked' : ''}>
            </label>
            <label class="flex items-center justify-between p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 cursor-pointer text-xs">
              <span class="font-medium text-slate-700 dark:text-slate-300">Propina (10%)</span>
              <input type="checkbox" class="ceo-tax-toggle rounded text-purple-600 focus:ring-purple-500" data-tenant-id="${t.id}" data-tax-key="applyTip" ${tax.applyTip ?? tax.suggestedTip ? 'checked' : ''}>
            </label>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Vincular eventos de switches de módulos
  grid.querySelectorAll('.ceo-mod-toggle').forEach(chk => {
    chk.addEventListener('change', async (e) => {
      const tenantId = chk.dataset.tenantId;
      const modKey = chk.dataset.modKey;
      const isEnabled = chk.checked;
      await updateTenantModuleState(tenantId, modKey, isEnabled);
    });
  });

  // Vincular eventos de switches tributarios
  grid.querySelectorAll('.ceo-tax-toggle').forEach(chk => {
    chk.addEventListener('change', async (e) => {
      const tenantId = chk.dataset.tenantId;
      const taxKey = chk.dataset.taxKey;
      const isEnabled = chk.checked;
      await updateTenantTaxState(tenantId, taxKey, isEnabled);
    });
  });

  // Vincular botón activar / suspender
  grid.querySelectorAll('.btn-toggle-active-tenant').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tenantId = btn.dataset.tenantId;
      const t = cachedTenants.find(x => x.id === tenantId);
      if (t) {
        const nextState = !(t.isActive !== false);
        await updateTenantActiveState(tenantId, nextState);
      }
    });
  });

  // Vincular botón eliminar
  grid.querySelectorAll('.btn-delete-tenant').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tenantId = btn.dataset.tenantId;
      await deleteTenant(tenantId);
    });
  });

  // Vincular presets rápidos
  grid.querySelectorAll('.btn-preset-express').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tenantId = btn.dataset.tenantId;
      await applyPreset(tenantId, 'EXPRESS');
    });
  });

  grid.querySelectorAll('.btn-preset-restaurant').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tenantId = btn.dataset.tenantId;
      await applyPreset(tenantId, 'RESTAURANT');
    });
  });

  // Vincular botón editar
  grid.querySelectorAll('.btn-edit-tenant').forEach(btn => {
    btn.addEventListener('click', () => {
      const tenantId = btn.dataset.tenantId;
      const t = cachedTenants.find(x => x.id === tenantId);
      if (t) openEditTenantModal(t);
    });
  });

  // Vincular botón de acceso directo (Impersonate)
  grid.querySelectorAll('.btn-impersonate').forEach(btn => {
    btn.addEventListener('click', () => {
      const tenantId = btn.dataset.tenantId;
      const t = cachedTenants.find(x => x.id === tenantId);
      if (t) {
        if (typeof impersonateCallback === 'function') {
          impersonateCallback(t);
        } else {
          state.currentTenant = t;
          routeToRoleScreen(state.currentUser, t, { impersonate: true });
          showToast(`Operando en: ${t.name}`, 'info');
        }
      }
    });
  });
}

async function updateTenantModuleState(tenantId, modKey, isEnabled) {
  const tenant = cachedTenants.find(t => t.id === tenantId);
  if (!tenant) return;

  const currentModules = { ...(tenant.enabledModules || {}) };
  currentModules[modKey] = isEnabled;

  try {
    const res = await apiFetch(`/api/ceo/tenants/${tenantId}/modules`, {
      method: 'PATCH',
      body: { enabledModules: currentModules }
    });

    if (res.ok) {
      tenant.enabledModules = currentModules;
      showToast(`Módulo '${modKey}' actualizado`, 'success');
      return;
    }
  } catch (_) {}

  // Fallback local
  tenant.enabledModules = currentModules;
  const db = initOfflineDb();
  const dbT = (db.tenants || []).find(t => t.id === tenantId);
  if (dbT) dbT.enabledModules = currentModules;
  saveOfflineDb(db);
  showToast(`Módulo guardado localmente`, 'info');
}

async function updateTenantTaxState(tenantId, taxKey, isEnabled) {
  const tenant = cachedTenants.find(t => t.id === tenantId);
  if (!tenant) return;

  const currentTax = { ...(tenant.taxConfig || {}) };
  currentTax[taxKey] = isEnabled;
  if (taxKey === 'applyImpoconsumo') currentTax.impoconsumo = isEnabled;
  if (taxKey === 'impoconsumo') currentTax.applyImpoconsumo = isEnabled;
  if (taxKey === 'applyTip') currentTax.suggestedTip = isEnabled;
  if (taxKey === 'suggestedTip') currentTax.applyTip = isEnabled;

  try {
    const res = await apiFetch(`/api/ceo/tenants/${tenantId}`, {
      method: 'PATCH',
      body: { taxConfig: currentTax }
    });

    if (res.ok) {
      tenant.taxConfig = currentTax;
      showToast('Regla fiscal actualizada', 'success');
      return;
    }
  } catch (_) {}

  // Fallback local
  tenant.taxConfig = currentTax;
  const db = initOfflineDb();
  const dbT = (db.tenants || []).find(t => t.id === tenantId);
  if (dbT) dbT.taxConfig = currentTax;
  saveOfflineDb(db);
  showToast('Regla fiscal guardada localmente', 'info');
}

async function applyPreset(tenantId, type) {
  const isExpress = type === 'EXPRESS';
  const targetModules = {
    express_pos: true,
    sales: true,
    catalog: true,
    tables: !isExpress,
    pos: !isExpress,
    kds: !isExpress,
    billing: !isExpress,
    shifts: !isExpress
  };

  const tenant = cachedTenants.find(t => t.id === tenantId);
  if (!tenant) return;

  try {
    await apiFetch(`/api/ceo/tenants/${tenantId}/modules`, {
      method: 'PATCH',
      body: { enabledModules: targetModules }
    });
    await apiFetch(`/api/ceo/tenants/${tenantId}`, {
      method: 'PATCH',
      body: { businessType: isExpress ? 'EXPRESS_COUNTER' : 'RESTAURANT' }
    });
  } catch (_) {}

  tenant.enabledModules = targetModules;
  tenant.businessType = isExpress ? 'EXPRESS_COUNTER' : 'RESTAURANT';

  const db = initOfflineDb();
  const dbT = (db.tenants || []).find(t => t.id === tenantId);
  if (dbT) {
    dbT.enabledModules = targetModules;
    dbT.businessType = tenant.businessType;
  }
  saveOfflineDb(db);

  filterAndRenderTenants();
  showToast(`Preset '${isExpress ? 'Solo Cobro' : 'Restaurante'}' aplicado`, 'success');
}

async function updateTenantActiveState(tenantId, isActive) {
  const tenant = cachedTenants.find(t => t.id === tenantId);
  if (!tenant) return;

  try {
    const res = await apiFetch(`/api/ceo/tenants/${tenantId}`, {
      method: 'PATCH',
      body: { isActive }
    });

    if (res.ok) {
      tenant.isActive = isActive;
      showToast(`Restaurante ${isActive ? 'activado' : 'suspendido'} exitosamente`, 'success');
      filterAndRenderTenants();
      return;
    }
  } catch (_) {}

  // Fallback local
  tenant.isActive = isActive;
  const db = initOfflineDb();
  const dbT = (db.tenants || []).find(t => t.id === tenantId);
  if (dbT) dbT.isActive = isActive;
  saveOfflineDb(db);
  filterAndRenderTenants();
  showToast(`Estado guardado localmente (${isActive ? 'Activo' : 'Suspendido'})`, 'info');
}

async function deleteTenant(tenantId) {
  const tenant = cachedTenants.find(t => t.id === tenantId);
  if (!tenant) return;

  const confirmed = window.confirm(`¿Estás seguro de eliminar permanentemente el restaurante "${tenant.name}" y toda su información asociada (mesas, catálogo, sesiones y facturas)? Esta acción no se puede deshacer.`);
  if (!confirmed) return;

  try {
    const res = await apiFetch(`/api/ceo/tenants/${tenantId}`, {
      method: 'DELETE'
    });

    if (res.ok) {
      showToast(`Restaurante "${tenant.name}" eliminado correctamente`, 'success');
      await loadCeoData();
      return;
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'Error al eliminar restaurante', 'alert');
      return;
    }
  } catch (_) {}

  // Fallback local
  const db = initOfflineDb();
  db.tenants = (db.tenants || []).filter(t => t.id !== tenantId);
  saveOfflineDb(db);
  showToast(`Restaurante eliminado localmente`, 'info');
  await loadCeoData();
}

function applyFormTypeDefaults(type) {
  const isExpress = type === 'EXPRESS_COUNTER';
  const taxImp = document.getElementById('tenant-tax-impoconsumo');
  const taxTip = document.getElementById('tenant-tax-tip');

  if (isExpress) {
    if (taxImp) taxImp.checked = false;
    if (taxTip) taxTip.checked = false;
  } else {
    if (taxImp) taxImp.checked = true;
    if (taxTip) taxTip.checked = true;
  }

  const moduleMap = {
    express_pos: true,
    sales: true,
    catalog: true,
    tables: !isExpress,
    pos: !isExpress,
    kds: !isExpress,
    billing: !isExpress,
    shifts: !isExpress
  };

  document.querySelectorAll('[data-tenant-mod]').forEach(chk => {
    const key = chk.dataset.tenantMod;
    if (key in moduleMap) {
      chk.checked = moduleMap[key];
    }
  });
}

function openCreateTenantModal() {
  const form = document.getElementById('form-tenant-manage');
  if (form) form.reset();
  const idInput = document.getElementById('tenant-form-id');
  if (idInput) idInput.value = '';

  const adminName = document.getElementById('tenant-admin-name');
  const adminEmail = document.getElementById('tenant-admin-email');
  const adminPassword = document.getElementById('tenant-admin-password');
  if (adminName) adminName.value = '';
  if (adminEmail) adminEmail.value = '';
  if (adminPassword) adminPassword.value = '';

  const typeSelect = document.getElementById('tenant-form-type');
  const selectedType = typeSelect?.value || 'RESTAURANT';
  applyFormTypeDefaults(selectedType);

  openModal('modal-tenant-form');
}

function openEditTenantModal(tenant) {
  const idInput = document.getElementById('tenant-form-id');
  const nameInput = document.getElementById('tenant-form-name');
  const nitInput = document.getElementById('tenant-form-nit');
  const addressInput = document.getElementById('tenant-form-address');
  const typeSelect = document.getElementById('tenant-form-type');
  const taxImp = document.getElementById('tenant-tax-impoconsumo');
  const taxTip = document.getElementById('tenant-tax-tip');

  const adminName = document.getElementById('tenant-admin-name');
  const adminEmail = document.getElementById('tenant-admin-email');
  const adminPassword = document.getElementById('tenant-admin-password');

  if (idInput) idInput.value = tenant.id || '';
  if (nameInput) nameInput.value = tenant.name || '';
  if (nitInput) nitInput.value = tenant.nit || '';
  if (addressInput) addressInput.value = tenant.address || '';
  if (typeSelect) typeSelect.value = tenant.businessType || 'RESTAURANT';

  if (adminName) adminName.value = tenant.adminName || '';
  if (adminEmail) adminEmail.value = tenant.adminEmail || '';
  if (adminPassword) adminPassword.value = '';

  const tax = tenant.taxConfig || {};
  if (taxImp) taxImp.checked = Boolean(tax.applyImpoconsumo ?? tax.impoconsumo ?? true);
  if (taxTip) taxTip.checked = Boolean(tax.applyTip ?? tax.suggestedTip ?? true);

  const modules = tenant.enabledModules || {};
  document.querySelectorAll('[data-tenant-mod]').forEach(chk => {
    const key = chk.dataset.tenantMod;
    chk.checked = Boolean(modules[key]);
  });

  openModal('modal-tenant-form');
}

async function handleSaveTenantForm() {
  const id = document.getElementById('tenant-form-id')?.value;
  const name = document.getElementById('tenant-form-name')?.value.trim();
  const nit = document.getElementById('tenant-form-nit')?.value.trim();
  const address = document.getElementById('tenant-form-address')?.value.trim();
  const businessType = document.getElementById('tenant-form-type')?.value;
  const adminName = document.getElementById('tenant-admin-name')?.value.trim();
  const adminEmail = document.getElementById('tenant-admin-email')?.value.trim();
  const adminPassword = document.getElementById('tenant-admin-password')?.value;

  const impoconsumo = Boolean(document.getElementById('tenant-tax-impoconsumo')?.checked);
  const suggestedTip = Boolean(document.getElementById('tenant-tax-tip')?.checked);

  if (!name) {
    showToast('El nombre del restaurante es obligatorio', 'alert');
    return;
  }

  if (!id && (!adminEmail || !adminPassword)) {
    showToast('Email y contraseña de administrador son obligatorios para crear el restaurante', 'alert');
    return;
  }

  const enabledModules = {};
  document.querySelectorAll('[data-tenant-mod]').forEach(chk => {
    enabledModules[chk.dataset.tenantMod] = chk.checked;
  });

  const taxConfig = {
    applyImpoconsumo: impoconsumo,
    impoconsumo: impoconsumo,
    applyTip: suggestedTip,
    suggestedTip: suggestedTip
  };

  const payload = {
    name,
    nit,
    address,
    businessType,
    taxConfig,
    enabledModules
  };

  try {
    if (id) {
      // Edición
      const res = await apiFetch(`/api/ceo/tenants/${id}`, {
        method: 'PATCH',
        body: payload
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Error al actualizar restaurante', 'alert');
        return; // No guardar offline si el backend rechazó la petición
      }

      if (adminEmail || adminPassword || adminName) {
        const credRes = await apiFetch(`/api/ceo/tenants/${id}/credentials`, {
          method: 'PATCH',
          body: { adminName, adminEmail, adminPassword }
        });
        if (!credRes.ok) {
          const err = await credRes.json().catch(() => ({}));
          showToast(err.error || 'Error al actualizar credenciales de administrador', 'alert');
          return;
        }
      }

      closeModal('modal-tenant-form');
      showToast('Restaurante actualizado exitosamente', 'success');
      await loadCeoData();
      return;
    } else {
      // Creación
      const res = await apiFetch('/api/ceo/tenants', {
        method: 'POST',
        body: {
          ...payload,
          adminName,
          adminEmail,
          adminPassword
        }
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Error al crear restaurante', 'alert');
        return; // No guardar offline si el backend rechazó la petición
      }

      closeModal('modal-tenant-form');
      showToast('Restaurante creado exitosamente', 'success');
      await loadCeoData();
      return;
    }
  } catch (netErr) {
    // Modo offline ante fallo de conexión de red
    const db = initOfflineDb();
    if (id) {
      const idx = (db.tenants || []).findIndex(t => t.id === id);
      if (idx >= 0) {
        db.tenants[idx] = { ...db.tenants[idx], ...payload, adminName, adminEmail };
      }
    } else {
      const newT = {
        id: `tenant-${Date.now()}`,
        isActive: true,
        salesCount: 0,
        totalSalesCOP: 0,
        ...payload,
        adminName,
        adminEmail
      };
      db.tenants.push(newT);
    }
    saveOfflineDb(db);
    closeModal('modal-tenant-form');
    showToast('Restaurante guardado localmente (modo offline)', 'info');
    loadCeoData();
  }
}

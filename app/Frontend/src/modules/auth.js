/**
 * GHANIMA CLOUD POS - Authentication Module (ES6)
 * Login unificado SaaS CEO y Restaurantes, navegación modular dinámica y gestión de sesión.
 */

import { state, saveAuthSession, clearAuthSession, initOfflineDb, SEED_TENANTS } from '../state.js';
import { apiFetch } from '../api.js';
import { showToast, escapeHtml } from '../utils.js';

export function setupAuth({ onLoginSuccess, onLogout }) {
  const formLogin = document.getElementById('form-login');
  const btnSubmit = document.getElementById('btn-login-submit');
  const emailInput = document.getElementById('login-email');
  const passInput = document.getElementById('login-password');
  const alertBox = document.getElementById('login-error-alert');
  const alertText = alertBox ? alertBox.querySelector('.login-error-text') : null;

  // Botones de acceso rápido Demo
  const demoButtons = document.querySelectorAll('[data-demo-email]');
  demoButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const email = btn.dataset.demoEmail;
      const pass = btn.dataset.demoPass;
      if (emailInput) emailInput.value = email;
      if (passInput) passInput.value = pass;
      handleLogin(email, pass);
    });
  });

  if (formLogin) {
    formLogin.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = emailInput ? emailInput.value.trim() : '';
      const pass = passInput ? passInput.value : '';
      handleLogin(email, pass);
    });
  }

  // Botones de Salir / Logout
  const btnLogout = document.getElementById('btn-logout');
  const btnCeoLogout = document.getElementById('btn-ceo-logout');

  if (btnLogout) {
    btnLogout.addEventListener('click', () => logout(onLogout));
  }
  if (btnCeoLogout) {
    btnCeoLogout.addEventListener('click', () => logout(onLogout));
  }

  async function handleLogin(email, password) {
    if (!email || !password) {
      showLoginError('Por favor ingrese correo y contraseña.');
      return;
    }

    hideLoginError();
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = `<span>Validando...</span>`;
    }

    try {
      let data = null;
      try {
        const res = await apiFetch('/api/auth/login', {
          method: 'POST',
          body: { email, password }
        });

        if (res.ok) {
          data = await res.json();
        } else {
          const errRes = await res.json().catch(() => ({}));
          throw new Error(errRes.error || 'Credenciales inválidas');
        }
      } catch (networkOrAuthErr) {
        // Fallback Demo Offline si el backend no responde
        if (networkOrAuthErr.message !== 'Credenciales inválidas' && networkOrAuthErr.message !== 'Usuario o contraseña incorrectos') {
          const offlineDb = initOfflineDb();
          data = mockOfflineLogin(email, password, offlineDb);
          if (!data) throw networkOrAuthErr;
        } else {
          throw networkOrAuthErr;
        }
      }

      if (data && data.user) {
        saveAuthSession(data.token, data.user, data.tenant);
        showToast(`¡Bienvenido, ${data.user.name}!`, 'success');
        hideLoginError();

        routeToRoleScreen(data.user, data.tenant);

        if (typeof onLoginSuccess === 'function') {
          onLoginSuccess(data.user, data.tenant);
        }
      }
    } catch (err) {
      showLoginError(err.message || 'Error al iniciar sesión');
      showToast(err.message || 'Credenciales incorrectas', 'alert');
    } finally {
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = `<span>Iniciar Sesión</span><span class="text-base">→</span>`;
      }
    }
  }

  function showLoginError(msg) {
    if (alertBox) {
      alertBox.classList.remove('hidden');
      if (alertText) alertText.textContent = msg;
    }
  }

  function hideLoginError() {
    if (alertBox) alertBox.classList.add('hidden');
  }
}

/**
 * Fallback de autenticación offline para modo local / demostración
 */
function mockOfflineLogin(email, password, offlineDb) {
  const normEmail = email.toLowerCase().trim();

  if (normEmail === 'ceo@ghanima.com' && password === 'ceo123') {
    return {
      token: 'mock-jwt-ceo',
      user: { id: 'usr-ceo', name: 'CEO Master', email: 'ceo@ghanima.com', role: 'SUPER_ADMIN', tenantId: null },
      tenant: null
    };
  }

  if (normEmail === 'caja@express.com' && password === 'caja123') {
    const tExpress = (offlineDb.tenants || []).find(t => t.id === 'tenant-express') || SEED_TENANTS[1];
    return {
      token: 'mock-jwt-caja',
      user: { id: 'usr-caja', name: 'Cajero Express', email: 'caja@express.com', role: 'ADMIN', tenantId: 'tenant-express' },
      tenant: tExpress
    };
  }

  if (normEmail === 'admin@ghanima.com' && password === 'admin123') {
    const tDefault = (offlineDb.tenants || []).find(t => t.id === 'tenant-default') || SEED_TENANTS[0];
    return {
      token: 'mock-jwt-admin',
      user: { id: 'usr-admin', name: 'Admin Ghanima', email: 'admin@ghanima.com', role: 'ADMIN', tenantId: 'tenant-default' },
      tenant: tDefault
    };
  }

  return null;
}

/**
 * Enruta la pantalla principal según el rol del usuario
 */
export function routeToRoleScreen(user, tenant, options = {}) {
  const btnBackToCeo = document.getElementById('btn-back-to-ceo');

  if (!user) {
    switchScreen('auth-screen');
    if (btnBackToCeo) {
      btnBackToCeo.classList.add('hidden');
      btnBackToCeo.classList.remove('flex');
    }
    return;
  }

  if (user.role === 'SUPER_ADMIN' && options.impersonate === true && tenant) {
    switchScreen('pos-app-screen');
    updateAppHeader(user, tenant);
    if (btnBackToCeo) {
      btnBackToCeo.classList.remove('hidden');
      btnBackToCeo.classList.add('flex');
    }
    if (tenant.enabledModules) {
      applyModularNavigation(tenant.enabledModules);
    }
    return;
  }

  if (user.role === 'SUPER_ADMIN') {
    switchScreen('ceo-screen');
    if (btnBackToCeo) {
      btnBackToCeo.classList.add('hidden');
      btnBackToCeo.classList.remove('flex');
    }
    const ceoNameEl = document.getElementById('ceo-user-name');
    if (ceoNameEl) ceoNameEl.textContent = user.name || 'CEO Master';
  } else {
    switchScreen('pos-app-screen');
    if (btnBackToCeo) {
      btnBackToCeo.classList.add('hidden');
      btnBackToCeo.classList.remove('flex');
    }
    updateAppHeader(user, tenant);
    if (tenant && tenant.enabledModules) {
      applyModularNavigation(tenant.enabledModules);
    }
  }
}

/**
 * Alterna entre las 3 macro-pantallas principales
 */
export function switchScreen(screenId) {
  state.activeScreen = screenId;
  const screens = ['auth-screen', 'ceo-screen', 'pos-app-screen'];

  screens.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (id === screenId) {
        el.classList.remove('hidden');
        el.classList.add('flex');
      } else {
        el.classList.remove('flex');
        el.classList.add('hidden');
      }
    }
  });
}

/**
 * Actualiza la información de usuario y restaurante en la cabecera operativa
 */
export function updateAppHeader(user, tenant) {
  const nameEl = document.getElementById('app-tenant-name');
  const badgeEl = document.getElementById('app-tenant-badge');
  const userNameEl = document.getElementById('current-user-name');
  const userAvatarEl = document.getElementById('current-user-avatar');

  if (tenant) {
    if (nameEl) nameEl.textContent = tenant.name || 'Restaurante';
    if (badgeEl) {
      const isExpress = tenant.businessType === 'EXPRESS_COUNTER';
      badgeEl.textContent = isExpress ? '⚡ Punto Express' : '🍽️ Restaurante Completo';
      badgeEl.className = isExpress
        ? 'px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 flex-shrink-0'
        : 'px-2 py-0.5 text-[10px] font-bold rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 flex-shrink-0';
    }
  }

  if (user) {
    if (userNameEl) userNameEl.textContent = user.name || 'Operador';
    if (userAvatarEl) {
      const initial = (user.name || 'O').charAt(0).toUpperCase();
      userAvatarEl.textContent = initial;
    }
  }
}

/**
 * Oculta o muestra dinámicamente los módulos según la suscripción del tenant
 */
export function applyModularNavigation(modules = {}) {
  const navButtons = document.querySelectorAll('#app-module-nav button[data-module]');
  let firstVisibleView = null;

  navButtons.forEach(btn => {
    const modKey = btn.dataset.module;
    const isEnabled = Boolean(modules[modKey]) === true;

    if (isEnabled) {
      btn.classList.remove('hidden');
      if (!firstVisibleView) {
        firstVisibleView = btn.dataset.view;
      }
    } else {
      btn.classList.add('hidden');
      // Ocultar también la sección si estaba activa
      const viewEl = document.getElementById(btn.dataset.view);
      if (viewEl) viewEl.classList.add('hidden');
    }
  });

  return firstVisibleView;
}

/**
 * Cierre de sesión y limpieza de estado
 */
export function logout(onLogout) {
  clearAuthSession();
  switchScreen('auth-screen');
  showToast('Sesión cerrada correctamente', 'info');

  if (typeof onLogout === 'function') {
    onLogout();
  }
}

/**
 * Comprobación inicial de token al cargar la SPA
 */
export async function checkAuthSession({ onSessionValid, onSessionInvalid }) {
  if (!state.token) {
    switchScreen('auth-screen');
    if (typeof onSessionInvalid === 'function') onSessionInvalid();
    return;
  }

  try {
    const res = await apiFetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      state.currentUser = data.user;
      state.currentTenant = data.tenant;
      saveAuthSession(state.token, data.user, data.tenant);
      routeToRoleScreen(data.user, data.tenant);
      if (typeof onSessionValid === 'function') {
        onSessionValid(data.user, data.tenant);
      }
    } else {
      throw new Error('Token expirado');
    }
  } catch (err) {
    // Si hay datos en memoria local, continuar offline
    if (state.currentUser) {
      routeToRoleScreen(state.currentUser, state.currentTenant);
      if (typeof onSessionValid === 'function') {
        onSessionValid(state.currentUser, state.currentTenant);
      }
    } else {
      logout(onSessionInvalid);
    }
  }
}

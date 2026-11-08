// Shared browser helpers. Loaded before the page-specific scripts.
// No inline JavaScript is used, because the Content-Security-Policy blocks it.

(function () {
  'use strict';

  // Cookie names must stay in sync with src/config.js.
  const CSRF_COOKIE_NAME = 'rbu_csrf';

  function readCookie(name) {
    const prefix = name + '=';
    const parts = document.cookie ? document.cookie.split('; ') : [];

    for (const part of parts) {
      if (part.indexOf(prefix) === 0) {
        return decodeURIComponent(part.slice(prefix.length));
      }
    }

    return '';
  }

  async function ensureCsrfToken() {
    const existing = readCookie(CSRF_COOKIE_NAME);
    if (existing) return existing;

    const response = await fetch('/api/auth/csrf', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
      throw new Error('Could not start a secure session.');
    }

    const data = await response.json();
    return data.csrfToken;
  }

  // Sends JSON and always returns { ok, status, data } instead of throwing.
  // That keeps the page scripts easy to read.
  async function apiRequest(url, options) {
    const settings = options || {};
    const method = (settings.method || 'GET').toUpperCase();
    const headers = Object.assign(
      { Accept: 'application/json' },
      settings.headers || {}
    );

    let body;
    if (settings.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(settings.body);
    }

    try {
      if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
        headers['X-CSRF-Token'] = await ensureCsrfToken();
      }

      const response = await fetch(url, {
        method,
        headers,
        body,
        credentials: 'same-origin'
      });

      let data = {};
      const text = await response.text();

      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { error: 'The server returned an unexpected response.' };
        }
      }

      return { ok: response.ok, status: response.status, data };
    } catch {
      return {
        ok: false,
        status: 0,
        data: {
          error:
            'Could not reach the server. Check your connection and try again.'
        }
      };
    }
  }

  function setAlert(element, message, type) {
    if (!element) return;

    element.className = message ? 'alert alert-' + (type || 'error') : 'alert';
    element.textContent = message || '';
  }

  function setBusy(button, isBusy, busyText) {
    if (!button) return;

    if (isBusy) {
      button.dataset.originalText = button.textContent;
      button.textContent = busyText || 'Please wait...';
    } else if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }

    button.disabled = isBusy;
    button.setAttribute('aria-busy', isBusy ? 'true' : 'false');
  }

  window.RbuApi = {
    readCookie,
    ensureCsrfToken,
    apiRequest,
    setAlert,
    setBusy
  };
})();

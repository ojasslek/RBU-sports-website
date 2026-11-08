// Login page behaviour.

(function () {
  'use strict';

  const api = window.RbuApi;

  const form = document.getElementById('loginForm');
  const alertBox = document.getElementById('formAlert');
  const submitButton = document.getElementById('loginSubmit');
  const passwordInput = document.getElementById('password');
  const toggleButton = document.getElementById('togglePassword');

  // If the visitor already has a valid session, skip the login form.
  api.apiRequest('/api/auth/me').then((result) => {
    if (result.ok) {
      window.location.replace('/dashboard.html');
    }
  });

  if (toggleButton && passwordInput) {
    toggleButton.addEventListener('click', () => {
      const isPassword = passwordInput.type === 'password';

      passwordInput.type = isPassword ? 'text' : 'password';
      toggleButton.textContent = isPassword ? 'Hide' : 'Show';
      toggleButton.setAttribute('aria-pressed', isPassword ? 'true' : 'false');
      toggleButton.setAttribute(
        'aria-label',
        isPassword ? 'Hide password' : 'Show password'
      );
    });
  }

  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    api.setAlert(alertBox, '');

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    api.setBusy(submitButton, true, 'Logging in...');

    const result = await api.apiRequest('/api/auth/login', {
      method: 'POST',
      body: {
        collegeId: document.getElementById('collegeId').value,
        password: document.getElementById('password').value
      }
    });

    api.setBusy(submitButton, false);

    if (result.ok) {
      window.location.replace('/dashboard.html');
      return;
    }

    api.setAlert(
      alertBox,
      result.data.error || 'Could not log in. Please try again.',
      'error'
    );
  });
})();

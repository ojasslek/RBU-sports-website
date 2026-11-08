// Registration page behaviour.
// The server checks the approved college ID list and sends the OTP email.

(function () {
  'use strict';

  const api = window.RbuApi;

  const form = document.getElementById('registerForm');
  const alertBox = document.getElementById('formAlert');
  const submitButton = document.getElementById('registerSubmit');
  const passwordInput = document.getElementById('password');
  const confirmInput = document.getElementById('confirmPassword');
  const toggleButton = document.getElementById('togglePassword');

  function rememberPendingRegistration(collegeId, emailHint) {
    try {
      window.sessionStorage.setItem('rbuPendingCollegeId', collegeId);
      window.sessionStorage.setItem('rbuPendingEmailHint', emailHint || '');
    } catch {
      // Private browsing can block storage. The verify page then asks for the
      // college ID again, which still works.
    }
  }

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

    if (passwordInput.value !== confirmInput.value) {
      api.setAlert(alertBox, 'The two passwords do not match.', 'error');
      confirmInput.focus();
      return;
    }

    const collegeId = document.getElementById('collegeId').value;

    api.setBusy(submitButton, true, 'Creating account...');

    const result = await api.apiRequest('/api/auth/register', {
      method: 'POST',
      body: {
        collegeId,
        password: passwordInput.value
      }
    });

    api.setBusy(submitButton, false);

    if (result.ok) {
      rememberPendingRegistration(result.data.collegeId, result.data.emailHint);
      window.location.replace('/verify.html');
      return;
    }

    // If a previous registration is still pending, send the student to the
    // verification page instead of making them start over.
    if (result.data.code === 'PENDING_VERIFICATION') {
      rememberPendingRegistration(collegeId.toUpperCase(), '');
      window.location.replace('/verify.html');
      return;
    }

    api.setAlert(
      alertBox,
      result.data.error || 'Could not create the account. Please try again.',
      'error'
    );
  });
})();

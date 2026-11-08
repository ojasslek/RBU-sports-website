// Email verification (OTP) page behaviour.

(function () {
  'use strict';

  const api = window.RbuApi;

  const form = document.getElementById('verifyForm');
  const alertBox = document.getElementById('formAlert');
  const submitButton = document.getElementById('verifySubmit');
  const resendButton = document.getElementById('resendButton');
  const collegeIdInput = document.getElementById('collegeId');
  const otpInput = document.getElementById('otp');
  const emailHint = document.getElementById('emailHint');

  let cooldownTimer = null;
  let secondsLeft = 0;

  function readPendingValue(key) {
    try {
      return window.sessionStorage.getItem(key) || '';
    } catch {
      return '';
    }
  }

  function clearPendingValues() {
    try {
      window.sessionStorage.removeItem('rbuPendingCollegeId');
      window.sessionStorage.removeItem('rbuPendingEmailHint');
    } catch {
      // Ignore storage errors.
    }
  }

  const pendingCollegeId = readPendingValue('rbuPendingCollegeId');
  const pendingEmailHint = readPendingValue('rbuPendingEmailHint');

  if (pendingCollegeId) {
    collegeIdInput.value = pendingCollegeId;
  }

  if (pendingEmailHint) {
    emailHint.textContent = 'Code sent to ' + pendingEmailHint + '.';
  }

  if (otpInput) {
    otpInput.addEventListener('input', () => {
      otpInput.value = otpInput.value.replace(/\D/g, '').slice(0, 6);
    });
  }

  function updateResendButton() {
    if (secondsLeft > 0) {
      resendButton.disabled = true;
      resendButton.textContent = 'Resend code (' + secondsLeft + 's)';
      return;
    }

    resendButton.disabled = false;
    resendButton.textContent = 'Resend code';
  }

  function startCooldown(seconds) {
    if (cooldownTimer) {
      window.clearInterval(cooldownTimer);
    }

    secondsLeft = seconds;
    updateResendButton();

    cooldownTimer = window.setInterval(() => {
      secondsLeft -= 1;

      if (secondsLeft <= 0) {
        window.clearInterval(cooldownTimer);
        cooldownTimer = null;
        secondsLeft = 0;
      }

      updateResendButton();
    }, 1000);
  }

  if (resendButton) {
    resendButton.addEventListener('click', async () => {
      api.setAlert(alertBox, '');

      const collegeId = collegeIdInput.value.trim();

      if (!collegeId) {
        api.setAlert(alertBox, 'Enter your college ID first.', 'error');
        collegeIdInput.focus();
        return;
      }

      resendButton.disabled = true;
      resendButton.textContent = 'Sending...';

      const result = await api.apiRequest('/api/auth/resend-otp', {
        method: 'POST',
        body: { collegeId }
      });

      if (result.ok) {
        api.setAlert(alertBox, result.data.message, 'success');
        startCooldown(60);
      } else {
        updateResendButton();
        api.setAlert(
          alertBox,
          result.data.error || 'Could not send a new code. Please try again.',
          'error'
        );
      }
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

    api.setBusy(submitButton, true, 'Verifying...');

    const result = await api.apiRequest('/api/auth/verify-otp', {
      method: 'POST',
      body: {
        collegeId: collegeIdInput.value,
        otp: otpInput.value
      }
    });

    api.setBusy(submitButton, false);

    if (result.ok) {
      clearPendingValues();
      window.location.replace('/dashboard.html');
      return;
    }

    api.setAlert(
      alertBox,
      result.data.error || 'Could not verify the code. Please try again.',
      'error'
    );
  });
})();

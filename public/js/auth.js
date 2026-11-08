// public/js/auth.js
// --------------------------------------------------
// Client-side authentication logic for Login, Register & OTP.
// Supports @rbunagpur.in email verification and password setting.
// --------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  // Helper: Display Alert Message Safely (XSS-safe)
  function showAlert(elementId, message, type = 'error') {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = message;
    el.className = `alert alert-${type}`;
  }

  function clearAlert(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = '';
    el.className = 'alert';
  }

  // Helper: Password Visibility Toggle
  function setupPasswordToggle(btnId, inputId) {
    const btn = document.getElementById(btnId);
    const input = document.getElementById(inputId);
    if (!btn || !input) return;

    btn.addEventListener('click', () => {
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      btn.textContent = isPassword ? 'Hide' : 'Show';
    });
  }

  setupPasswordToggle('togglePasswordBtn', 'password');
  setupPasswordToggle('toggleNewPasswordBtn', 'newPassword');

  // ==================================================
  // 1. LOGIN HANDLER (index.html)
  // ==================================================
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    const loginBtn = document.getElementById('loginBtn');
    const identifierInput = document.getElementById('collegeId');
    const passwordInput = document.getElementById('password');

    identifierInput?.focus();

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAlert('loginAlert');

      const identifier = identifierInput.value.trim();
      const password = passwordInput.value;

      if (!identifier || !password) {
        showAlert('loginAlert', 'Please enter your email or College ID and password.');
        return;
      }

      loginBtn.disabled = true;
      loginBtn.textContent = 'Logging in...';

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier, password }),
        });

        const data = await res.json();

        if (!res.ok) {
          if (data.unverified) {
            sessionStorage.setItem('pending_email', data.email);
            window.location.href = `/register.html?step=2&email=${encodeURIComponent(data.email)}`;
            return;
          }
          showAlert('loginAlert', data.error || 'Failed to log in.');
          return;
        }

        // Redirect to booking dashboard
        window.location.href = '/bookings.html';
      } catch (err) {
        showAlert('loginAlert', 'Network error. Please check your internet connection.');
      } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Log in';
      }
    });
  }

  // ==================================================
  // 2. REGISTRATION 2-STEP HANDLER (register.html)
  // ==================================================
  const step1Form = document.getElementById('step1Form');
  const step2Form = document.getElementById('step2Form');
  const step1Section = document.getElementById('step1Section');
  const step2Section = document.getElementById('step2Section');

  function showStep2(email, name = '') {
    if (!step1Section || !step2Section) return;
    step1Section.classList.add('hidden');
    step2Section.classList.remove('hidden');

    const verifiedEmailInput = document.getElementById('verifiedEmail');
    const step2Subtitle = document.getElementById('step2Subtitle');
    const otpCodeInput = document.getElementById('otpCode');

    if (verifiedEmailInput) verifiedEmailInput.value = email;
    if (step2Subtitle) {
      step2Subtitle.textContent = `A 6-digit verification code was sent to ${email}.`;
    }
    otpCodeInput?.focus();
  }

  function showStep1() {
    if (!step1Section || !step2Section) return;
    step2Section.classList.add('hidden');
    step1Section.classList.remove('hidden');
    clearAlert('step1Alert');
    clearAlert('step2Alert');
  }

  // Handle URL redirect (if redirected from login for unverified account)
  const urlParams = new URLSearchParams(window.location.search);
  const pendingEmail = urlParams.get('email') || sessionStorage.getItem('pending_email');
  if (pendingEmail && step2Section) {
    showStep2(pendingEmail);
    showAlert('step2Alert', 'Please enter your verification code and set your password.', 'warning');
  }

  document.getElementById('backToStep1Btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    showStep1();
  });

  // STEP 1: Submit Email for Verification Code
  if (step1Form) {
    const sendCodeBtn = document.getElementById('sendCodeBtn');
    const regEmail = document.getElementById('regEmail');
    const regName = document.getElementById('regName');

    step1Form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAlert('step1Alert');

      const email = regEmail.value.trim().toLowerCase();
      const name = regName.value.trim();

      if (!email) {
        showAlert('step1Alert', 'Please enter your college email address.');
        return;
      }

      if (!email.endsWith('@rbunagpur.in')) {
        showAlert('step1Alert', 'Your email must end in @rbunagpur.in');
        return;
      }

      sendCodeBtn.disabled = true;
      sendCodeBtn.textContent = 'Sending code...';

      try {
        const res = await fetch('/api/auth/register-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, name }),
        });

        const data = await res.json();

        if (!res.ok) {
          showAlert('step1Alert', data.error || 'Failed to send verification code.');
          return;
        }

        showStep2(data.email, name);
        showAlert('step2Alert', data.message, 'success');
      } catch (err) {
        showAlert('step1Alert', 'Network error. Please try again.');
      } finally {
        sendCodeBtn.disabled = false;
        sendCodeBtn.textContent = 'Get Verification Code';
      }
    });
  }

  // STEP 2: Verify OTP and Set Password
  if (step2Form) {
    const completeRegBtn = document.getElementById('completeRegBtn');
    const resendCodeBtn = document.getElementById('resendCodeBtn');
    const otpCodeInput = document.getElementById('otpCode');
    const newPasswordInput = document.getElementById('newPassword');
    const confirmPasswordInput = document.getElementById('confirmPassword');
    const verifiedEmailInput = document.getElementById('verifiedEmail');

    step2Form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAlert('step2Alert');

      const email = verifiedEmailInput.value.trim();
      const otp = otpCodeInput.value.trim();
      const password = newPasswordInput.value;
      const confirmPassword = confirmPasswordInput.value;

      if (!otp || otp.length !== 6) {
        showAlert('step2Alert', 'Please enter the 6-digit verification code.');
        return;
      }

      if (password.length < 8) {
        showAlert('step2Alert', 'Password must be at least 8 characters long.');
        return;
      }

      if (password !== confirmPassword) {
        showAlert('step2Alert', 'Passwords do not match. Please re-enter.');
        return;
      }

      completeRegBtn.disabled = true;
      completeRegBtn.textContent = 'Creating account...';

      try {
        const res = await fetch('/api/auth/register-verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, otp, password }),
        });

        const data = await res.json();

        if (!res.ok) {
          showAlert('step2Alert', data.error || 'Failed to activate account.');
          return;
        }

        showAlert('step2Alert', 'Account activated! Redirecting to dashboard...', 'success');
        setTimeout(() => {
          window.location.href = '/bookings.html';
        }, 1200);
      } catch (err) {
        showAlert('step2Alert', 'Network error. Please try again.');
      } finally {
        completeRegBtn.disabled = false;
        completeRegBtn.textContent = 'Create Account & Log In';
      }
    });

    // Resend Code Button
    resendCodeBtn?.addEventListener('click', async () => {
      clearAlert('step2Alert');
      const email = verifiedEmailInput.value.trim();

      if (!email) {
        showAlert('step2Alert', 'Email missing. Please return to step 1.');
        return;
      }

      resendCodeBtn.disabled = true;
      resendCodeBtn.textContent = 'Resending...';

      try {
        const res = await fetch('/api/auth/resend-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });

        const data = await res.json();

        if (!res.ok) {
          showAlert('step2Alert', data.error || 'Could not resend code.');
          return;
        }

        showAlert('step2Alert', data.message, 'success');
      } catch (err) {
        showAlert('step2Alert', 'Network error. Please try again.');
      } finally {
        setTimeout(() => {
          resendCodeBtn.disabled = false;
          resendCodeBtn.textContent = 'Resend Code';
        }, 3000);
      }
    });
  }
});

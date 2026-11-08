// public/js/slots.js
// --------------------------------------------------
// Facility Selection, Daily Slot Grid & Hold/Confirm Client.
//
// Features:
// - Session verification & user header display
// - 7-day horizontal scroll date picker
// - Live slot grid rendering with distinct text labels
// - 5-minute atomic slot hold with live countdown timer
// - Safe confirmation and release actions with double-click defense
// - XSS-safe DOM generation (strictly textContent & createElement)
// --------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  let currentUser = null;
  let facilities = [];
  let selectedFacilityId = null;
  let selectedDate = null;
  let activeHold = null; // { id, slot_id, booking_date, hold_expires_at }
  let holdInterval = null;

  const facilityPills = document.getElementById('facilityPills');
  const datePicker = document.getElementById('datePicker');
  const slotsContainer = document.getElementById('slotsContainer');
  const facilityNotice = document.getElementById('facilityNotice');
  const facilityNameDisplay = document.getElementById('facilityNameDisplay');
  const facilityDescDisplay = document.getElementById('facilityDescDisplay');
  const slotCount = document.getElementById('slotCount');
  const bookingAlert = document.getElementById('bookingAlert');
  const userGreeting = document.getElementById('userGreeting');

  // Hold bar elements
  const holdBar = document.getElementById('holdBar');
  const holdTimer = document.getElementById('holdTimer');
  const confirmBookingBtn = document.getElementById('confirmBookingBtn');
  const cancelHoldBtn = document.getElementById('cancelHoldBtn');
  const connectionPill = document.getElementById('connectionPill');

  // --------------------------------------------------
  // Real-Time Socket.io Connection
  // --------------------------------------------------
  let isInitialConnect = true;
  let socket = null;

  if (typeof io !== 'undefined') {
    socket = io({ withCredentials: true });

    socket.on('connect', () => {
      if (connectionPill) connectionPill.style.display = 'none';

      // On reconnect, always refetch the latest state to guarantee fresh data
      if (!isInitialConnect) {
        checkActiveHold();
        loadSlots();
      }
      isInitialConnect = false;
    });

    socket.on('disconnect', () => {
      if (connectionPill) {
        connectionPill.style.display = 'block';
        connectionPill.className = 'connection-status disconnected';
        connectionPill.textContent = 'Disconnected — Retrying...';
      }
    });

    socket.on('connect_error', () => {
      if (connectionPill) {
        connectionPill.style.display = 'block';
        connectionPill.className = 'connection-status reconnecting';
        connectionPill.textContent = 'Reconnecting live updates...';
      }
    });

    // Handle real-time slot state changes
    socket.on('slot:update', (update) => {
      // Only update if the event pertains to the date currently in view
      if (!update || update.booking_date !== selectedDate) return;

      const slotEl = slotsContainer.querySelector(`[data-slot-id="${update.slot_id}"]`);
      if (!slotEl) return;

      const statusBadge = slotEl.querySelector('.slot-status');
      const isOurCurrentHold = activeHold && activeHold.slot_id === update.slot_id;

      if (update.status === 'booked') {
        if (isOurCurrentHold) clearHoldCountdown();
        slotEl.className = 'slot-item booked';
        if (statusBadge) statusBadge.textContent = 'BOOKED';
        slotEl.removeAttribute('role');
        slotEl.removeAttribute('tabindex');
        slotEl.onclick = null;
      } else if (update.status === 'held') {
        if (!isOurCurrentHold) {
          slotEl.className = 'slot-item held';
          if (statusBadge) statusBadge.textContent = 'HELD';
          slotEl.removeAttribute('role');
          slotEl.removeAttribute('tabindex');
          slotEl.onclick = null;
        }
      } else if (update.status === 'available') {
        if (isOurCurrentHold) clearHoldCountdown();
        slotEl.className = 'slot-item available';
        if (statusBadge) statusBadge.textContent = 'AVAILABLE';
        slotEl.setAttribute('role', 'button');
        slotEl.setAttribute('tabindex', '0');
        slotEl.onclick = async () => {
          await handleHoldSlot(update.slot_id, selectedDate);
        };
      }
    });
  }

  // --------------------------------------------------
  // Helper: Format Time "HH:MM" -> "6:00 AM"
  // --------------------------------------------------
  function formatTime(timeStr) {
    if (!timeStr) return '';
    const [h, m] = timeStr.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${hour12}:${m.toString().padStart(2, '0')} ${period}`;
  }

  function showAlert(msg, type = 'error') {
    if (!bookingAlert) return;
    bookingAlert.textContent = msg;
    bookingAlert.className = `alert alert-${type}`;
  }

  function clearAlert() {
    if (!bookingAlert) return;
    bookingAlert.textContent = '';
    bookingAlert.className = 'alert';
  }

  // --------------------------------------------------
  // 1. Verify User Authentication
  // --------------------------------------------------
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) {
      window.location.href = '/index.html';
      return;
    }
    const data = await res.json();
    currentUser = data.user;
    if (userGreeting) {
      userGreeting.textContent = currentUser.name.split(' ')[0];
    }
  } catch (err) {
    window.location.href = '/index.html';
    return;
  }

  // --------------------------------------------------
  // 2. Setup Logout Handlers
  // --------------------------------------------------
  async function handleLogout(e) {
    e.preventDefault();
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.href = '/index.html';
    }
  }

  document.getElementById('logoutBtnTop')?.addEventListener('click', handleLogout);
  document.getElementById('logoutBtnBottom')?.addEventListener('click', handleLogout);

  // --------------------------------------------------
  // 3. Hold Countdown Timer Logic
  // --------------------------------------------------
  function startHoldCountdown(expiresAtUtc) {
    if (holdInterval) clearInterval(holdInterval);
    if (!holdBar) return;

    holdBar.classList.add('visible');

    function update() {
      const now = new Date().getTime();
      const target = new Date(expiresAtUtc).getTime();
      const diffMs = target - now;

      if (diffMs <= 0) {
        clearInterval(holdInterval);
        holdBar.classList.remove('visible');
        activeHold = null;
        showAlert('Your 5-minute hold has expired. The slot is released.', 'warning');
        loadSlots();
        return;
      }

      const totalSec = Math.floor(diffMs / 1000);
      const minutes = Math.floor(totalSec / 60);
      const seconds = totalSec % 60;
      if (holdTimer) {
        holdTimer.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
      }
    }

    update();
    holdInterval = setInterval(update, 1000);
  }

  function clearHoldCountdown() {
    if (holdInterval) clearInterval(holdInterval);
    if (holdBar) holdBar.classList.remove('visible');
    activeHold = null;
  }

  // Check on page load if user already has an active hold
  async function checkActiveHold() {
    try {
      const res = await fetch('/api/bookings/active-hold');
      if (res.ok) {
        const data = await res.json();
        if (data.hold) {
          activeHold = data.hold;
          startHoldCountdown(data.hold.hold_expires_at);
        }
      }
    } catch (_err) {
      // Ignored
    }
  }

  // --------------------------------------------------
  // 4. Build 7-Day Date Picker
  // --------------------------------------------------
  function initDatePicker() {
    datePicker.innerHTML = '';
    const today = new Date();

    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);

      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const isoDate = `${year}-${month}-${day}`;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'date-btn';
      if (i === 0) {
        btn.classList.add('active');
        selectedDate = isoDate;
      }
      btn.dataset.date = isoDate;

      const dayName = document.createElement('span');
      dayName.className = 'day-name';
      dayName.textContent = i === 0 ? 'Today' : d.toLocaleDateString('en-IN', { weekday: 'short' });

      const dayNum = document.createElement('span');
      dayNum.className = 'day-num';
      dayNum.textContent = d.getDate();

      const dayMonth = document.createElement('span');
      dayMonth.className = 'day-month';
      dayMonth.textContent = d.toLocaleDateString('en-IN', { month: 'short' });

      btn.appendChild(dayName);
      btn.appendChild(dayNum);
      btn.appendChild(dayMonth);

      btn.addEventListener('click', () => {
        document.querySelectorAll('.date-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedDate = isoDate;
        loadSlots();
      });

      datePicker.appendChild(btn);
    }
  }

  // --------------------------------------------------
  // 5. Fetch Facilities
  // --------------------------------------------------
  async function loadFacilities() {
    try {
      const res = await fetch('/api/facilities');
      if (!res.ok) throw new Error('Could not load facilities');
      const data = await res.json();
      facilities = data.facilities;

      if (facilities.length === 0) {
        showAlert('No sports facilities are currently available.', 'warning');
        return;
      }

      facilityPills.innerHTML = '';
      facilities.forEach((fac, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'date-btn';
        if (idx === 0) {
          btn.classList.add('active');
          selectedFacilityId = fac.id;
          updateFacilityInfo(fac);
        }
        btn.style.minWidth = '110px';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'day-num';
        nameSpan.style.fontSize = '14px';
        nameSpan.textContent = fac.name;

        btn.appendChild(nameSpan);

        btn.addEventListener('click', () => {
          document.querySelectorAll('#facilityPills .date-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          selectedFacilityId = fac.id;
          updateFacilityInfo(fac);
          loadSlots();
        });

        facilityPills.appendChild(btn);
      });

      loadSlots();
    } catch (err) {
      showAlert('Failed to connect to facilities service. Please refresh.');
    }
  }

  function updateFacilityInfo(fac) {
    if (facilityNameDisplay) facilityNameDisplay.textContent = fac.name;
    if (facilityDescDisplay) facilityDescDisplay.textContent = fac.description || 'Standard facility slots';
  }

  // --------------------------------------------------
  // 6. Fetch & Render Slots
  // --------------------------------------------------
  async function loadSlots() {
    if (!selectedFacilityId || !selectedDate) return;

    clearAlert();
    slotsContainer.innerHTML = `
      <div class="loading">
        <span class="spinner"></span> Loading slots for ${selectedDate}...
      </div>
    `;

    try {
      const res = await fetch(`/api/facilities/${selectedFacilityId}/slots?date=${selectedDate}`);
      const data = await res.json();

      if (!res.ok) {
        showAlert(data.error || 'Failed to load slots.');
        slotsContainer.innerHTML = '<div class="empty-state">Unable to display slots.</div>';
        return;
      }

      const slots = data.slots;
      if (slotCount) slotCount.textContent = slots.length;

      if (slots.length === 0) {
        slotsContainer.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-text">No slots scheduled for this facility on this date.</div>
          </div>
        `;
        return;
      }

      slotsContainer.innerHTML = '';

      slots.forEach((slot) => {
        const item = document.createElement('div');
        item.className = `slot-item ${slot.status}`;
        if (slot.is_your_hold) {
          item.classList.add('your-hold');
        }

        item.dataset.slotId = slot.slot_id;

        // Slot Time
        const timeSpan = document.createElement('div');
        timeSpan.className = 'slot-time';
        timeSpan.textContent = `${formatTime(slot.start_time)} – ${formatTime(slot.end_time)}`;

        // Slot Status Badge
        const statusSpan = document.createElement('span');
        statusSpan.className = 'slot-status';

        if (slot.is_your_hold) {
          statusSpan.textContent = 'YOUR HOLD';
        } else if (slot.status === 'available') {
          statusSpan.textContent = 'AVAILABLE';
        } else if (slot.status === 'booked') {
          statusSpan.textContent = 'BOOKED';
        } else if (slot.status === 'held') {
          statusSpan.textContent = 'HELD';
        } else if (slot.status === 'past') {
          statusSpan.textContent = 'EXPIRED / PAST';
        }

        item.appendChild(timeSpan);
        item.appendChild(statusSpan);

        // Click Handler -> Acquire 5-Minute Hold
        if (slot.status === 'available') {
          item.setAttribute('role', 'button');
          item.setAttribute('tabindex', '0');
          item.setAttribute('aria-label', `Book ${formatTime(slot.start_time)} slot`);

          item.addEventListener('click', async () => {
            await handleHoldSlot(slot.slot_id, selectedDate);
          });
        }

        slotsContainer.appendChild(item);
      });
    } catch (err) {
      showAlert('Error loading slot information. Please try again.');
      slotsContainer.innerHTML = '<div class="empty-state">Network error. Please try again.</div>';
    }
  }

  // --------------------------------------------------
  // 7. Acquire Hold Handler
  // --------------------------------------------------
  async function handleHoldSlot(slotId, bookingDate) {
    clearAlert();
    try {
      const res = await fetch('/api/bookings/hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot_id: slotId, booking_date: bookingDate }),
      });

      const data = await res.json();

      if (!res.ok) {
        showAlert(data.error || 'Unable to hold this slot.');
        loadSlots(); // Refresh slot statuses in case another student took it
        return;
      }

      activeHold = data.booking;
      startHoldCountdown(data.booking.hold_expires_at);
      showAlert(data.message, 'success');
      loadSlots();
    } catch (err) {
      showAlert('Network error while holding slot. Please try again.');
    }
  }

  // --------------------------------------------------
  // 8. Confirm Booking Handler
  // --------------------------------------------------
  if (confirmBookingBtn) {
    confirmBookingBtn.addEventListener('click', async () => {
      if (!activeHold) return;

      clearAlert();
      confirmBookingBtn.disabled = true;
      confirmBookingBtn.textContent = 'Confirming...';

      try {
        const res = await fetch('/api/bookings/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ booking_id: activeHold.id }),
        });

        const data = await res.json();

        if (!res.ok) {
          showAlert(data.error || 'Could not confirm booking.');
          return;
        }

        clearHoldCountdown();
        showAlert(`Booking confirmed! Slot reserved for ${data.booking.booking_date} at ${formatTime(data.booking.start_time)}. View in "My Bookings".`, 'success');
        loadSlots();
      } catch (err) {
        showAlert('Network error confirming booking.');
      } finally {
        confirmBookingBtn.disabled = false;
        confirmBookingBtn.textContent = 'Confirm Booking';
      }
    });
  }

  // --------------------------------------------------
  // 9. Release Hold Handler
  // --------------------------------------------------
  if (cancelHoldBtn) {
    cancelHoldBtn.addEventListener('click', async () => {
      if (!activeHold) return;

      cancelHoldBtn.disabled = true;
      try {
        await fetch('/api/bookings/release', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ booking_id: activeHold.id }),
        });

        clearHoldCountdown();
        showAlert('Hold released. The slot is available for others.', 'info');
        loadSlots();
      } catch (err) {
        showAlert('Failed to release hold.');
      } finally {
        cancelHoldBtn.disabled = false;
      }
    });
  }

  // Initialize page
  initDatePicker();
  loadFacilities();
  checkActiveHold();
});

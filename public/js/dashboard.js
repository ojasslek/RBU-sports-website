// Slot board behaviour for Phase 3.
//
// The browser only draws what the server returns. It does not decide whether a
// slot is free, what "today" is, how far ahead booking is allowed, or when a
// hold expires. The server is the only authority for all of those rules.

(function () {
  'use strict';

  const api = window.RbuApi;

  const loadingState = document.getElementById('loadingState');
  const dashboardContent = document.getElementById('dashboardContent');
  const alertBox = document.getElementById('formAlert');
  const logoutButton = document.getElementById('logoutButton');

  const facilityList = document.getElementById('facilityList');
  const facilityEmpty = document.getElementById('facilityEmpty');
  const datePicker = document.getElementById('datePicker');

  const boardFacilityName = document.getElementById('boardFacilityName');
  const boardFacilityLocation = document.getElementById('boardFacilityLocation');
  const slotSummary = document.getElementById('slotSummary');
  const slotGrid = document.getElementById('slotGrid');
  const refreshButton = document.getElementById('refreshButton');

  const holdBar = document.getElementById('holdBar');
  const holdBarInfo = document.getElementById('holdBarInfo');
  const holdBarTimer = document.getElementById('holdBarTimer');
  const confirmHoldButton = document.getElementById('confirmHoldButton');
  const releaseHoldButton = document.getElementById('releaseHoldButton');

  let facilities = [];
  let days = [];
  let selectedFacilityId = null;
  let selectedDate = '';

  // The student may hold only one slot at a time. The server enforces this;
  // this object only drives the hold bar.
  let activeHold = null;
  let holdDeadlineMs = 0;
  let holdTimerId = null;
  let holdActionPending = false;

  // Changing facility/date quickly on mobile can start several requests.
  // Only the newest response is allowed to change the page.
  let boardRequestId = 0;

  function fillText(element, value) {
    if (element) element.textContent = value;
  }

  function goToLogin() {
    window.location.replace('/');
  }

  // ---------- Facilities ----------

  function renderFacilities() {
    facilityList.replaceChildren();

    for (const facility of facilities) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'facility-item';
      button.dataset.facilityId = String(facility.id);
      button.setAttribute(
        'aria-pressed',
        facility.id === selectedFacilityId ? 'true' : 'false'
      );

      if (facility.id === selectedFacilityId) {
        button.classList.add('selected');
      }

      const text = document.createElement('span');
      text.className = 'facility-text';

      const name = document.createElement('span');
      name.className = 'facility-name';
      name.textContent = facility.name;

      const description = document.createElement('span');
      description.className = 'facility-desc';
      description.textContent =
        facility.location || facility.description || '';

      text.append(name, description);
      button.append(text);

      button.addEventListener('click', () => {
        selectFacility(facility.id);
      });

      facilityList.append(button);
    }
  }

  function updateFacilitySelection() {
    const buttons = facilityList.querySelectorAll('.facility-item');

    for (const button of buttons) {
      const isSelected =
        Number(button.dataset.facilityId) === selectedFacilityId;

      button.classList.toggle('selected', isSelected);
      button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    }
  }

  function selectFacility(facilityId) {
    if (facilityId === selectedFacilityId) return;

    selectedFacilityId = facilityId;
    updateFacilitySelection();
    loadBoard();
  }

  // ---------- Dates ----------

  function renderDates() {
    datePicker.replaceChildren();

    for (const day of days) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'date-btn';
      button.dataset.date = day.date;
      button.setAttribute(
        'aria-pressed',
        day.date === selectedDate ? 'true' : 'false'
      );

      if (day.date === selectedDate) {
        button.classList.add('active');
      }

      const dayName = document.createElement('span');
      dayName.className = 'day-name';
      dayName.textContent = day.isToday ? 'Today' : day.weekday;

      const dayNumber = document.createElement('span');
      dayNumber.className = 'day-num';
      dayNumber.textContent = day.dayNumber;

      const dayMonth = document.createElement('span');
      dayMonth.className = 'day-month';
      dayMonth.textContent = day.month;

      button.append(dayName, dayNumber, dayMonth);

      button.addEventListener('click', () => {
        selectDate(day.date);
      });

      datePicker.append(button);
    }
  }

  function updateDateSelection() {
    const buttons = datePicker.querySelectorAll('.date-btn');

    for (const button of buttons) {
      const isSelected = button.dataset.date === selectedDate;

      button.classList.toggle('active', isSelected);
      button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    }
  }

  function selectDate(date) {
    if (date === selectedDate) return;

    selectedDate = date;
    updateDateSelection();
    loadBoard();
  }

  // ---------- Slot grid ----------

  function slotStatusText(slot) {
    if (slot.status === 'available') return 'Hold';
    if (slot.isMine && slot.status === 'held') return 'Your hold';
    if (slot.isMine && slot.status === 'booked') return 'Your booking';
    return slot.statusLabel;
  }

  function renderSlots(slots) {
    slotGrid.replaceChildren();

    if (slots.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';

      const emptyText = document.createElement('p');
      emptyText.className = 'empty-state-text';
      emptyText.textContent = 'No active slots for this facility.';

      empty.append(emptyText);
      slotGrid.append(empty);
      return;
    }

    for (const slot of slots) {
      const statusText = slotStatusText(slot);
      const isInteractive = slot.status === 'available';

      // Available slots are real buttons so they can be tapped and reached
      // with a keyboard. Other states are plain rows.
      const row = document.createElement(isInteractive ? 'button' : 'div');

      if (isInteractive) {
        row.type = 'button';
        row.dataset.slotId = String(slot.id);
        row.addEventListener('click', () => createHold(slot));
      }

      row.className = 'slot-item ' + slot.status;

      if (slot.isMine && slot.status === 'held') {
        row.classList.add('your-hold');
      }

      if (slot.isMine && slot.status === 'booked') {
        row.classList.add('your-booking');
      }

      row.setAttribute(
        'aria-label',
        slot.timeLabel +
          ': ' +
          (isInteractive
            ? 'Available. Tap to hold for 5 minutes.'
            : statusText)
      );

      const time = document.createElement('span');
      time.className = 'slot-time';
      time.textContent = slot.timeLabel;

      const status = document.createElement('span');
      status.className = 'slot-status';
      status.textContent = statusText;

      row.append(time, status);
      slotGrid.append(row);
    }
  }

  // ---------- Hold bar ----------

  function stopHoldTimer() {
    if (holdTimerId !== null) {
      window.clearInterval(holdTimerId);
      holdTimerId = null;
    }
  }

  function updateHoldTimer() {
    if (!activeHold) return;

    const remainingSeconds = Math.max(
      0,
      Math.ceil((holdDeadlineMs - Date.now()) / 1000)
    );

    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = String(remainingSeconds % 60).padStart(2, '0');
    holdBarTimer.textContent =
      remainingSeconds > 0
        ? 'Expires in ' + minutes + ':' + seconds
        : 'Hold expired';

    if (remainingSeconds === 0) {
      expireHold();
    }
  }

  async function expireHold() {
    hideHoldBar();
    await loadBoard();
    api.setAlert(
      alertBox,
      'Your hold expired and the slot was released. Choose another slot.',
      'warning'
    );
  }

  function startHoldTimer() {
    stopHoldTimer();
    updateHoldTimer();

    if (activeHold) {
      holdTimerId = window.setInterval(updateHoldTimer, 1000);
    }
  }

  function renderHoldBar(hold) {
    activeHold = hold;
    holdDeadlineMs = Date.now() + Math.max(0, hold.remainingSeconds) * 1000;

    // Reset any busy text left over from a previous hold.
    api.setBusy(confirmHoldButton, false);
    api.setBusy(releaseHoldButton, false);

    holdBarInfo.textContent =
      hold.facilityName +
      ' · ' +
      hold.dateLabel +
      ' · ' +
      hold.timeLabel;

    holdBar.classList.add('visible');
    document.body.classList.add('has-hold');

    startHoldTimer();
  }

  function hideHoldBar() {
    stopHoldTimer();
    activeHold = null;
    holdDeadlineMs = 0;

    holdBar.classList.remove('visible');
    document.body.classList.remove('has-hold');
    holdBarInfo.textContent = '';
    holdBarTimer.textContent = '';

    api.setBusy(confirmHoldButton, false);
    api.setBusy(releaseHoldButton, false);
  }

  async function loadActiveHold() {
    const result = await api.apiRequest('/api/bookings/active');

    if (!result.ok) {
      if (result.status === 401) {
        goToLogin();
        return false;
      }
      return false;
    }

    if (result.data.hold) {
      renderHoldBar(result.data.hold);
    } else {
      hideHoldBar();
    }

    return true;
  }

  // ---------- Hold / confirm / release ----------

  async function createHold(slot) {
    if (holdActionPending) return;

    if (activeHold) {
      api.setAlert(
        alertBox,
        'You already have a slot on hold. Confirm it or let it go first.',
        'warning'
      );
      return;
    }

    holdActionPending = true;
    slotGrid.setAttribute('aria-busy', 'true');

    const result = await api.apiRequest('/api/bookings/hold', {
      method: 'POST',
      body: { slotId: slot.id, date: selectedDate }
    });

    holdActionPending = false;
    slotGrid.setAttribute('aria-busy', 'false');

    if (!result.ok) {
      if (result.status === 401) {
        goToLogin();
        return;
      }

      if (result.data.code === 'HOLD_ALREADY_ACTIVE') {
        await loadActiveHold();
      }

      await loadBoard();
      api.setAlert(
        alertBox,
        result.data.error || 'Could not hold that slot. Please try again.',
        'error'
      );
      return;
    }

    renderHoldBar(result.data.hold);
    await loadBoard();

    api.setAlert(
      alertBox,
      'Slot held for 5 minutes. Confirm below to finish the booking.',
      'success'
    );
  }

  async function confirmHold() {
    if (!activeHold || holdActionPending) return;

    const hold = activeHold;
    holdActionPending = true;

    api.setBusy(confirmHoldButton, true, 'Confirming...');
    releaseHoldButton.disabled = true;

    const result = await api.apiRequest(
      '/api/bookings/' + hold.id + '/confirm',
      { method: 'POST' }
    );

    holdActionPending = false;
    releaseHoldButton.disabled = false;
    api.setBusy(confirmHoldButton, false);

    if (!result.ok) {
      if (result.status === 401) {
        goToLogin();
        return;
      }

      if (
        result.data.code === 'HOLD_EXPIRED' ||
        result.data.code === 'SLOT_STARTED' ||
        result.data.code === 'BOOKING_NOT_FOUND' ||
        result.data.code === 'DAILY_LIMIT_REACHED'
      ) {
        hideHoldBar();
      }

      await loadBoard();
      api.setAlert(
        alertBox,
        result.data.error || 'Could not confirm the booking. Please try again.',
        'error'
      );
      return;
    }

    hideHoldBar();
    await loadBoard();

    const booking = result.data.booking;
    api.setAlert(
      alertBox,
      'Booking confirmed for ' +
        booking.dateLabel +
        ', ' +
        booking.timeLabel +
        '.',
      'success'
    );
  }

  async function releaseHold() {
    if (!activeHold || holdActionPending) return;

    const hold = activeHold;
    holdActionPending = true;

    api.setBusy(releaseHoldButton, true, 'Releasing...');
    confirmHoldButton.disabled = true;

    const result = await api.apiRequest(
      '/api/bookings/' + hold.id + '/release',
      { method: 'POST' }
    );

    holdActionPending = false;
    confirmHoldButton.disabled = false;

    if (!result.ok) {
      if (result.status === 401) {
        goToLogin();
        return;
      }

      if (
        result.data.code === 'HOLD_EXPIRED' ||
        result.data.code === 'BOOKING_NOT_FOUND'
      ) {
        hideHoldBar();
      }

      await loadBoard();
      api.setAlert(
        alertBox,
        result.data.error || 'Could not release the hold. Please try again.',
        'error'
      );
      return;
    }

    hideHoldBar();
    await loadBoard();
    api.setAlert(alertBox, 'Hold released. The slot is free again.', 'info');
  }

  // ---------- Slot board ----------

  async function loadBoard() {
    if (!selectedFacilityId || !selectedDate) return;

    const requestId = ++boardRequestId;

    slotSummary.textContent = 'Loading slots...';
    slotGrid.setAttribute('aria-busy', 'true');

    const url =
      '/api/slots?facilityId=' +
      encodeURIComponent(selectedFacilityId) +
      '&date=' +
      encodeURIComponent(selectedDate);

    const result = await api.apiRequest(url);

    // A newer request started while this one was in flight.
    if (requestId !== boardRequestId) return;

    slotGrid.setAttribute('aria-busy', 'false');

    if (!result.ok) {
      if (result.status === 401) {
        goToLogin();
        return;
      }

      slotGrid.replaceChildren();
      slotSummary.textContent = '';
      api.setAlert(
        alertBox,
        result.data.error || 'Could not load slots. Please try again.',
        'error'
      );
      return;
    }

    api.setAlert(alertBox, '');

    const board = result.data;

    fillText(boardFacilityName, board.facility.name);
    fillText(
      boardFacilityLocation,
      board.facility.location || board.facility.description || ''
    );

    slotSummary.textContent =
      'Showing ' +
      board.dateLabel +
      '. Tap a free slot to hold it for 5 minutes.';

    renderSlots(board.slots);
  }

  // ---------- Startup ----------

  async function loadFacilitiesAndDates() {
    const result = await api.apiRequest('/api/facilities');

    if (!result.ok) {
      if (result.status === 401) {
        goToLogin();
        return;
      }

      api.setAlert(
        alertBox,
        result.data.error || 'Could not load facilities. Please try again.',
        'error'
      );
      return;
    }

    facilities = result.data.facilities || [];
    days = result.data.days || [];
    selectedDate = result.data.today || '';
    selectedFacilityId = facilities.length > 0 ? facilities[0].id : null;

    if (facilities.length === 0) {
      facilityEmpty.textContent = 'No facilities are available right now.';
      datePicker.replaceChildren();
      slotSummary.textContent = '';
      return;
    }

    renderFacilities();
    renderDates();
    await loadBoard();
  }

  async function init() {
    const me = await api.apiRequest('/api/auth/me');

    if (!me.ok) {
      goToLogin();
      return;
    }

    const user = me.data.user;

    fillText(document.getElementById('headerUserName'), user.fullName);
    fillText(document.getElementById('accountName'), user.fullName);
    fillText(document.getElementById('accountCollegeId'), user.collegeId);
    fillText(document.getElementById('accountEmail'), user.email);

    loadingState.classList.add('hidden');
    dashboardContent.classList.remove('hidden');

    await Promise.all([loadActiveHold(), loadFacilitiesAndDates()]);
  }

  if (refreshButton) {
    refreshButton.addEventListener('click', async () => {
      api.setBusy(refreshButton, true, 'Refreshing...');
      await Promise.all([loadBoard(), loadActiveHold()]);
      api.setBusy(refreshButton, false);
    });
  }

  if (confirmHoldButton) {
    confirmHoldButton.addEventListener('click', confirmHold);
  }

  if (releaseHoldButton) {
    releaseHoldButton.addEventListener('click', releaseHold);
  }

  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      api.setBusy(logoutButton, true, 'Logging out...');

      const result = await api.apiRequest('/api/auth/logout', {
        method: 'POST'
      });

      if (!result.ok) {
        api.setBusy(logoutButton, false);
        api.setAlert(
          alertBox,
          result.data.error || 'Could not log out. Please try again.',
          'error'
        );
        return;
      }

      window.location.replace('/');
    });
  }

  init();
})();

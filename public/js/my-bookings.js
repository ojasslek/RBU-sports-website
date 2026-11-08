// public/js/my-bookings.js
// --------------------------------------------------
// "My Bookings" Client.
//
// Features:
// - Fetches student's personal reservation history
// - Categorizes into Upcoming vs Past/Cancelled
// - Direct cancellation with confirmation check & double-click defense
// - Strictly uses createElement & textContent (Prevents XSS)
// --------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  let currentUser = null;
  let upcomingBookings = [];
  let pastBookings = [];
  let activeTab = 'upcoming'; // 'upcoming' | 'past'

  const userGreeting = document.getElementById('userGreeting');
  const bookingAlert = document.getElementById('bookingAlert');
  const tabUpcoming = document.getElementById('tabUpcoming');
  const tabPast = document.getElementById('tabPast');
  const upcomingCount = document.getElementById('upcomingCount');
  const pastCount = document.getElementById('pastCount');
  const bookingsList = document.getElementById('bookingsList');

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

  // Helper: Format Date "YYYY-MM-DD" -> "Fri, 15 Mar"
  function formatDate(dateStr) {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-').map(Number);
    const d = new Date(year, month - 1, day);
    return d.toLocaleDateString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
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
  // 3. Tab Switching
  // --------------------------------------------------
  tabUpcoming.addEventListener('click', () => {
    activeTab = 'upcoming';
    tabUpcoming.classList.add('active');
    tabUpcoming.setAttribute('aria-selected', 'true');
    tabPast.classList.remove('active');
    tabPast.setAttribute('aria-selected', 'false');
    renderBookings();
  });

  tabPast.addEventListener('click', () => {
    activeTab = 'past';
    tabPast.classList.add('active');
    tabPast.setAttribute('aria-selected', 'true');
    tabUpcoming.classList.remove('active');
    tabUpcoming.setAttribute('aria-selected', 'false');
    renderBookings();
  });

  // --------------------------------------------------
  // 4. Fetch Bookings
  // --------------------------------------------------
  async function loadBookings() {
    clearAlert();
    bookingsList.innerHTML = `
      <div class="loading">
        <span class="spinner"></span> Loading your bookings...
      </div>
    `;

    try {
      const res = await fetch('/api/bookings/my');
      if (!res.ok) throw new Error('Could not load bookings');
      const data = await res.json();

      upcomingBookings = data.upcoming || [];
      pastBookings = data.past || [];

      if (upcomingCount) upcomingCount.textContent = upcomingBookings.length;
      if (pastCount) pastCount.textContent = pastBookings.length;

      renderBookings();
    } catch (err) {
      showAlert('Failed to load your reservations. Please refresh.');
      bookingsList.innerHTML = '<div class="empty-state">Network error. Please try again.</div>';
    }
  }

  // --------------------------------------------------
  // 5. Render Booking Cards
  // --------------------------------------------------
  function renderBookings() {
    const list = activeTab === 'upcoming' ? upcomingBookings : pastBookings;
    bookingsList.innerHTML = '';

    if (list.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-state';

      const emptyText = document.createElement('div');
      emptyText.className = 'empty-state-text';
      emptyText.textContent = activeTab === 'upcoming'
        ? 'You have no upcoming sports reservations.'
        : 'No past or cancelled bookings on record.';

      emptyDiv.appendChild(emptyText);

      if (activeTab === 'upcoming') {
        const bookLink = document.createElement('a');
        bookLink.href = '/bookings.html';
        bookLink.className = 'btn btn-primary btn-small';
        bookLink.textContent = 'Book a Slot Now';
        emptyDiv.appendChild(bookLink);
      }

      bookingsList.appendChild(emptyDiv);
      return;
    }

    list.forEach((b) => {
      const card = document.createElement('div');
      card.className = 'booking-card';

      // Header row: Facility Name + Status Badge
      const header = document.createElement('div');
      header.className = 'booking-card-header';

      const facName = document.createElement('div');
      facName.className = 'booking-facility';
      facName.textContent = b.facility_name;

      const statusBadge = document.createElement('span');
      statusBadge.className = `booking-status ${b.status}`;
      statusBadge.textContent = b.status.toUpperCase();

      header.appendChild(facName);
      header.appendChild(statusBadge);

      // Detail rows
      const dateDetail = document.createElement('div');
      dateDetail.className = 'booking-detail';
      dateDetail.textContent = `Date: ${formatDate(b.booking_date)} (${b.booking_date})`;

      const timeDetail = document.createElement('div');
      timeDetail.className = 'booking-detail';
      timeDetail.textContent = `Time: ${formatTime(b.start_time)} – ${formatTime(b.end_time)}`;

      card.appendChild(header);
      card.appendChild(dateDetail);
      card.appendChild(timeDetail);

      // Cancel Action for Upcoming Confirmed Bookings
      if (activeTab === 'upcoming' && b.status === 'confirmed') {
        const actions = document.createElement('div');
        actions.className = 'booking-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn btn-danger btn-small';
        cancelBtn.textContent = 'Cancel Booking';

        cancelBtn.addEventListener('click', async () => {
          const confirmed = window.confirm(`Are you sure you want to cancel your reservation for ${b.facility_name} on ${b.booking_date}?`);
          if (!confirmed) return;

          cancelBtn.disabled = true;
          cancelBtn.textContent = 'Cancelling...';

          try {
            const cancelRes = await fetch('/api/bookings/cancel', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ booking_id: b.id }),
            });

            const data = await cancelRes.json();

            if (!cancelRes.ok) {
              showAlert(data.error || 'Failed to cancel booking.');
              return;
            }

            showAlert('Booking cancelled. The slot has been released for other students.', 'success');
            loadBookings();
          } catch (err) {
            showAlert('Network error cancelling booking. Please try again.');
          } finally {
            cancelBtn.disabled = false;
            cancelBtn.textContent = 'Cancel Booking';
          }
        });

        actions.appendChild(cancelBtn);
        card.appendChild(actions);
      }

      bookingsList.appendChild(card);
    });
  }

  // Load initial bookings
  loadBookings();
});


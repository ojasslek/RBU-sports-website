// src/utils/time.js
// ALL date and time logic lives here. One place to change timezone logic.

const TIMEZONE = 'Asia/Kolkata';
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function nowUTC() {
  return new Date().toISOString();
}

function todayIST() {
  const now = new Date();
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return ist.toISOString().slice(0, 10);
}

function nowTimeIST() {
  const now = new Date();
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return ist.toISOString().slice(11, 16);
}

function utcToISTDisplay(utcString) {
  const date = new Date(utcString);
  return date.toLocaleString('en-IN', { timeZone: TIMEZONE });
}

function istToUTC(dateStr, timeStr) {
  const istDate = new Date(`${dateStr}T${timeStr}:00.000+05:30`);
  return istDate.toISOString();
}

function isSlotInPast(dateStr, startTimeIST) {
  const slotStart = new Date(istToUTC(dateStr, startTimeIST));
  return slotStart <= new Date();
}

function daysFromTodayIST(n) {
  const now = new Date();
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  ist.setUTCDate(ist.getUTCDate() + n);
  return ist.toISOString().slice(0, 10);
}

function minutesFromNowUTC(minutes) {
  const future = new Date(Date.now() + minutes * 60 * 1000);
  return future.toISOString();
}

function isExpired(utcString) {
  return new Date(utcString) <= new Date();
}

function canCancel(dateStr, startTimeIST, minHours) {
  const slotStart = new Date(istToUTC(dateStr, startTimeIST));
  const cutoff = new Date(slotStart.getTime() - minHours * 60 * 60 * 1000);
  return new Date() <= cutoff;
}

function formatTimeIST(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${m.toString().padStart(2, '0')} ${period}`;
}

function formatDateIST(dateStr) {
  const date = new Date(dateStr + 'T00:00:00+05:30');
  return date.toLocaleDateString('en-IN', {
    timeZone: TIMEZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

module.exports = {
  TIMEZONE, nowUTC, todayIST, nowTimeIST, utcToISTDisplay,
  istToUTC, isSlotInPast, daysFromTodayIST, minutesFromNowUTC,
  isExpired, canCancel, formatTimeIST, formatDateIST,
};

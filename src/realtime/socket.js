// src/realtime/socket.js
// --------------------------------------------------
// Real-time Event Broadcaster using Socket.io.
//
// SECURITY & PRIVACY:
// 1. Connection Authentication: Handshake verifies the httpOnly JWT cookie.
//    Unauthenticated sockets are rejected.
// 2. Strict CORS / Origin control via config.allowedOrigins.
// 3. Privacy Guarantee: Broadcast payloads contain ONLY:
//    { slot_id, booking_date, status }
//    NEVER student IDs, names, or emails.
// --------------------------------------------------

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('../config');
const usersDal = require('../data/users.dal');

let ioInstance = null;

// Parse raw cookie string from HTTP headers
function parseCookieHeader(headerStr) {
  if (!headerStr) return {};
  return headerStr.split(';').reduce((acc, item) => {
    const [key, value] = item.trim().split('=');
    if (key && value) {
      acc[key] = decodeURIComponent(value);
    }
    return acc;
  }, {});
}

/**
 * Initialize Socket.io on the shared HTTP server.
 */
function initSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        // In development, allow localhost, local Wi-Fi IP, and tunnels
        if (!config.isProduction || !origin || config.allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error('CORS origin denied'));
      },
      credentials: true,
    },
    // Sane timeouts for mobile networks
    pingTimeout: 20000,
    pingInterval: 25000,
  });

  // Authentication Middleware for WebSocket Connections
  io.use((socket, next) => {
    try {
      // 1. Look for token in cookies first, then in handshake auth object
      const cookies = parseCookieHeader(socket.handshake.headers.cookie);
      let token = cookies.token || socket.handshake.auth?.token;

      if (!token) {
        return next(new Error('Authentication required for WebSocket connection.'));
      }

      // 2. Verify JWT signature
      const decoded = jwt.verify(token, config.jwtSecret);

      // 3. Verify user exists and is active
      const user = usersDal.findUserById(decoded.id);
      if (!user || !user.is_verified) {
        return next(new Error('User account not found or unverified.'));
      }

      // Attach student identity internally (never broadcasted!)
      socket.user = { id: user.id, college_id: user.college_id, role: user.role };
      next();
    } catch (err) {
      next(new Error('Invalid session token.'));
    }
  });

  io.on('connection', (socket) => {
    // Student connected
    socket.on('disconnect', (_reason) => {
      // Clean disconnect
    });
  });

  ioInstance = io;
  return io;
}

/**
 * Broadcast a slot status change to ALL connected clients.
 *
 * @param {object} payload
 * @param {number} payload.slot_id
 * @param {string} payload.booking_date - "YYYY-MM-DD"
 * @param {string} payload.status - 'available' | 'held' | 'booked'
 */
function broadcastSlotUpdate({ slot_id, booking_date, status }) {
  if (!ioInstance) return;

  // PRIVACY: Only send slot_id, booking_date, and status.
  const cleanPayload = {
    slot_id,
    booking_date,
    status,
    timestamp: new Date().toISOString(),
  };

  ioInstance.emit('slot:update', cleanPayload);
}

function getIo() {
  return ioInstance;
}

module.exports = {
  initSocket,
  broadcastSlotUpdate,
  getIo,
};


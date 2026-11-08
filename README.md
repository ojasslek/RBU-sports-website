# Campus Sports Facility Slot Booking System

A fast, mobile-first campus sports facility booking system built with Node.js, Express, SQLite, and Socket.io. Designed specifically for university students booking courts and fields from their phones.

---

## Tech Stack & Architecture

- **Frontend**: Mobile-first vanilla HTML5, CSS (CSS variables, 8px spacing scale), and vanilla JavaScript. Zero frontend frameworks, zero build step.
- **Backend**: Node.js & Express serving both the REST API and the static web client.
- **Database**: SQLite (via `node:sqlite` / `better-sqlite3`) configured with WAL mode and `PRAGMA foreign_keys = ON`. All SQL queries are encapsulated inside `src/data/`.
- **Concurrency**: `BEGIN IMMEDIATE` transactions and a partial UNIQUE index `(slot_id, booking_date) WHERE status IN ('held', 'confirmed')` preventing double-booking races.
- **Real-Time**: Socket.io broadcasting live status changes (`held`, `booked`, `available`) to all active screens.
- **Security**: Helmet Content-Security-Policy, bcrypt password & OTP hashing (cost 12), `httpOnly` + `Secure` + `SameSite: 'lax'` JWT cookies, account lockout after 5 failed logins, and endpoint rate limiting.

---

## Local Development Setup

### 1. Prerequisites
- Node.js >= 18.0.0 (tested on Node 20 LTS, 22 LTS, and 24)
- npm

### 2. Installation
```bash
# Clone the repository and navigate into the folder
cd RBU-sports-website

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
```

### 3. Configure `.env`
Edit `.env` and set a strong, random 64-character secret for `JWT_SECRET`:
```ini
JWT_SECRET=your_super_secret_random_64_character_hex_string
PORT=3000
NODE_ENV=development
DB_PATH=./data/sports.db
COLLEGE_NAME=RBU
COLLEGE_TIMEZONE=Asia/Kolkata
```

### 4. Run Migrations & Start Server
```bash
# Run database migrations (creates tables and seed data)
npm run migrate

# Start the server with automatic reload
npm run dev

# Or start in standard mode
npm start
```
Visit `http://localhost:3000` in your browser.

---

## Automated Test Suite

Run the full integration test suite (45 tests across 6 suites covering Auth, OTP, Lockout, Facilities, Slot Grids, Real-Time WebSockets, My Bookings, IDOR Defense, and 20-Request Race Concurrency):

```bash
npm test
```

---

## Deployment Guides

### Option 1: Render.com (Web Service + Persistent Disk)

1. **Create a new Web Service**:
   - Link your GitHub repository.
   - **Environment**: Node
   - **Build Command**: `npm ci --omit=dev`
   - **Start Command**: `npm start`
2. **Add a Persistent Disk**:
   - In your Render dashboard under **Disks**, click **Add Disk**.
   - **Name**: `sports-data`
   - **Mount Path**: `/var/data`
   - **Size**: 1 GB (plenty for SQLite)
3. **Set Environment Variables**:
   ```ini
   NODE_ENV=production
   PORT=10000
   DB_PATH=/var/data/sports.db
   BACKUP_DIR=/var/data/backups
   JWT_SECRET=generate-a-strong-random-64-character-secret
   COLLEGE_NAME=RBU
   COLLEGE_TIMEZONE=Asia/Kolkata
   ALLOWED_ORIGINS=https://your-app-name.onrender.com
   ```
4. **Health Check Path**:
   - Set health check path to `/health`.
5. Click **Deploy**. Render will build and launch your application with SSL automatically configured.

---

### Option 2: Railway.app (Volume Mount)

1. **Deploy from GitHub**:
   - Create a new project on Railway and select your repository.
2. **Add a Persistent Volume**:
   - Go to your service settings -> **Volumes** -> **Add Volume**.
   - **Mount Path**: `/app/data`
3. **Configure Variables**:
   ```ini
   NODE_ENV=production
   PORT=3000
   DB_PATH=/app/data/sports.db
   BACKUP_DIR=/app/data/backups
   JWT_SECRET=your-random-64-char-string
   COLLEGE_NAME=RBU
   COLLEGE_TIMEZONE=Asia/Kolkata
   ALLOWED_ORIGINS=https://your-domain.up.railway.app
   ```
4. Railway will automatically build using the included `Dockerfile` and mount the persistent volume.

---

### Option 3: Traditional VPS (Ubuntu 22.04 / 24.04 with Nginx + Systemd)

1. **Install Node.js & Nginx**:
   ```bash
   sudo apt update && sudo apt install -y nodejs npm nginx ufw
   ```
2. **Clone & Install**:
   ```bash
   cd /var/www
   git clone https://github.com/your-username/rbu-sports-website.git
   cd rbu-sports-website
   npm ci --omit=dev
   npm run migrate
   ```
3. **Create Systemd Service (`/etc/systemd/system/sports.service`)**:
   ```ini
   [Unit]
   Description=RBU Sports Booking Application
   After=network.target

   [Service]
   Type=simple
   User=www-data
   WorkingDirectory=/var/www/rbu-sports-website
   ExecStart=/usr/bin/node src/server.js
   Restart=always
   RestartSec=5
   Environment=NODE_ENV=production
   Environment=PORT=3000
   Environment=DB_PATH=/var/www/rbu-sports-website/data/sports.db
   Environment=JWT_SECRET=your-production-secret-key

   [Install]
   WantedBy=multi-user.target
   ```
   Start and enable the service:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now sports
   ```
4. **Nginx Reverse Proxy with WebSocket Support (`/etc/nginx/sites-available/sports`)**:
   ```nginx
   server {
       server_name sports.rbu.ac.in;

       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```
5. **Enable HTTPS with Let's Encrypt**:
   ```bash
   sudo apt install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d sports.rbu.ac.in
   ```

---

## Pre-Launch Checklist

Before sharing the link with students, verify each item:

- [ ] **Secret Management**:
  - `JWT_SECRET` in `.env` is NOT the placeholder string; it is a cryptographically strong 64-character random string.
  - `.env` is listed in `.gitignore` and has NEVER been pushed to public Git history.
- [ ] **HTTPS Enforcement**:
  - `NODE_ENV=production` is set so the server enforces HTTPS redirects and marks the session cookie as `Secure`.
- [ ] **Persistent Disk**:
  - `DB_PATH` points to a persistent volume (e.g. `/var/data/sports.db`), NOT an ephemeral container layer that resets on restart.
- [ ] **Daily Backups**:
  - Automated midnight backups run via cron to `backups/sports-backup-*.db`.
- [ ] **Email Delivery**:
  - If using live SMTP, verify test OTP emails arrive in university inbox accounts.
- [ ] **Valid Student Roster**:
  - `valid_college_ids` table contains your current batch's actual student roll numbers and official university email addresses.
- [ ] **Automated Tests**:
  - Run `npm test` on the production server or CI pipeline to confirm all 45 integration tests pass.
- [ ] **Health Endpoint**:
  - Pinging `/health` returns HTTP 200 `{ "status": "ok" }`.


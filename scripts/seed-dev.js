// Development-only sample data.
// Run after "npm run migrate":
//   npm run seed:dev
//
// These college IDs use the reserved .invalid domain and cannot receive email.
// They exist only so you can test the student flow locally. Replace them with
// a real CSV in the admin phase.

const config = require('../src/config');

if (config.isProduction) {
  console.error('Refusing to seed development data when NODE_ENV=production.');
  process.exit(1);
}

const db = require('../src/db/connection');

const tableExists = db
  .prepare(
    "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'facilities'"
  )
  .get();

if (!tableExists) {
  console.error('Tables were not found. Run "npm run migrate" first.');
  db.close();
  process.exit(1);
}

const facilitySeeds = [
  {
    name: 'Badminton Court 1',
    description: 'Indoor court. Bring your own racket and shuttle.',
    location: 'Indoor Sports Hall'
  },
  {
    name: 'Badminton Court 2',
    description: 'Indoor court. Bring your own racket and shuttle.',
    location: 'Indoor Sports Hall'
  },
  {
    name: 'Football Turf',
    description: 'Outdoor turf. Sports shoes required.',
    location: 'Main Ground'
  },
  {
    name: 'Gym',
    description: 'Weight and cardio section.',
    location: 'Sports Complex, Ground Floor'
  },
  {
    name: 'Table Tennis',
    description: 'Two tables. Bats available at the desk.',
    location: 'Indoor Sports Hall'
  }
];

const slotSeeds = [
  ['06:00', '07:00'],
  ['07:00', '08:00'],
  ['16:00', '17:00'],
  ['17:00', '18:00'],
  ['18:00', '19:00'],
  ['19:00', '20:00']
];

const validIdSeeds = [
  ['RBU-DEV-001', 'student1@rbu.invalid', 'Test Student One'],
  ['RBU-DEV-002', 'student2@rbu.invalid', 'Test Student Two'],
  ['RBU-DEV-003', 'student3@rbu.invalid', 'Test Student Three']
];

const seed = db.transaction(() => {
  const insertFacility = db.prepare(`
    INSERT INTO facilities (name, description, location)
    VALUES (?, ?, ?)
    ON CONFLICT(name) DO NOTHING
  `);

  const findFacility = db.prepare('SELECT id FROM facilities WHERE name = ?');

  const insertSlot = db.prepare(`
    INSERT INTO slots (facility_id, start_time, end_time)
    VALUES (?, ?, ?)
    ON CONFLICT(facility_id, start_time, end_time) DO NOTHING
  `);

  for (const facility of facilitySeeds) {
    insertFacility.run(facility.name, facility.description, facility.location);
    const row = findFacility.get(facility.name);

    for (const [startTime, endTime] of slotSeeds) {
      insertSlot.run(row.id, startTime, endTime);
    }
  }

  const insertValidId = db.prepare(`
    INSERT INTO valid_college_ids (college_id, email, full_name)
    VALUES (?, ?, ?)
    ON CONFLICT(college_id) DO NOTHING
  `);

  for (const [collegeId, email, fullName] of validIdSeeds) {
    insertValidId.run(collegeId, email, fullName);
  }
});

seed();

const facilityCount = db.prepare('SELECT COUNT(*) AS count FROM facilities').get();
const slotCount = db.prepare('SELECT COUNT(*) AS count FROM slots').get();
const validIdCount = db
  .prepare('SELECT COUNT(*) AS count FROM valid_college_ids')
  .get();

console.log(
  `Seed complete: ${facilityCount.count} facilities, ${slotCount.count} slots, ` +
    `${validIdCount.count} valid college IDs.`
);

db.close();

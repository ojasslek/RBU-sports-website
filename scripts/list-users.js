const db = require('../src/db/connection');
const users = db.prepare('SELECT * FROM users').all();
console.log('Users in DB:\n', JSON.stringify(users, null, 2));

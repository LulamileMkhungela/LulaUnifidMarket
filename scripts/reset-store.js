'use strict';

/**
 * Delete the persisted store snapshot so the next boot reseeds from scratch.
 * Only meaningful when the server runs with PROVERI_PERSIST=1.
 *
 *   npm run seed:reset
 */

const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_FILE } = require('../src/marketplace/store');

if (fs.existsSync(DEFAULT_FILE)) {
  fs.unlinkSync(DEFAULT_FILE);
  process.stdout.write(`Removed ${path.relative(process.cwd(), DEFAULT_FILE)} — next boot will reseed.\n`);
} else {
  process.stdout.write('No snapshot file present; nothing to reset.\n');
}

'use strict';

/**
 * Server-side formatting helpers shared by the demo scripts and any future
 * CLI tooling. The PWA keeps its own copy in pwa/js/ui.js because the browser
 * bundle must not require Node modules.
 */

const zar = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function money(cents) {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return '—';
  return zar.format(cents / 100);
}

function pad(label, width = 34) {
  return String(label).padEnd(width);
}

module.exports = { money, pad };

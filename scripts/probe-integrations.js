'use strict';

/**
 * Probe every free public data source ProVeri depends on and print an honest
 * report of what answered, how fast, and which adapter produced each number.
 *
 *   node scripts/probe-integrations.js          # forces the network on
 *   PROVERI_INTEGRATION_MODE=live npm run integrations:probe
 */

process.env.PROVERI_INTEGRATION_MODE = 'live';

const integrations = require('../src/integrations');

(async () => {
  const report = await integrations.probeLive();
  process.stdout.write(`\nLula ProVeri — public source probe (${report.completedAt})\n`);
  process.stdout.write(`${'='.repeat(64)}\n`);
  for (const result of report.results) {
    process.stdout.write(
      `${result.reachable ? '✓' : '✗'} ${result.name.padEnd(22)} ${String(result.latencyMs).padStart(5)} ms  ${result.source || result.detail || ''}\n`,
    );
  }
  process.stdout.write(`${'='.repeat(64)}\n`);
  process.stdout.write(`${report.liveCount}/${report.totalCount} reachable\n`);
  process.stdout.write(`HTTP stats: ${JSON.stringify(report.httpStats)}\n`);
  process.stdout.write(`Configured partners: ${JSON.stringify(report.configuredPartners)}\n\n`);
  process.stdout.write('Sources that cannot be reached fall back to the bundled dataset, and every\n');
  process.stdout.write('number in the product is labelled with the source that produced it.\n');
})();

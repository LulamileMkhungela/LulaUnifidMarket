'use strict';

/**
 * Container-style healthcheck: GET /api/health and exit non-zero if the ledger
 * chain is broken or the service does not answer.
 *
 *   npm run healthcheck            # assumes PORT from the environment
 *   HEALTH_URL=http://host:4173/api/health npm run healthcheck
 */

const url = process.env.HEALTH_URL || `http://127.0.0.1:${process.env.PORT || 4173}/api/health`;

(async () => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const body = await response.json();
    if (!response.ok || body.status !== 'ok') {
      process.stderr.write(`UNHEALTHY: ${response.status} ${JSON.stringify(body)}\n`);
      process.exit(1);
    }
    if (body.ledger && body.ledger.chainValid === false) {
      process.stderr.write(`LEDGER CHAIN BROKEN: ${JSON.stringify(body.ledger)}\n`);
      process.exit(2);
    }
    process.stdout.write(`HEALTHY ${url} · ledger ${body.ledger.entries} entries · chain valid\n`);
    process.exit(0);
  } catch (error) {
    process.stderr.write(`UNREACHABLE ${url}: ${error.message}\n`);
    process.exit(3);
  }
})();

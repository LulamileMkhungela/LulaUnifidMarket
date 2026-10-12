'use strict';

/**
 * Print the generated OpenAPI 3.1 document for the REST API.
 * It is derived from the routes that are actually registered, so it cannot drift.
 *
 *   npm run openapi            # pretty JSON to stdout
 *   npm run openapi > openapi.json
 */

const { buildApiRoutes } = require('../src/server/routes/api');
const { Marketplace } = require('../src/marketplace');

const marketplace = new Marketplace();
const router = buildApiRoutes({ marketplace });
const document = router.openapi({
  title: 'Lula ProVeri API',
  version: require('../package.json').version,
  description: 'South Africa’s verified on-demand services marketplace: jobs, bidding, escrow, proof-of-work evidence, disputes, verified reviews, the verified-vehicles vertical and Web Studio — all on one hash-chained trust ledger.',
});

process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);

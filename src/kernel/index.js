'use strict';

/** Public entry point for the ProVeri Trust Kernel. */

module.exports = require('./trustKernel');

/** Backwards-compatible shim for the original TrustShield engine API. */
module.exports.legacy = require('./legacy/trustEscrowEngine');

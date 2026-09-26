// vsce's transitive undici dependency expects the Node >=20 File global.
// Node 18 exports the same File constructor from node:buffer.
if (typeof globalThis.File === 'undefined') globalThis.File = require('node:buffer').File;

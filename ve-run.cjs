/* Runs a helper script with the repository static server in the same process. */
require('./tests/support/static-server.js');
require(process.argv[2]);

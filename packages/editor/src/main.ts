/**
 * Entry point of the bundled language server: serve over stdio (or the
 * transport the client passes on the command line: `--stdio`, `--node-ipc`,
 * `--socket=<port>`).
 */
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node';
import { startServer } from './server.js';

startServer(createConnection(ProposedFeatures.all));

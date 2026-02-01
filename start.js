/**
 * Launcher: run server from project root regardless of process cwd.
 * Fixes "UNC paths not supported" when npm start runs under Windows with WSL path.
 */
const path = require('path');

// Use npm's INIT_CWD (project dir) or dir of this file
const projectRoot = process.env.INIT_CWD || __dirname;
process.chdir(projectRoot);

require(path.join(projectRoot, 'server', 'index.js'));

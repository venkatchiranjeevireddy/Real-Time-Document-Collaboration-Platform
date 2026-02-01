/**
 * Phase 6: Simple structured logger (level + message).
 */

const levels = { info: 'INFO', warn: 'WARN', error: 'ERROR' };

function log(level, ...args) {
  const prefix = `[${levels[level] || level}]`;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(prefix, ...args);
}

module.exports = {
  info: (...args) => log('info', ...args),
  warn: (...args) => log('warn', ...args),
  error: (...args) => log('error', ...args),
};

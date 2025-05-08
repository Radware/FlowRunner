// logger.js
import { LOG_LEVEL } from './config.js';

const levels = ['debug', 'info', 'warn', 'error'];
function shouldLog(level) {
  return levels.indexOf(level) >= levels.indexOf(LOG_LEVEL);
}

export const logger = {
  debug: (...args) => shouldLog('debug') && console.debug('[DEBUG]', ...args),
  info:  (...args) => shouldLog('info')  && console.info('[INFO]', ...args),
  warn:  (...args) => shouldLog('warn')  && console.warn('[WARN]', ...args),
  error: (...args) => shouldLog('error') && console.error('[ERROR]', ...args),
};

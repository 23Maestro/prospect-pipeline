import fs from 'fs';
import path from 'path';

const LOG_DIR = '/Users/singleton23/raycast_logs';
const LOG_FILE = path.join(LOG_DIR, 'console.log');

try {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
} catch (error) {
  console.error('Failed to create log directory:', error);
}

function formatLogMessage(level: string, message: string, data?: any): string {
  const timestamp = new Date().toISOString();
  let dataStr = '';
  if (data) {
    try {
      dataStr = ' ' + JSON.stringify(data, null, 2);
    } catch {
      dataStr = ' [object]';
    }
  }
  return '[' + timestamp + '] [' + level + '] ' + message + dataStr + '\n';
}

function writeLog(level: string, message: string, data?: any): void {
  try {
    const logMessage = formatLogMessage(level, message, data);
    fs.appendFileSync(LOG_FILE, logMessage);

    if (level === 'ERROR') {
      console.error(message, data || '');
    } else {
      console.log(message, data || '');
    }
  } catch (error) {
    console.error('Failed to write log:', error);
  }
}

export const logger = {
  info: (message: string, data?: any) => writeLog('INFO', message, data),
  error: (message: string, data?: any) => writeLog('ERROR', message, data),
  debug: (message: string, data?: any) => writeLog('DEBUG', message, data),
  warn: (message: string, data?: any) => writeLog('WARN', message, data),
};

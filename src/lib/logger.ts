import fs from 'fs';
import path from 'path';

const LOG_DIR = '/Users/singleton23/raycast_logs';
const LOG_FILE = path.join(LOG_DIR, 'console.log');
const CRAFT_LOG_FILE = path.join(LOG_DIR, 'craft.log');
const INBOX_LOG_FILE = path.join(LOG_DIR, 'inbox.log');
const NOTES_LOG_FILE = path.join(LOG_DIR, 'notes.log');
const SEARCH_LOG_FILE = path.join(LOG_DIR, 'search.log');
const CACHE_LOG_FILE = path.join(LOG_DIR, 'cache.log');
const API_LOG_FILE = path.join(LOG_DIR, 'api.log');
const AUTOMATION_LOG_FILE = path.join(LOG_DIR, 'automation.log');
const VIDEO_PROGRESS_LOG_FILE = path.join(LOG_DIR, 'video-progress.log');

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

function writeLogToFile(filePath: string, level: string, message: string, data?: any): void {
  try {
    const logMessage = formatLogMessage(level, message, data);
    fs.appendFileSync(filePath, logMessage);

    if (level === 'ERROR') {
      console.error(message, data || '');
    } else {
      console.log(message, data || '');
    }
  } catch (error) {
    console.error('Failed to write log:', error);
  }
}

function createFileLogger(filePath: string) {
  return {
    info: (message: string, data?: any) => writeLogToFile(filePath, 'INFO', message, data),
    error: (message: string, data?: any) => writeLogToFile(filePath, 'ERROR', message, data),
    debug: (message: string, data?: any) => writeLogToFile(filePath, 'DEBUG', message, data),
    warn: (message: string, data?: any) => writeLogToFile(filePath, 'WARN', message, data),
  };
}

export const logger = createFileLogger(LOG_FILE);
export const craftLogger = createFileLogger(CRAFT_LOG_FILE);
export const inboxLogger = createFileLogger(INBOX_LOG_FILE);
export const notesLogger = createFileLogger(NOTES_LOG_FILE);
export const searchLogger = createFileLogger(SEARCH_LOG_FILE);
export const cacheLogger = createFileLogger(CACHE_LOG_FILE);
export const apiLogger = createFileLogger(API_LOG_FILE);
export const automationLogger = createFileLogger(AUTOMATION_LOG_FILE);
export const videoProgressLogger = createFileLogger(VIDEO_PROGRESS_LOG_FILE);

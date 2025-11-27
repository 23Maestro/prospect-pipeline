/**
 * Raycast Console Logger
 * Writes debug logs to Raycast console.log file for debugging
 */

import { getPreferenceValues } from "@raycast/api";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Path to Raycast console log
const RAYCAST_LOG_PATH = "/Users/singleton23/raycast_logs/console.log";

/**
 * Write a debug message to the Raycast console log
 */
export function logDebug(message: string, data?: any) {
  const timestamp = new Date().toISOString();
  const logMessage = data ? `[${timestamp}] ${message}\n${JSON.stringify(data, null, 2)}\n` : `[${timestamp}] ${message}\n`;

  try {
    fs.appendFileSync(RAYCAST_LOG_PATH, logMessage);
  } catch (error) {
    console.error("Failed to write to Raycast log:", error);
  }
}

/**
 * Log an error with full context
 */
export function logError(context: string, error: any, additionalData?: any) {
  const timestamp = new Date().toISOString();
  const errorObj = error instanceof Error ? { message: error.message, stack: error.stack } : error;
  const logEntry = {
    timestamp,
    context,
    error: errorObj,
    additionalData
  };

  const logMessage = `[${timestamp}] ERROR in ${context}\n${JSON.stringify(logEntry, null, 2)}\n`;

  try {
    fs.appendFileSync(RAYCAST_LOG_PATH, logMessage);
  } catch (e) {
    console.error("Failed to write error to Raycast log:", e);
  }
}

/**
 * Log video update attempt
 */
export function logVideoUpdate(operation: string, params: any, result?: any, error?: any) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    operation,
    params,
    result,
    error: error ? (error instanceof Error ? { message: error.message, stack: error.stack } : error) : null
  };

  const logMessage = `[${timestamp}] VIDEO_UPDATE: ${operation}\n${JSON.stringify(logEntry, null, 2)}\n`;

  try {
    fs.appendFileSync(RAYCAST_LOG_PATH, logMessage);
  } catch (e) {
    console.error("Failed to write video update to Raycast log:", e);
  }
}

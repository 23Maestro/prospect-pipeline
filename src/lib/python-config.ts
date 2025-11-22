/**
 * Centralized Python configuration and path resolution
 * Provides consistent path handling across all Python integration modules
 */

import * as path from "path";

/**
 * Workspace root directory - the Raycast extension root
 * Uses process.cwd() which returns the workspace root in Raycast extension context
 */
export const WORKSPACE_ROOT = process.cwd();

/**
 * Python executable path
 * Defaults to PYTHON_PATH environment variable, falls back to "python3"
 * Override with PYTHON_PATH env var for custom Python installations or venv paths
 */
export const PYTHON_PATH = process.env.PYTHON_PATH || "python3";

/**
 * Helper function to resolve Python script paths
 * @param scriptName - The script filename relative to src/python/ directory
 * @returns Absolute path to the Python script
 */
export function getPythonScriptPath(scriptName: string): string {
  return path.join(WORKSPACE_ROOT, "src", "python", scriptName);
}

/**
 * NPID API Client path
 */
export const NPID_CLIENT_PATH = getPythonScriptPath("npid_api_client.py");

/**
 * VPS Broker API Client path
 */
export const VPS_BROKER_PATH = getPythonScriptPath("vps_broker_api_client.py");

/**
 * Standard environment variables for Python subprocess
 * Includes PATH to ensure python executable is found
 */
export function getPythonEnv(): Record<string, string | undefined> {
  return {
    ...process.env,
    PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
  };
}

/**
 * Centralized Python configuration and path resolution
 * Provides consistent path handling across all Python integration modules
 */

import * as path from "path";
import { homedir } from "os";

/**
 * Workspace root directory - the Raycast extension root
 * Uses absolute path to workspace since it's at a known location:
 * /Users/{username}/Raycast/prospect-pipeline
 * This works correctly in both dev and production Raycast environments
 */
export const WORKSPACE_ROOT = path.join(homedir(), "Raycast", "prospect-pipeline");

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
 * Standard environment variables for Python subprocess
 * Includes PATH to ensure python executable is found
 */
export function getPythonEnv(): Record<string, string | undefined> {
  return {
    ...process.env,
    PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
  };
}

/**
 * API Layer Configuration
 */
export const API_LAYER_ROOT = path.join(WORKSPACE_ROOT, "npid-api-layer");
// Use venv python if available, otherwise system python
export const API_PYTHON_PATH = path.join(API_LAYER_ROOT, "venv", "bin", "python");
export const API_SCRIPT_PATH = "main:app"; // Uvicorn target

/**
 * Generic Python subprocess executor
 * Provides secure execution of Python scripts with proper error handling
 * Uses spawn array form (no shell: true) to eliminate command injection risks
 */

import { spawn } from "child_process";
import { PYTHON_PATH, getPythonEnv } from "./python-config";

/**
 * Options for Python script execution
 */
export interface ExecutePythonScriptOptions {
  /** Python executable path (defaults to PYTHON_PATH from config) */
  pythonPath?: string;
  /** Context name for error messages (e.g., "NPID Client", "VPS Broker") */
  contextName?: string;
  /** Timeout in milliseconds (optional) */
  timeout?: number;
}

/**
 * Execute a Python script and return parsed JSON result
 * Uses spawn with array form and shell: false to prevent command injection
 *
 * @param scriptPath - Absolute path to Python script
 * @param method - Method name (validated against method whitelist if provided)
 * @param args - Arguments object to pass to Python script as JSON
 * @param options - Execution options
 * @returns Parsed JSON response from Python script
 * @throws Error if Python script fails or returns invalid JSON
 */
export async function executePythonScript<T>(
  scriptPath: string,
  method: string,
  args: Record<string, unknown> = {},
  options: ExecutePythonScriptOptions = {}
): Promise<T> {
  const { pythonPath = PYTHON_PATH, contextName = "Python Script" } = options;

  // Validate method name to prevent command injection
  // Allow only alphanumeric, underscore, and hyphen characters
  if (!/^[a-zA-Z0-9_-]+$/.test(method)) {
    throw new Error(`Invalid method name: ${method}. Only alphanumeric, underscore, and hyphen allowed.`);
  }

  return new Promise<T>((resolve, reject) => {
    // Use array form of spawn to avoid shell interpretation
    // This prevents command injection and shell escaping issues
    const argsJson = JSON.stringify(args);
    const childProcess = spawn(pythonPath, [scriptPath, method, argsJson], {
      shell: false, // Critical for security - no shell interpretation
      env: getPythonEnv(),
    });

    let stdout = "";
    let stderr = "";

    childProcess.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    childProcess.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    childProcess.on("close", (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout);
          resolve(result as T);
        } catch (error) {
          console.error(`${contextName}: Failed to parse output`, { error, stdout: stdout.substring(0, 200) });
          reject(new Error(`${contextName}: Failed to parse output - ${error instanceof Error ? error.message : String(error)}`));
        }
      } else {
        console.error(`${contextName}: Process exited with code ${code}`, { stderr, stdout: stdout.substring(0, 200) });
        reject(new Error(`${contextName}: Process failed (exit ${code}): ${stderr || stdout.substring(0, 200)}`));
      }
    });

    childProcess.on("error", (err) => {
      console.error(`${contextName}: Spawn error`, err);
      reject(new Error(`${contextName}: Failed to spawn process - ${err.message}`));
    });
  });
}

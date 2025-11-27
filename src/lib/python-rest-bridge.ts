/**
 * Bridge for calling Python REST API client from TypeScript
 * Replaces SSE server with direct Python execution
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { homedir } from 'os';
import path from 'path';

const execAsync = promisify(exec);

// Use absolute paths since Raycast compiles to its config directory
const PROJECT_ROOT = path.join(homedir(), 'Raycast', 'prospect-pipeline');

const PYTHON_CLIENT_PATH = path.join(
  PROJECT_ROOT,
  'mcp-servers/npid-native/npid_api_client.py'
);

const PYTHON_VENV_PATH = path.join(
  PROJECT_ROOT,
  'mcp-servers/npid-native/venv/bin/python3'
);

interface RestClientResponse<T = any> {
  success?: boolean;
  error?: string;
  data?: T;
  [key: string]: any;
}

/**
 * Call Python REST client method
 * @param method - Method name (e.g., 'get_inbox_threads')
 * @param params - Method parameters as object
 * @returns Parsed JSON response
 */
export async function callRestClient<T = any>(
  method: string,
  params: Record<string, any> = {}
): Promise<T> {
  try {
    // Serialize params as JSON
    const paramsJson = JSON.stringify(params);
    const escapedParams = paramsJson.replace(/"/g, '\\"');

    // Use venv Python if available, fallback to system python3
    const pythonCmd = PYTHON_VENV_PATH;

    // Execute Python script
    const cmd = `${pythonCmd} "${PYTHON_CLIENT_PATH}" "${method}" "${escapedParams}"`;

    const { stdout, stderr } = await execAsync(cmd, {
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large responses
      timeout: 30000, // 30 second timeout
    });

    // Python client prints status messages to stderr (with emojis)
    // Only log them if there's an actual error
    if (stderr && !stderr.includes('✅') && !stderr.includes('⚠️')) {
      console.error('Python stderr:', stderr);
    }

    // Parse JSON response from stdout
    const response = JSON.parse(stdout) as RestClientResponse<T>;

    // Check for error in response
    if (response.error) {
      throw new Error(response.error);
    }

    return response as T;
  } catch (error) {
    // Handle execution errors
    if (error instanceof Error) {
      // Try to parse error output as JSON
      const execError = error as any;
      if (execError.stderr) {
        try {
          const errorData = JSON.parse(execError.stderr);
          throw new Error(errorData.error || 'Python client error');
        } catch {
          // Not JSON, use raw stderr
          throw new Error(execError.stderr || error.message);
        }
      }
      throw error;
    }
    throw new Error('Unknown error calling Python REST client');
  }
}

/**
 * Check if REST client is available
 */
export async function checkRestClientHealth(): Promise<boolean> {
  try {
    await callRestClient('login', {});
    return true;
  } catch (error) {
    console.error('REST client health check failed:', error);
    return false;
  }
}


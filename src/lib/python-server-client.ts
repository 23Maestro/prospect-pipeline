import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Response from the Python NPID server
 */
export interface PythonServerResponse<T = any> {
  id: number;
  status: 'ok' | 'error';
  message?: string;
  data?: T;
  [key: string]: any;
}

/**
 * Locate the filesystem path to the NPID Python server or its shell wrapper.
 *
 * Checks the user's home Raycast project location in this order: a shell wrapper that activates a venv, the
 * path specified by the `NPID_SERVER_PATH` environment variable (if set), the JSON-RPC API server script, and
 * a legacy simple server script. Throws if none of these candidates exist.
 *
 * @returns The filesystem path to the discovered server script or wrapper.
 * @throws Error if no valid server path is found; the error message enumerates the attempted locations.
 */
export function resolveNPIDServerPath(): string {
  const homeDir = os.homedir();
  
  // Prefer shell wrapper (handles venv activation)
  const wrapperPath = path.join(homeDir, 'Raycast/prospect-pipeline/mcp-servers/npid-native/run_server.sh');
  if (fs.existsSync(wrapperPath)) {
    return wrapperPath;
  }

  // Fallback to direct Python (may fail if venv not activated)
  const envPath = process.env.NPID_SERVER_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  // Prefer JSON-RPC API server (REST-backed)
  const apiServerPath = path.join(homeDir, 'Raycast/prospect-pipeline/mcp-servers/npid-native/npid_api_server.py');
  if (fs.existsSync(apiServerPath)) {
    return apiServerPath;
  }

  // Fallback: legacy simple server (broader legacy method coverage)
  const legacyPath = path.join(homeDir, 'Raycast/prospect-pipeline/mcp-servers/npid-native/npid_simple_server.py');
  if (fs.existsSync(legacyPath)) {
    return legacyPath;
  }

  throw new Error(
    `NPID server not found. Tried:\n` +
    `  1. Wrapper: ${wrapperPath}\n` +
    `  2. Env var: ${envPath || '(not set)'}\n` +
    `  3. API server: ${apiServerPath}\n` +
    `  4. Legacy: ${legacyPath}`
  );
}

/**
 * Calls the NPID Python server with proper timeout handling and incremental JSON parsing.
 * 
 * @param method - The Python server method to call (e.g., 'get_inbox_threads', 'search_player')
 * @param args - Arguments to pass to the method
 * @param timeoutMs - Timeout in milliseconds (default: 30000ms / 30 seconds)
 * @returns Promise that resolves with the server response
 * @throws Error if timeout occurs, process fails, or response parsing fails
 * 
 * @example
 * const result = await callPythonServer('search_player', { query: 'John Doe' });
 * if (result.status === 'ok') {
 *   console.log(result.data);
 * }
 */
export async function callPythonServer<T = any>(
  method: string,
  args: any = {},
  timeoutMs: number = 30000
): Promise<PythonServerResponse<T>> {
  const serverPath = resolveNPIDServerPath();
  const isShellWrapper = serverPath.endsWith('.sh');

  return new Promise((resolve, reject) => {
    const python = isShellWrapper 
      ? spawn('/bin/bash', [serverPath])
      : spawn('python3', [serverPath]);
    
    let output = '';
    let errorOutput = '';
    let timeoutHandle: ReturnType<typeof setTimeout>;
    let responseReceived = false;
    
    // Set timeout for the entire operation
    timeoutHandle = setTimeout(() => {
      if (!responseReceived) {
        python.kill();
        reject(new Error(
          `Python server timeout after ${timeoutMs}ms for method "${method}". ` +
          `Error log: ${errorOutput}`
        ));
      }
    }, timeoutMs);
    
    python.stdout.on('data', (data) => {
      output += data.toString();
      
      // Try to parse as soon as we have a complete JSON response
      try {
        const lines = output.trim().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            const result = JSON.parse(line);
            if (result.id === 1) {
              responseReceived = true;
              clearTimeout(timeoutHandle);
              python.kill();
              resolve(result);
              return;
            }
          }
        }
      } catch {
        // Not a complete JSON yet, keep waiting
      }
    });
    
    python.stderr.on('data', (data) => {
      errorOutput += data.toString();
      // Log stderr but don't fail on it (Python server logs to stderr)
      console.log('[Python stderr]:', data.toString());
    });
    
    python.on('error', (err) => {
      clearTimeout(timeoutHandle);
      reject(new Error(`Failed to start Python process: ${err.message}`));
    });
    
    python.on('close', (code) => {
      clearTimeout(timeoutHandle);
      if (!responseReceived) {
        if (code !== 0) {
          reject(new Error(
            `Python process exited with code ${code} for method "${method}". ` +
            `Error: ${errorOutput}`
          ));
        } else {
          reject(new Error(
            `Python process closed without response for method "${method}". ` +
            `Output: ${output}`
          ));
        }
      }
    });
    
    // Send the request
    const request = JSON.stringify({
      id: 1,
      method: method,
      arguments: args
    }) + '\n';
    
    python.stdin.write(request);
    python.stdin.end();
  });
}


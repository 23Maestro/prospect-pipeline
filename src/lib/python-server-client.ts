import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

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
 * Resolves the path to the NPID Python server script.
 * Priority: environment variable > relative path from project root
 * @throws Error if the resolved path does not exist
 */
export function resolveNPIDServerPath(): string {
  // Try environment variable first
  const envPath = process.env.NPID_SERVER_PATH;
  if (envPath) {
    if (!fs.existsSync(envPath)) {
      throw new Error(
        `NPID_SERVER_PATH environment variable is set but file not found: ${envPath}\n` +
        'Please check your environment configuration.'
      );
    }
    return envPath;
  }

  // Fall back to relative path from project root
  // __dirname in a bundled Raycast extension points to the build output
  // We need to go up from the build directory to find the project root
  const relativePath = path.resolve(
    __dirname,
    '..',
    '..',
    'mcp-servers',
    'npid-native',
    'npid_simple_server.py'
  );

  if (!fs.existsSync(relativePath)) {
    throw new Error(
      `NPID Python server not found at: ${relativePath}\n\n` +
      'Please either:\n' +
      '1. Set the NPID_SERVER_PATH environment variable to the correct path, or\n' +
      '2. Ensure the server exists at: mcp-servers/npid-native/npid_simple_server.py\n\n' +
      `Expected location: ${relativePath}`
    );
  }

  return relativePath;
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

  return new Promise((resolve, reject) => {
    const python = spawn('python3', [serverPath]);
    
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



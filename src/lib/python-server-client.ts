/**
 * NPID API Client wrapper
 * Calls Python NPID API client for athlete data operations
 */

import { executePythonScript } from "./python-executor";
import { NPID_CLIENT_PATH } from "./python-config";

/**
 * Call the NPID API Python client
 * @param method - Method name to call on the Python client
 * @param args - Arguments to pass to the method
 * @returns Parsed JSON response from Python client
 * @throws Error if the Python client fails or returns invalid JSON
 */
export async function callPythonServer<T>(
  method: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  return executePythonScript<T>(NPID_CLIENT_PATH, method, args, {
    contextName: "NPID Client",
  });
}
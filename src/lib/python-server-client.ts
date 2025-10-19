import { spawn } from "child_process";

const PYTHON_SERVER_PATH = "/Users/singleton23/Raycast/prospect-pipeline/src/python/npid_api_client.py";

export async function callPythonServer<T>(
  method: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const command = `python3 ${PYTHON_SERVER_PATH} ${method} '${JSON.stringify(args)}'`;
    const process = spawn(command, { shell: true, env: process.env });

    let stdout = "";
    let stderr = "";

    process.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    process.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    process.on("close", (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout);
          resolve(result as T);
        } catch (error) {
          console.error("Failed to parse Python script output:", error);
          reject(new Error("Failed to parse Python script output."));
        }
      } else {
        console.error(`Python script exited with code ${code}: ${stderr}`);
        reject(new Error(`Python script failed: ${stderr}`));
      }
    });

    process.on('error', (err) => {
      console.error('Spawn error:', err);
      reject(err);
    });
  });
}
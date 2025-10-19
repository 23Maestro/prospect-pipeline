import { spawn } from "child_process";

const PYTHON_PATH = "/Library/Frameworks/Python.framework/Versions/3.13/bin/python3";
const PYTHON_SERVER_PATH = "/Users/singleton23/Raycast/prospect-pipeline/src/python/npid_api_client.py";

export async function callPythonServer<T>(
  method: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const command = `${PYTHON_PATH} ${PYTHON_SERVER_PATH} ${method} '${JSON.stringify(args)}'`;
    const childProcess = spawn(command, {
      shell: true,
      env: {
        ...process.env,
        PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      }
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
          console.error("Failed to parse Python script output:", error);
          reject(new Error("Failed to parse Python script output."));
        }
      } else {
        console.error(`Python script exited with code ${code}: ${stderr}`);
        reject(new Error(`Python script failed: ${stderr}`));
      }
    });

    childProcess.on('error', (err) => {
      console.error('Spawn error:', err);
      reject(err);
    });
  });
}
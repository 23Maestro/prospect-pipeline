import { showToast, Toast } from "@raycast/api";
import { spawn } from "child_process";
import { chmod } from "fs/promises";

const PYTHON_SERVER_PATH = "/Users/singleton23/Raycast/prospect-pipeline/mcp-servers/npid-native/npid_api_client.py";

export async function callPythonServer<T>(
  method: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  try {
    await chmod(PYTHON_SERVER_PATH, "755");
  } catch (error) {
    console.error("Failed to set executable permission:", error);
    await showToast({
      style: Toast.Style.Failure,
      title: "Permission Error",
      message: "Could not set executable permission on the Python script.",
    });
    throw new Error("Could not set executable permission on the Python script.");
  }

  return new Promise<T>((resolve, reject) => {
    const process = spawn(PYTHON_SERVER_PATH, [method, JSON.stringify(args)]);

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
  });
}
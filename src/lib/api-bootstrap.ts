import { spawn } from "child_process";
import fetch from "node-fetch";
import { API_LAYER_ROOT, API_SCRIPT_PATH } from "./python-config";
import * as fs from "fs";
import * as path from "path";

const API_HEALTH_URL = "http://127.0.0.1:8000/health";

/**
 * Checks if the FastAPI server is running.
 * If not, spawns it as a detached process.
 */
export async function ensureServerRunning(): Promise<void> {
    if (await isServerUp()) {
        return;
    }

    console.log("Starting NPID API Server...");

    // Explicitly use venv Python
    const venvPython = path.join(API_LAYER_ROOT, "venv", "bin", "python");

    if (!fs.existsSync(venvPython)) {
        throw new Error(
            `Venv Python not found at ${venvPython}. Run: cd npid-api-layer && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt`
        );
    }

    // Spawn the server as a detached process
    // It will survive independent of the Raycast command lifecycle
    const child = spawn(venvPython, ["-m", "uvicorn", "main:app", "--port", "8000"], {
        cwd: API_LAYER_ROOT,
        detached: true,
        stdio: "ignore",
    });

    child.unref();

    // Wait for server to become responsive
    for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 250)); // Poll every 250ms
        if (await isServerUp()) {
            console.log("NPID API Server Started Successfully.");
            return;
        }
    }

    throw new Error("Failed to start NPID API Server within 5 seconds.");
}

async function isServerUp(): Promise<boolean> {
    try {
        const res = await fetch(API_HEALTH_URL);
        return res.ok;
    } catch (e) {
        return false;
    }
}

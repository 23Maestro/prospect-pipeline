import { Tool, showToast, Toast } from "@raycast/api";

type Input = {
  method: "manual" | "check";
};

const NOTES = [
  "Token refresh scripts are retired.",
  "Playwright logs in automatically once Docker containers are running.",
  "Use `docker compose up -d` inside scout-mcp-servers/ if you need to restart the stack.",
];

export default async function reconnect({ method }: Input) {
  await showToast({
    style: Toast.Style.Success,
    title: "NPID session handled by Playwright",
    message:
      method === "manual"
        ? "Start the Docker stack to trigger a fresh browser session."
        : "No token status to check; ensure Docker Desktop is running.",
  });

  console.log("Reconnect tool invoked", { method, notes: NOTES });
}

export const confirmation: Tool.Confirmation<Input> = async () => undefined;

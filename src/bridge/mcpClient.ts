// MCP Gateway integration for Raycast - NPID ONLY (No Asana)
import { showToast, Toast } from '@raycast/api';

const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:8812';

function resolveGatewayUrl() {
  const candidates = [
    process.env.RAYCAST_MCP_GATEWAY_URL,
    process.env.MCP_GATEWAY_BASE_URL,
    process.env.MCP_GATEWAY_URL,
  ];

  for (const candidate of candidates) {
    if (candidate && candidate.trim().length > 0) {
      const normalized = candidate.trim().replace(/\/$/, '');
      console.log('🔗 Using MCP gateway from environment:', normalized);
      return normalized;
    }
  }

  return DEFAULT_GATEWAY_URL;
}

const MCP_GATEWAY_BASE_URL = resolveGatewayUrl();
const NPID_BRIDGE_ENDPOINT = `${MCP_GATEWAY_BASE_URL}/mcp-call`;
const NPID_SERVER = 'scout-npid';

export interface MCPResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// Session management for MCP Gateway
const mcpSessionId: string | null = null;

async function initializeMCPSession(): Promise<boolean> {
  // Simple HTTP bridge - no session management needed
  return true;
}

function extractMCPResult(result: unknown): unknown {
  if (!result) {
    return null;
  }

  if (typeof result === 'string') {
    return result;
  }

  if (Array.isArray(result)) {
    if (result.length === 1) {
      return extractMCPResult(result[0]);
    }
    return result.map((item) => extractMCPResult(item));
  }

  if (typeof result === 'object') {
    const candidate = result as Record<string, unknown>;
    if (typeof candidate.text === 'string') {
      return candidate.text;
    }
    if (typeof candidate.output_text === 'string') {
      return candidate.output_text;
    }
    if (candidate.content && Array.isArray(candidate.content)) {
      return candidate.content.map((item) => extractMCPResult(item));
    }
    if ('data' in candidate) {
      return candidate.data;
    }
    return candidate;
  }

  return result;
}

async function callMCPTool(
  server: string,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<MCPResponse> {
  if (server !== NPID_SERVER) {
    return {
      success: false,
      error: `Unsupported server: ${server}`,
    };
  }

  const endpoint = NPID_BRIDGE_ENDPOINT;

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tool,
        arguments: args,
      }),
    });

    if (!response.ok) {
      throw new Error(`MCP tool error: HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (payload?.error) {
      const message = payload.error?.message || payload.error;
      return {
        success: false,
        error: typeof message === 'string' ? message : 'MCP tool call failed',
      };
    }

    const rawResult = payload?.result ?? payload?.data ?? payload;
    const extracted = extractMCPResult(rawResult);

    return {
      success: true,
      data: extracted,
    };
  } catch (error) {
    console.error(`MCP Tool Error [${server}.${tool}]`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function callNPIDTool(
  tool: string,
  args: Record<string, unknown> = {},
): Promise<MCPResponse> {
  return callMCPTool(NPID_SERVER, tool, args);
}

// Enhanced version with user feedback
export async function callNPIDToolWithFeedback(
  tool: string,
  args: Record<string, unknown> = {},
  options: {
    loadingMessage?: string;
    successMessage?: string;
    errorMessage?: string;
  } = {},
): Promise<MCPResponse> {
  const { loadingMessage, successMessage, errorMessage } = options;

  if (loadingMessage) {
    await showToast({
      style: Toast.Style.Animated,
      title: loadingMessage,
    });
  }

  const result = await callNPIDTool(tool, args);

  if (result.success) {
    if (successMessage) {
      await showToast({
        style: Toast.Style.Success,
        title: successMessage,
      });
    }
  } else {
    const error = errorMessage || `Failed to call ${tool}: ${result.error}`;
    await showToast({
      style: Toast.Style.Failure,
      title: error,
    });
  }

  return result;
}

// Player search via NPID MCP server
export async function searchPlayer(query: string) {
  return callNPIDTool('search_player', { query });
}

export async function loginNPID(email: string, password: string) {
  return callNPIDTool('login_npid', { email, password });
}

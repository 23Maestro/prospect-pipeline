/**
 * NPID Video Team Inbox Tool - SIMPLIFIED
 * Spawns Python subprocess and communicates with simple JSON protocol
 */

import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import os from 'os';

const PYTHON_SERVER_PATH = join(
  os.homedir(),
  'Raycast/prospect-pipeline/mcp-servers/npid-native/npid_api_server.py'
);

class NPIDInboxClient {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }>();

  async start() {
    if (this.process) return;

    this.process = spawn('python3', [PYTHON_SERVER_PATH], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    this.process.stdout?.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response = JSON.parse(line);
          const pending = this.pendingRequests.get(response.id);
          if (pending) {
            this.pendingRequests.delete(response.id);
            if (response.status === 'error') {
              pending.reject(new Error(response.message || 'Unknown error'));
            } else {
              pending.resolve(response);
            }
          }
        } catch (err) {
          console.error('Failed to parse response:', err);
        }
      }
    });

    this.process.on('error', (err) => {
      console.error('Python server error:', err);
    });

    this.process.on('exit', (code) => {
      console.log(`Python server exited with code ${code}`);
      this.process = null;
    });
  }

  async callTool(name: string, args: Record<string, any>): Promise<any> {
    await this.start();

    const id = ++this.requestId;
    const request = {
      id,
      method: name,
      arguments: args,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.process?.stdin?.write(JSON.stringify(request) + '\n');

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  async stop() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}

const client = new NPIDInboxClient();

export async function getInboxThreads(limit = 50): Promise<any[]> {
  const result = await client.callTool('get_inbox_threads', { limit: String(limit) });
  return result.status === 'ok' && result.threads ? result.threads : [];
}

export async function getThreadDetails(threadId: string): Promise<any> {
  const result = await client.callTool('get_thread_details', { thread_id: threadId });
  return result.status === 'ok' && result.thread ? result.thread : null;
}

export async function getAssignmentModalData(threadId: string): Promise<any> {
  const result = await client.callTool('get_assignment_modal_data', { thread_id: threadId });
  return result.status === 'ok' ? (result.modal || result) : null;
}

export async function searchPlayer(query: string): Promise<any[]> {
  const result = await client.callTool('search_player', { query });
  return result.status === 'ok' && result.results ? result.results : [];
}

export async function assignThread(params: {
  threadId: string;
  assignee: string;
  status: string;
  stage: string;
  contactId: string;
}): Promise<void> {
  await client.callTool('assign_thread', {
    thread_id: params.threadId,
    assignee: params.assignee,
    status: params.status,
    stage: params.stage,
    contact_id: params.contactId,
  });
}

export async function stopInboxClient() {
  await client.stop();
}

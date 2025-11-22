import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { Parser } from 'pickleparser';

const SESSION_PATH = join(homedir(), '.npid_session.pkl');

interface SessionData {
  cookies: Record<string, string>;
  pk?: string;
}

export function loadSession(): SessionData {
  // Read Python pickle file
  const buffer = readFileSync(SESSION_PATH);
  const parser = new Parser();
  const unpickled = parser.parse(buffer) as any;

  // RequestsCookieJar object structure from Python
  // Access the actual cookies from the jar
  const cookieJar = unpickled;
  const cookies: Record<string, string> = {};

  // Extract cookies from the pickle structure
  // The structure is: RequestsCookieJar._cookies[domain][path][cookie_name]
  if (cookieJar._cookies) {
    for (const domain in cookieJar._cookies) {
      for (const path in cookieJar._cookies[domain]) {
        for (const name in cookieJar._cookies[domain][path]) {
          const cookie = cookieJar._cookies[domain][path][name];
          cookies[name] = cookie.value;
        }
      }
    }
  }

  return { cookies };
}

export function getAuthHeaders(): Record<string, string> {
  const session = loadSession();
  const cookieString = Object.entries(session.cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

  return {
    'Cookie': cookieString,
    'User-Agent': 'Mozilla/5.0',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };
}

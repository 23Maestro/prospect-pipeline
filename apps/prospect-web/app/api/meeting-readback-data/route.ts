import { NextResponse } from 'next/server';
import { getMeetingReadbackContract } from '../../../lib/prospect-demo-data';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function GET() {
  const response = NextResponse.json(getMeetingReadbackContract());
  response.headers.set('cache-control', 'no-store, max-age=0');
  return response;
}

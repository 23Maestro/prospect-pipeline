import { prospectFetch } from '../../../lib/fastapi-client';
import { methodNotAllowed } from '../../../lib/response-shapes';

export function GET() {
  return prospectFetch('/api/v1/call-tracker/sync');
}

export function POST() {
  return prospectFetch('/api/v1/call-tracker/sync?wait=false', {
    method: 'POST',
  });
}

export function PUT(request: Request) {
  return methodNotAllowed(request.method, ['GET', 'POST']);
}

export function DELETE(request: Request) {
  return methodNotAllowed(request.method, ['GET', 'POST']);
}

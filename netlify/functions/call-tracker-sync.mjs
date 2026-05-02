import { methodNotAllowed, prospectFetch } from './_shared/prospect-api.mjs';

export default async (req) => {
  if (req.method === 'GET') {
    return prospectFetch('/api/v1/call-tracker/sync');
  }

  if (req.method !== 'POST') {
    return methodNotAllowed(req.method, ['GET', 'POST']);
  }

  return prospectFetch('/api/v1/call-tracker/sync?wait=false', {
    method: 'POST',
  });
};

export const config = {
  path: '/api/call-tracker-sync',
};

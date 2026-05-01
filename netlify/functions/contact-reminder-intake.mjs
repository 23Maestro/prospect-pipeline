import { jsonResponse, methodNotAllowed, prospectFetch } from './_shared/prospect-api.mjs';

export default async (req) => {
  if (req.method !== 'POST') {
    return methodNotAllowed(req.method, ['POST']);
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const response = await prospectFetch('/api/v1/mobile/contact-reminder-intake', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  return response;
};

export const config = {
  path: '/api/contact-reminder-intake',
};

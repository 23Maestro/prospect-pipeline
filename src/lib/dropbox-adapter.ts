import { getPreferenceValues } from '@raycast/api';

interface FileRequestResult {
  success: boolean;
  url?: string;
  id?: string;
  destination?: string;
  error?: string;
}

async function getDropboxToken(): Promise<string> {
  const { dropboxToken } = getPreferenceValues<{ dropboxToken: string }>();
  if (!dropboxToken) {
    throw new Error('Dropbox token not configured in preferences');
  }
  return dropboxToken;
}

export async function createFileRequest(athleteName: string): Promise<FileRequestResult> {
  try {
    const token = await getDropboxToken();
    const baseDestination = '/National Prospect ID';

    // Step 1: Get the correct root namespace ID for team space
    const accountResponse = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!accountResponse.ok) {
      throw new Error(`Account fetch failed: ${accountResponse.status}`);
    }

    const accountData = await accountResponse.json() as { root_info: { root_namespace_id: string } };
    const rootNamespaceId = accountData.root_info.root_namespace_id;

    console.log('✓ Root namespace ID:', rootNamespaceId);

    // Step 2: Create file request with proper team namespace routing
    const fileRequestResponse = await fetch('https://api.dropboxapi.com/2/file_requests/create', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Dropbox-API-Path-Root': JSON.stringify({
          '.tag': 'root',
          root: rootNamespaceId,
        }),
      },
      body: JSON.stringify({
        title: `${athleteName}_Videos`,
        destination: `${baseDestination}/${athleteName}`,
        open: true,
      }),
    });

    if (!fileRequestResponse.ok) {
      const error = await fileRequestResponse.json() as { error_summary?: string };
      throw new Error(`File request failed: ${error.error_summary || fileRequestResponse.status}`);
    }

    const fileRequestData = await fileRequestResponse.json() as { url: string; id: string; destination: string };

    console.log('✓ File request created successfully');
    console.log('URL:', fileRequestData.url);
    console.log('ID:', fileRequestData.id);

    return {
      success: true,
      url: fileRequestData.url,
      id: fileRequestData.id,
      destination: fileRequestData.destination,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error creating file request:', errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

export async function batchCreateFileRequests(athleteNames: string[]): Promise<Array<{ name: string } & FileRequestResult>> {
  const results: Array<{ name: string } & FileRequestResult> = [];

  for (const name of athleteNames) {
    console.log(`\nProcessing: ${name}`);
    const result = await createFileRequest(name);
    results.push({ name, ...result });

    // Rate limit protection (Dropbox allows ~1200 requests/hour)
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return results;
}

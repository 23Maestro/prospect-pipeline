declare module 'swift:../../swift/contacts' {
  export type ContactItem = {
    id: string;
    givenName: string;
    familyName: string;
    phoneNumbers: Array<{ number: string; countryCode?: string | null }>;
    imageData?: unknown;
  };

  export type SavedProspectContact = {
    status: 'created' | 'updated' | 'exists';
    groupName: string | null;
    name: string;
    phone: string;
  };

  export function fetchContactsInGroup(
    groupName: string,
    loadPhotos: boolean,
  ): Promise<ContactItem[]>;
  export function searchContacts(query: string, limit: number): Promise<ContactItem[]>;
  export function saveProspectContacts(
    firstNames: string[],
    lastNames: string[],
    phones: string[],
    urls: string[],
    notes: string[],
  ): Promise<SavedProspectContact[]>;
}

declare module 'swift:../swift/contacts' {
  export type ContactItem = {
    id: string;
    givenName: string;
    familyName: string;
    phoneNumbers: Array<{ number: string; countryCode?: string | null }>;
    imageData?: unknown;
  };

  export type SavedProspectContact = {
    status: 'created' | 'updated' | 'exists';
    groupName: string | null;
    name: string;
    phone: string;
  };

  export function searchContacts(query: string, limit: number): Promise<ContactItem[]>;
  export function saveProspectContacts(
    firstNames: string[],
    lastNames: string[],
    phones: string[],
    urls: string[],
    notes: string[],
  ): Promise<SavedProspectContact[]>;
}

declare module 'swift:../../swift/contacts' {
  export type SavedProspectContact = {
    status: 'created' | 'updated' | 'exists';
    groupName: string | null;
    name: string;
    phone: string;
  };

  export function fetchContactsInGroup(groupName: string, loadPhotos: boolean): Promise<any[]>;
  export function saveProspectContacts(
    firstNames: string[],
    lastNames: string[],
    phones: string[],
  ): Promise<SavedProspectContact[]>;
}

declare module 'swift:../swift/contacts' {
  export type SavedProspectContact = {
    status: 'created' | 'updated' | 'exists';
    groupName: string | null;
    name: string;
    phone: string;
  };

  export function saveProspectContacts(
    firstNames: string[],
    lastNames: string[],
    phones: string[],
  ): Promise<SavedProspectContact[]>;
}

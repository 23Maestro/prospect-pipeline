export function fetchContactsInGroup(groupName: string, loadPhotos: boolean): Promise<any[]>;
export function searchContacts(query: string, limit: number): Promise<any[]>;
export function saveProspectContacts(firstNames: string[], lastNames: string[], phones: string[], urls: string[], notes: string[]): Promise<any[]>;
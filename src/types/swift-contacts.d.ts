declare module 'swift:../../swift/contacts' {
  export function fetchContactsInGroup(groupName: string, loadPhotos: boolean): Promise<any[]>;
}

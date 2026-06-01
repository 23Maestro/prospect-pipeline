export async function fetchContactsInGroup(groupName, loadPhotos) {
  return await runSwiftFunction("fetchContactsInGroup", groupName, loadPhotos)
}

export async function searchContacts(query, limit) {
  return await runSwiftFunction("searchContacts", query, limit)
}

export async function saveProspectContacts(firstNames, lastNames, phones, urls, notes) {
  return await runSwiftFunction("saveProspectContacts", firstNames, lastNames, phones, urls, notes)
}
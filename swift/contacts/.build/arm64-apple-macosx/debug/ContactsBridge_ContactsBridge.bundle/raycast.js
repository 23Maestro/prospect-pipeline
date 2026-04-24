export async function fetchContactsInGroup(groupName, loadPhotos) {
  return await runSwiftFunction("fetchContactsInGroup", groupName, loadPhotos)
}
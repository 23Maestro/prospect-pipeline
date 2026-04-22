import Contacts
import RaycastSwiftMacros

struct PhoneNumber: Codable {
  let number: String
  let countryCode: String?
}

struct ContactItem: Codable {
  let id: String
  let givenName: String
  let familyName: String
  let phoneNumbers: [PhoneNumber]
  let imageData: Data?
}

enum ContactsBridgeError: Error {
  case accessDenied
}

private func requestContactAccess() async throws {
  let store = CNContactStore()

  do {
    let authorized = try await store.requestAccess(for: .contacts)
    guard authorized else {
      throw ContactsBridgeError.accessDenied
    }
  } catch {
    throw ContactsBridgeError.accessDenied
  }
}

@raycast func fetchContactsInGroup(groupName: String, loadPhotos: Bool) async throws -> [ContactItem] {
  let store = CNContactStore()
  try await requestContactAccess()

  var keys: [CNKeyDescriptor] = [
    CNContactIdentifierKey as CNKeyDescriptor,
    CNContactGivenNameKey as CNKeyDescriptor,
    CNContactFamilyNameKey as CNKeyDescriptor,
    CNContactPhoneNumbersKey as CNKeyDescriptor,
  ]

  if loadPhotos {
    keys.append(CNContactImageDataKey as CNKeyDescriptor)
  }

  let groups = try store.groups(matching: nil)
  guard let matchedGroup = groups.first(where: { $0.name.caseInsensitiveCompare(groupName) == .orderedSame }) else {
    return []
  }

  let predicate = CNContact.predicateForContactsInGroup(withIdentifier: matchedGroup.identifier)
  let contacts = try store.unifiedContacts(matching: predicate, keysToFetch: keys)

  return contacts.map { contact in
    let phoneNumbers = contact.phoneNumbers.map { cnPhoneNumber -> PhoneNumber in
      let number = cnPhoneNumber.value.stringValue
      let countryCode = cnPhoneNumber.value.value(forKey: "countryCode") as? String
      return PhoneNumber(
        number: number, countryCode: countryCode?.isEmpty ?? true ? nil : countryCode)
    }

    return ContactItem(
      id: contact.identifier,
      givenName: contact.givenName,
      familyName: contact.familyName,
      phoneNumbers: phoneNumbers,
      imageData: loadPhotos ? contact.imageData : nil
    )
  }.sorted { $0.givenName < $1.givenName }
}

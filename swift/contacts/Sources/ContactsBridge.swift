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

struct SavedProspectContact: Codable {
  let status: String
  let groupName: String?
  let name: String
  let phone: String
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

@raycast func saveProspectContacts(firstNames: [String], lastNames: [String], phones: [String]) async throws -> [SavedProspectContact] {
  let store = CNContactStore()
  try await requestContactAccess()

  let preferredGroup = try findPreferredGroup(store: store)
  let groupMemberIds = try contactIds(in: preferredGroup, store: store)
  let request = CNSaveRequest()
  var hasChanges = false
  var results: [SavedProspectContact] = []

  for index in firstNames.indices {
    guard index < lastNames.count, index < phones.count else {
      break
    }

    let firstName = firstNames[index]
    let lastName = lastNames[index]
    let phone = phones[index]
    let match = try findProspectContact(firstName: firstName, lastName: lastName, phone: phone, store: store)
    let contact: CNMutableContact
    let status: String

    switch match {
    case .samePhone(let existingContact):
      contact = existingContact.mutableCopy() as! CNMutableContact
      status = "exists"
    case .sameName(let existingContact):
      contact = existingContact.mutableCopy() as! CNMutableContact
      contact.phoneNumbers.append(CNLabeledValue(label: CNLabelPhoneNumberMobile, value: CNPhoneNumber(stringValue: phone)))
      request.update(contact)
      hasChanges = true
      status = "updated"
    case .none:
      contact = CNMutableContact()
      contact.givenName = firstName
      contact.familyName = lastName
      contact.phoneNumbers = [CNLabeledValue(label: CNLabelPhoneNumberMobile, value: CNPhoneNumber(stringValue: phone))]
      request.add(contact, toContainerWithIdentifier: nil)
      hasChanges = true
      status = "created"
    }

    if let preferredGroup, !groupMemberIds.contains(contact.identifier) {
      request.addMember(contact, to: preferredGroup)
      hasChanges = true
    }

    results.append(SavedProspectContact(
      status: status,
      groupName: preferredGroup?.name,
      name: "\(firstName) \(lastName)",
      phone: phone
    ))
  }

  if hasChanges {
    try store.execute(request)
  }

  return results
}

private enum ProspectContactMatch {
  case samePhone(CNContact)
  case sameName(CNContact)
  case none
}

private func findProspectContact(firstName: String, lastName: String, phone: String, store: CNContactStore) throws -> ProspectContactMatch {
  let keys: [CNKeyDescriptor] = [
    CNContactIdentifierKey as CNKeyDescriptor,
    CNContactGivenNameKey as CNKeyDescriptor,
    CNContactFamilyNameKey as CNKeyDescriptor,
    CNContactPhoneNumbersKey as CNKeyDescriptor,
  ]
  let predicate = CNContact.predicateForContacts(matchingName: "\(firstName) \(lastName)")
  let contacts = try store.unifiedContacts(matching: predicate, keysToFetch: keys)
  let nameMatches = contacts.filter { contact in
    contact.givenName == firstName && contact.familyName == lastName
  }

  if let phoneMatch = nameMatches.first(where: { contact in
    contact.phoneNumbers.contains(where: { labeledValue in
      labeledValue.value.stringValue == phone
    })
  }) {
    return .samePhone(phoneMatch)
  }

  if let nameMatch = nameMatches.first {
    return .sameName(nameMatch)
  }

  return .none
}

private func findPreferredGroup(store: CNContactStore) throws -> CNGroup? {
  let groups = try store.groups(matching: nil)

  if let exactMatch = groups.first(where: { $0.name == "ID Contacts" }) {
    return exactMatch
  }

  return groups.first { group in
    let name = group.name.lowercased()
    return (name.contains("prospect") && name.contains("id"))
      || name.contains("id contacts")
      || (name.contains("client") && name.contains("id"))
  }
}

private func contactIds(in group: CNGroup?, store: CNContactStore) throws -> Set<String> {
  guard let group else {
    return []
  }

  let contacts = try store.unifiedContacts(
    matching: CNContact.predicateForContactsInGroup(withIdentifier: group.identifier),
    keysToFetch: [CNContactIdentifierKey as CNKeyDescriptor]
  )
  return Set(contacts.map(\.identifier))
}

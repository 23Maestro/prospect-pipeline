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

@raycast func searchContacts(query: String, limit: Int) async throws -> [ContactItem] {
  let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !trimmedQuery.isEmpty else {
    return []
  }

  let store = CNContactStore()
  try await requestContactAccess()

  let keys: [CNKeyDescriptor] = [
    CNContactIdentifierKey as CNKeyDescriptor,
    CNContactGivenNameKey as CNKeyDescriptor,
    CNContactFamilyNameKey as CNKeyDescriptor,
    CNContactPhoneNumbersKey as CNKeyDescriptor,
  ]
  let predicate = CNContact.predicateForContacts(matchingName: trimmedQuery)
  let contacts = try store.unifiedContacts(matching: predicate, keysToFetch: keys)
  let maxResults = max(1, min(limit, 50))

  return contacts.prefix(maxResults).map { contact in
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
      imageData: nil
    )
  }.sorted {
    "\($0.givenName) \($0.familyName)" < "\($1.givenName) \($1.familyName)"
  }
}

@raycast func saveProspectContacts(firstNames: [String], lastNames: [String], phones: [String], urls: [String], notes: [String]) async throws -> [SavedProspectContact] {
  _ = notes
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
    let url = index < urls.count ? urls[index].trimmingCharacters(in: .whitespacesAndNewlines) : ""
    let match = try findProspectContact(firstName: firstName, lastName: lastName, phone: phone, store: store)
    let contact: CNMutableContact
    var status: String
    let isNewContact: Bool
    var needsUpdate = false

    switch match {
    case .samePhone(let existingContact):
      contact = existingContact.mutableCopy() as! CNMutableContact
      let backfillPlan = resolveExistingContactBackfillPlan(
        contact: existingContact,
        url: url,
        isPreferredGroupMember: preferredGroup.map { _ in groupMemberIds.contains(existingContact.identifier) } ?? true
      )
      status = backfillPlan.status
      isNewContact = false
      if backfillPlan.shouldUpdateContactUrl {
        appendHomeUrlIfMissing(url, to: contact)
        needsUpdate = true
      }
    case .sameName(let existingContact):
      contact = existingContact.mutableCopy() as! CNMutableContact
      contact.phoneNumbers.append(CNLabeledValue(label: CNLabelPhoneNumberMobile, value: CNPhoneNumber(stringValue: phone)))
      appendHomeUrlIfMissing(url, to: contact)
      status = "updated"
      isNewContact = false
      needsUpdate = true
    case .none:
      contact = CNMutableContact()
      contact.givenName = firstName
      contact.familyName = lastName
      contact.phoneNumbers = [CNLabeledValue(label: CNLabelPhoneNumberMobile, value: CNPhoneNumber(stringValue: phone))]
      appendHomeUrlIfMissing(url, to: contact)
      status = "created"
      isNewContact = true
    }

    if isNewContact {
      request.add(contact, toContainerWithIdentifier: nil)
      hasChanges = true
    } else if needsUpdate {
      request.update(contact)
      hasChanges = true
    }

    if let preferredGroup, status != "exists", !groupMemberIds.contains(contact.identifier) {
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

struct ExistingContactBackfillPlan {
  let shouldUpdateContactUrl: Bool
  let shouldAddToPreferredGroup: Bool

  var status: String {
    shouldUpdateContactUrl || shouldAddToPreferredGroup ? "updated" : "exists"
  }
}

func resolveExistingContactBackfillPlan(
  contact: CNContact,
  url: String,
  isPreferredGroupMember: Bool
) -> ExistingContactBackfillPlan {
  let trimmedUrl = url.trimmingCharacters(in: .whitespacesAndNewlines)
  let shouldUpdateContactUrl = !trimmedUrl.isEmpty && !contactHasUrl(contact, url: trimmedUrl)
  return ExistingContactBackfillPlan(
    shouldUpdateContactUrl: shouldUpdateContactUrl,
    shouldAddToPreferredGroup: !isPreferredGroupMember
  )
}

private func contactHasUrl(_ contact: CNContact, url: String) -> Bool {
  let normalizedUrl = url.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !normalizedUrl.isEmpty else {
    return true
  }

  return contact.urlAddresses.contains { labeledValue in
    String(labeledValue.value).trimmingCharacters(in: .whitespacesAndNewlines) == normalizedUrl
  }
}

private func appendHomeUrlIfMissing(_ url: String, to contact: CNMutableContact) {
  let trimmedUrl = url.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !trimmedUrl.isEmpty, !contactHasUrl(contact, url: trimmedUrl) else {
    return
  }

  contact.urlAddresses.append(CNLabeledValue(label: CNLabelHome, value: trimmedUrl as NSString))
}

private func findProspectContact(firstName: String, lastName: String, phone: String, store: CNContactStore) throws -> ProspectContactMatch {
  let keys: [CNKeyDescriptor] = [
    CNContactIdentifierKey as CNKeyDescriptor,
    CNContactGivenNameKey as CNKeyDescriptor,
    CNContactFamilyNameKey as CNKeyDescriptor,
    CNContactPhoneNumbersKey as CNKeyDescriptor,
    CNContactUrlAddressesKey as CNKeyDescriptor,
  ]
  let predicate = CNContact.predicateForContacts(matchingName: "\(firstName) \(lastName)")
  let contacts = try store.unifiedContacts(matching: predicate, keysToFetch: keys)
  let nameMatches = contacts.filter { contact in
    contact.givenName == firstName && contact.familyName == lastName
  }
  let normalizedPhone = normalizePhone(phone)

  if let phoneMatch = nameMatches.first(where: { contact in
    contactHasPhone(contact, normalizedPhone: normalizedPhone)
  }) {
    return .samePhone(phoneMatch)
  }

  if let phoneMatch = try findContactByPhone(normalizedPhone, store: store, keys: keys) {
    return .samePhone(phoneMatch)
  }

  if let nameMatch = nameMatches.first {
    return .sameName(nameMatch)
  }

  return .none
}

func contactHasPhone(_ contact: CNContact, normalizedPhone: String) -> Bool {
  contact.phoneNumbers.contains { labeledValue in
    normalizePhone(labeledValue.value.stringValue) == normalizedPhone
  }
}

func normalizePhone(_ phone: String) -> String {
  let digits = phone.filter { $0.isNumber }
  if digits.count == 11 && digits.hasPrefix("1") {
    return String(digits.dropFirst())
  }
  return digits
}

private func findContactByPhone(_ normalizedPhone: String, store: CNContactStore, keys: [CNKeyDescriptor]) throws -> CNContact? {
  guard !normalizedPhone.isEmpty else {
    return nil
  }

  var matchedContact: CNContact?
  let request = CNContactFetchRequest(keysToFetch: keys)
  try store.enumerateContacts(with: request) { contact, stop in
    if contactHasPhone(contact, normalizedPhone: normalizedPhone) {
      matchedContact = contact
      stop.pointee = true
    }
  }

  return matchedContact
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

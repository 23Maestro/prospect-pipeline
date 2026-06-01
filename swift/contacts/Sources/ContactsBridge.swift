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
  case contactNoteUpdateFailed(String)
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
  let store = CNContactStore()
  try await requestContactAccess()

  let preferredGroup = try findPreferredGroup(store: store)
  let groupMemberIds = try contactIds(in: preferredGroup, store: store)
  let request = CNSaveRequest()
  var hasChanges = false
  var results: [SavedProspectContact] = []
  var noteUpdates: [ProspectContactNoteUpdate] = []

  for index in firstNames.indices {
    guard index < lastNames.count, index < phones.count else {
      break
    }

    let firstName = firstNames[index]
    let lastName = lastNames[index]
    let phone = phones[index]
    let url = index < urls.count ? urls[index].trimmingCharacters(in: .whitespacesAndNewlines) : ""
    let note = index < notes.count ? notes[index].trimmingCharacters(in: .whitespacesAndNewlines) : ""
    let match = try findProspectContact(firstName: firstName, lastName: lastName, phone: phone, store: store)
    let contact: CNMutableContact
    let status: String
    let isNewContact: Bool
    var needsUpdate = false

    switch match {
    case .samePhone(let existingContact):
      contact = existingContact.mutableCopy() as! CNMutableContact
      status = "exists"
      isNewContact = false
    case .sameName(let existingContact):
      contact = existingContact.mutableCopy() as! CNMutableContact
      contact.phoneNumbers.append(CNLabeledValue(label: CNLabelPhoneNumberMobile, value: CNPhoneNumber(stringValue: phone)))
      status = "updated"
      isNewContact = false
      needsUpdate = true
    case .none:
      contact = CNMutableContact()
      contact.givenName = firstName
      contact.familyName = lastName
      contact.phoneNumbers = [CNLabeledValue(label: CNLabelPhoneNumberMobile, value: CNPhoneNumber(stringValue: phone))]
      status = "created"
      isNewContact = true
    }

    if !url.isEmpty {
      contact.urlAddresses = [CNLabeledValue(label: CNLabelHome, value: url as NSString)]
      needsUpdate = true
    }

    if isNewContact {
      request.add(contact, toContainerWithIdentifier: nil)
      hasChanges = true
    } else if needsUpdate {
      request.update(contact)
      hasChanges = true
    }

    if let preferredGroup, !groupMemberIds.contains(contact.identifier) {
      request.addMember(contact, to: preferredGroup)
      hasChanges = true
    }

    if !url.isEmpty || !note.isEmpty {
      noteUpdates.append(ProspectContactNoteUpdate(phone: phone, url: url, note: note))
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
  if !noteUpdates.isEmpty {
    try launchContactNotesUpdateWithContactsApp(noteUpdates, groupName: preferredGroup?.name ?? "ID Contacts")
  }

  return results
}

private struct ProspectContactNoteUpdate {
  let phone: String
  let url: String
  let note: String
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
    CNContactUrlAddressesKey as CNKeyDescriptor,
  ]
  let predicate = CNContact.predicateForContacts(matchingName: "\(firstName) \(lastName)")
  let contacts = try store.unifiedContacts(matching: predicate, keysToFetch: keys)
  let nameMatches = contacts.filter { contact in
    contact.givenName == firstName && contact.familyName == lastName
  }
  let normalizedPhone = normalizePhone(phone)

  if let phoneMatch = nameMatches.first(where: { contact in
    contact.phoneNumbers.contains(where: { labeledValue in
      normalizePhone(labeledValue.value.stringValue) == normalizedPhone
    })
  }) {
    return .samePhone(phoneMatch)
  }

  if let nameMatch = nameMatches.first {
    return .sameName(nameMatch)
  }

  return .none
}

private func normalizePhone(_ phone: String) -> String {
  return phone.filter { $0.isNumber }
}

private func launchContactNotesUpdateWithContactsApp(_ updates: [ProspectContactNoteUpdate], groupName: String) throws {
  let rows = updates
    .map { update in
      ProspectContactNoteUpdate(
        phone: normalizePhone(update.phone),
        url: update.url.trimmingCharacters(in: .whitespacesAndNewlines),
        note: update.note.trimmingCharacters(in: .whitespacesAndNewlines)
      )
    }
    .filter { !$0.phone.isEmpty && (!$0.url.isEmpty || !$0.note.isEmpty) }
  guard !rows.isEmpty else {
    return
  }

  let phoneList = rows.map { appleScriptStringLiteral($0.phone) }.joined(separator: ", ")
  let urlList = rows.map { appleScriptStringLiteral($0.url) }.joined(separator: ", ")
  let noteList = rows.map { appleScriptStringLiteral($0.note) }.joined(separator: ", ")
  let script = """
on digitsOnly(rawValue)
  set allowedCharacters to "0123456789"
  set outputValue to ""
  repeat with i from 1 to length of rawValue
    set currentCharacter to character i of rawValue
    if allowedCharacters contains currentCharacter then set outputValue to outputValue & currentCharacter
  end repeat
  if length of outputValue is 11 and outputValue starts with "1" then return text 2 thru -1 of outputValue
  return outputValue
end digitsOnly

set targetPhones to {\(phoneList)}
set targetUrls to {\(urlList)}
set targetNotes to {\(noteList)}

with timeout of 20 seconds
  tell application "Contacts"
    set targetGroup to group \(appleScriptStringLiteral(groupName))
    repeat with contactPerson in people of targetGroup
      repeat with contactPhone in phones of contactPerson
        set normalizedPhone to my digitsOnly(value of contactPhone as text)
        repeat with targetIndex from 1 to count of targetPhones
          if normalizedPhone is item targetIndex of targetPhones then
            set targetUrl to item targetIndex of targetUrls
            set targetNote to item targetIndex of targetNotes
            if targetUrl is not "" then
              set home page of contactPerson to targetUrl
              set visibleUrlUpdated to false
              repeat with contactUrl in urls of contactPerson
                if (label of contactUrl as text) is "home" then
                  set value of contactUrl to targetUrl
                  set visibleUrlUpdated to true
                  exit repeat
                end if
                if (value of contactUrl as text) is targetUrl then
                  set visibleUrlUpdated to true
                  exit repeat
                end if
              end repeat
              if visibleUrlUpdated is false then make new url at end of urls of contactPerson with properties {label:"home", value:targetUrl}
            end if
            if targetNote is not "" then
              set existingNote to note of contactPerson
              if existingNote is missing value then set existingNote to ""
              if existingNote contains targetUrl then set existingNote to ""
              if existingNote does not contain targetNote then set note of contactPerson to targetNote
            end if
          end if
        end repeat
      end repeat
    end repeat
    save
  end tell
end timeout
"""

  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
  process.arguments = ["-e", script]
  process.standardOutput = FileHandle.nullDevice
  process.standardError = FileHandle.nullDevice

  do {
    try process.run()
  } catch {
    throw ContactsBridgeError.contactNoteUpdateFailed(error.localizedDescription)
  }
}

private func appleScriptStringLiteral(_ value: String) -> String {
  return value
    .components(separatedBy: .newlines)
    .map { "\"\(escapeAppleScript($0))\"" }
    .joined(separator: " & linefeed & ")
}

private func escapeAppleScript(_ value: String) -> String {
  return value
    .replacingOccurrences(of: "\\", with: "\\\\")
    .replacingOccurrences(of: "\"", with: "\\\"")
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

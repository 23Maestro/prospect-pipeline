import Contacts
import XCTest
@testable import ContactsBridge

final class ContactsBridgeTests: XCTestCase {
  func testExistingContactBackfillPlanUpdatesMissingParams() {
    let contact = CNMutableContact()
    contact.urlAddresses = []

    let plan = resolveExistingContactBackfillPlan(
      contact: contact,
      url: "https://dashboard.nationalpid.com/athlete/123",
      isPreferredGroupMember: false
    )

    XCTAssertTrue(plan.shouldUpdateContactUrl)
    XCTAssertTrue(plan.shouldAddToPreferredGroup)
    XCTAssertEqual(plan.status, "updated")
  }

  func testExistingContactBackfillPlanLeavesCompleteContactExisting() {
    let contact = CNMutableContact()
    contact.urlAddresses = [
      CNLabeledValue(label: CNLabelHome, value: "https://dashboard.nationalpid.com/athlete/123" as NSString)
    ]

    let plan = resolveExistingContactBackfillPlan(
      contact: contact,
      url: "https://dashboard.nationalpid.com/athlete/123",
      isPreferredGroupMember: true
    )

    XCTAssertFalse(plan.shouldUpdateContactUrl)
    XCTAssertFalse(plan.shouldAddToPreferredGroup)
    XCTAssertEqual(plan.status, "exists")
  }

  func testExistingContactBackfillPlanDoesNotUseNotesForStatus() {
    let contact = CNMutableContact()
    contact.urlAddresses = [
      CNLabeledValue(label: CNLabelHome, value: "https://dashboard.nationalpid.com/athlete/123" as NSString)
    ]

    let plan = resolveExistingContactBackfillPlan(
      contact: contact,
      url: "https://dashboard.nationalpid.com/athlete/123",
      isPreferredGroupMember: true
    )

    XCTAssertFalse(plan.shouldUpdateContactUrl)
    XCTAssertFalse(plan.shouldAddToPreferredGroup)
    XCTAssertEqual(plan.status, "exists")
  }

  func testNormalizePhoneTreatsFormattedSameNumberAsExactMatch() {
    XCTAssertEqual(normalizePhone("(480) 326-1492"), "4803261492")
    XCTAssertEqual(normalizePhone("1 (480) 326-1492"), "4803261492")
  }

  func testContactHasPhoneMatchesOnlySameNormalizedNumber() {
    let contact = CNMutableContact()
    contact.phoneNumbers = [
      CNLabeledValue(label: CNLabelPhoneNumberMobile, value: CNPhoneNumber(stringValue: "(480) 326-1492"))
    ]

    XCTAssertTrue(contactHasPhone(contact, normalizedPhone: "4803261492"))
    XCTAssertFalse(contactHasPhone(contact, normalizedPhone: "4803216228"))
  }
}

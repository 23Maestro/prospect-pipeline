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
      note: "Timezone: Eastern\n\nBryson Smith",
      isPreferredGroupMember: false
    )

    XCTAssertTrue(plan.shouldUpdateContactUrl)
    XCTAssertTrue(plan.shouldAddToPreferredGroup)
    XCTAssertTrue(plan.shouldUpdateNotes)
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
      note: "",
      isPreferredGroupMember: true
    )

    XCTAssertFalse(plan.shouldUpdateContactUrl)
    XCTAssertFalse(plan.shouldAddToPreferredGroup)
    XCTAssertFalse(plan.shouldUpdateNotes)
    XCTAssertEqual(plan.status, "exists")
  }

  func testExistingContactBackfillPlanDoesNotMarkUpdatedForNoteRequestOnly() {
    let contact = CNMutableContact()
    contact.urlAddresses = [
      CNLabeledValue(label: CNLabelHome, value: "https://dashboard.nationalpid.com/athlete/123" as NSString)
    ]

    let plan = resolveExistingContactBackfillPlan(
      contact: contact,
      url: "https://dashboard.nationalpid.com/athlete/123",
      note: "Timezone: Eastern\n\nBryson Smith",
      isPreferredGroupMember: true
    )

    XCTAssertFalse(plan.shouldUpdateContactUrl)
    XCTAssertFalse(plan.shouldAddToPreferredGroup)
    XCTAssertTrue(plan.shouldUpdateNotes)
    XCTAssertEqual(plan.status, "exists")
  }
}

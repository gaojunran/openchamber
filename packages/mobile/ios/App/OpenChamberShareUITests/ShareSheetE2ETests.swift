import XCTest

/// Drives the real system share sheet — Photos → share → OpenChamber — and then asserts the
/// app came forward with the file in a new draft. It runs on a simulator, so it needs no
/// signing identity and no developer account; what it exercises is the extension the system
/// registered, the staged inbox and the app side of the hand-off.
final class ShareSheetE2ETests: XCTestCase {
    private let app = XCUIApplication()
    private let photos = XCUIApplication(bundleIdentifier: "com.apple.mobileslideshow")

    private var serverURL: String {
        ProcessInfo.processInfo.environment["E2E_SERVER_URL"] ?? "http://127.0.0.1:4123"
    }

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testSharingAPhotoOpensADraftWithTheFileAttached() throws {
        app.launch()
        connectToServer()

        XCUIDevice.shared.press(.home)
        openTheOnlyPhoto()
        tapShare()
        attachScreenshot(named: "1-share-sheet")

        let entry = shareSheetEntry(named: "OpenChamber")
        XCTAssertTrue(
            entry.waitForExistence(timeout: 30),
            "OpenChamber is not offered by the share sheet:\n\(photos.debugDescription)"
        )
        entry.tap()

        attachScreenshot(named: "2-extension-running")
        XCTAssertTrue(
            app.wait(for: .runningForeground, timeout: 90),
            "the share did not bring OpenChamber forward (the app stayed in the background)"
        )

        // The staged name comes from the provider, not from us (Photos names its own copies),
        // so the assertion is that an image attachment is on the draft, and the label is
        // reported when it is not.
        let chip = imageAttachment()
        let chipAppeared = chip.waitForExistence(timeout: 90)
        attachScreenshot(named: "3-draft")
        XCTAssertTrue(
            chipAppeared,
            "the new draft has no image attachment:\n\(app.debugDescription)"
        )
        print("E2E attached as: \(chip.label)")
    }

    // MARK: - App side

    private func connectToServer() {
        // The manual form starts collapsed because iOS supports QR pairing; the toggle is
        // part of the page, so opening it is the same path a user takes.
        let toggle = app.buttons["Connect by address"].firstMatch
        let urlField = app.textFields["Server URL"].firstMatch
        let welcome = app.staticTexts["Connect to OpenChamber"].firstMatch

        // A saved connection from an earlier run auto-connects on launch.
        guard welcome.waitForExistence(timeout: 90) else { return }
        XCTAssertTrue(urlField.waitForExistence(timeout: 60), "the connection screen did not appear")

        // The collapsed row keeps its inputs in the DOM, so hittability — not existence —
        // is what tells whether the form is open.
        if !urlField.isHittable, toggle.waitForExistence(timeout: 60) {
            toggle.tap()
        }
        let opened = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isHittable == true"), object: urlField)
        XCTAssertEqual(XCTWaiter().wait(for: [opened], timeout: 30), .completed, "the manual form did not open")

        urlField.tap()
        urlField.typeText(serverURL)
        attachScreenshot(named: "0-url-entered")
        submitConnection()

        // The welcome screen going away is the only signal that works whatever the sessions
        // list looks like.
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: welcome)
        XCTAssertEqual(
            XCTWaiter().wait(for: [gone], timeout: 180),
            .completed,
            "the app never left the connection screen:\n\(app.debugDescription)"
        )
    }

    /// On a 375x667 screen the software keyboard covers the Connect button, and the field sits
    /// in a real form, so Return submits it. Tapping Connect is the fallback once the keyboard
    /// is out of the way.
    private func submitConnection() {
        if app.keyboards.element.exists {
            app.typeText("\n")
        }
        let welcome = app.staticTexts["Connect to OpenChamber"].firstMatch
        if waitUntilGone(welcome, timeout: 30) { return }

        let connect = app.buttons["Connect"].firstMatch
        if connect.waitForExistence(timeout: 5), connect.isHittable {
            connect.tap()
        }
    }

    private func waitUntilGone(_ element: XCUIElement, timeout: TimeInterval) -> Bool {
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: element)
        return XCTWaiter().wait(for: [gone], timeout: timeout) == .completed
    }

    // MARK: - Photos side

    private func openTheOnlyPhoto() {
        photos.launch()
        XCTAssertTrue(photos.wait(for: .runningForeground, timeout: 60))
        dismissOnboarding()
        attachScreenshot(named: "photos-launch")

        let cell = photos.cells.firstMatch
        if cell.waitForExistence(timeout: 30) {
            cell.tap()
            return
        }

        // iOS 18 does not always expose the grid as cells; the top-left tile is where the
        // library starts, so a tap there is the same user action either way.
        photos.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.2)).tap()
        attachScreenshot(named: "photos-after-tap")
    }

    /// A fresh simulator can open Photos on its "what's new" sheet, which hides the grid.
    private func dismissOnboarding() {
        for label in ["Continue", "Get Started", "Not Now", "Done"] {
            let button = photos.buttons[label].firstMatch
            if button.waitForExistence(timeout: 5) {
                button.tap()
            }
        }
    }

    private func tapShare() {
        let byLabel = photos.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'share'")).firstMatch
        if byLabel.waitForExistence(timeout: 30) {
            byLabel.tap()
            return
        }
        // The photo viewer sometimes exposes the action behind the "more" bar button.
        let more = photos.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'more'")).firstMatch
        XCTAssertTrue(more.exists, "no share control in the photo viewer:\n\(photos.debugDescription)")
        more.tap()
    }

    /// The activity row is a cell on some iOS versions and a button or static text on others,
    /// so this matches the label wherever it is exposed.
    private func shareSheetEntry(named name: String) -> XCUIElement {
        let activities = photos.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", name))
        return activities.element(boundBy: 0)
    }

    // MARK: - Evidence

    private func imageAttachment() -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(
            format: "label CONTAINS[c] '.png' OR label CONTAINS[c] '.jpg' OR label CONTAINS[c] '.jpeg' OR label CONTAINS[c] '.heic'"
        )).element(boundBy: 0)
    }

    private func attachScreenshot(named name: String) {
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}

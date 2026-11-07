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
        if toggle.waitForExistence(timeout: 60) {
            toggle.tap()
        }

        let urlField = app.textFields["Server URL"].firstMatch
        XCTAssertTrue(
            urlField.waitForExistence(timeout: 120),
            "the connection screen did not appear:\n\(app.debugDescription)"
        )
        urlField.tap()
        urlField.typeText(serverURL)

        let connect = app.buttons["Connect"].firstMatch
        XCTAssertTrue(connect.exists, "no Connect button:\n\(app.debugDescription)")
        connect.tap()
        attachScreenshot(named: "0-connecting")

        // The welcome screen going away is the only signal that works whatever the sessions
        // list looks like.
        let welcome = app.staticTexts["Connect to OpenChamber"].firstMatch
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: welcome)
        XCTAssertEqual(
            XCTWaiter().wait(for: [gone], timeout: 180),
            .completed,
            "the app never left the connection screen:\n\(app.debugDescription)"
        )
    }

    // MARK: - Photos side

    private func openTheOnlyPhoto() {
        photos.launch()
        XCTAssertTrue(photos.wait(for: .runningForeground, timeout: 60))
        dismissOnboarding()

        let cell = photos.cells.firstMatch
        if cell.waitForExistence(timeout: 30) {
            cell.tap()
            return
        }
        let image = photos.images.firstMatch
        XCTAssertTrue(
            image.waitForExistence(timeout: 30),
            "Photos shows no photo (was the image added to the simulator?):\n\(photos.debugDescription)"
        )
        image.tap()
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

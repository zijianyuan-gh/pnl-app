import XCTest

/// End-to-end tests of the real iOS app in the Simulator. They drive the bundled web UI through
/// the accessibility tree (what VoiceOver sees), and use native system UI (share sheet, Files
/// picker, Face ID). CI seeds the app's Documents folder with a synthetic PWA backup first
/// (see .github/workflows/ci-deploy.yml, job "ios"). Tests run in name order and share state.
final class AppUITests: XCTestCase {
    private var app: XCUIApplication!
    private let env = ProcessInfo.processInfo.environment

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        // Synthetic PWA backup (CI: TEST_RUNNER_DEMO_JSON); the Debug app writes it to Documents
        if let seed = env["DEMO_JSON"] { app.launchEnvironment["DAYBOOK_UITEST_SEED_JSON"] = seed }
    }

    /// On any failure keep a screenshot and the accessibility tree (CI publishes them).
    override func record(_ issue: XCTIssue) {
        var issue = issue
        if let app = app {
            let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            shot.name = "FAIL-\(name)-screen"
            shot.lifetime = .keepAlways
            issue.add(shot)
            let tree = XCTAttachment(string: String(app.debugDescription.prefix(200_000)))
            tree.name = "FAIL-\(name)-tree"
            tree.lifetime = .keepAlways
            issue.add(tree)
        }
        super.record(issue)
    }

    // MARK: - Helpers

    private var web: XCUIElement { app.webViews.firstMatch }
    private func button(_ label: String) -> XCUIElement { web.buttons[label].firstMatch }
    private func text(_ label: String) -> XCUIElement { web.staticTexts[label].firstMatch }
    private func textContaining(_ s: String) -> XCUIElement {
        web.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", s)).firstMatch
    }

    @discardableResult
    private func wait(_ e: XCUIElement, _ timeout: TimeInterval = 20, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        XCTAssertTrue(e.waitForExistence(timeout: timeout), "Not found: \(e)", file: file, line: line)
        return e
    }

    private func launchAndWait() {
        app.launch()
        wait(button("Calendar"), 30)
    }

    private func tab(_ name: String) {
        button(name).tap()
        Thread.sleep(forTimeInterval: 0.6)
    }

    /// Scroll the current screen until the element can be tapped.
    private func reveal(_ e: XCUIElement, up: Bool = true) {
        var tries = 0
        while !(e.exists && e.isHittable) && tries < 12 {
            if up { web.swipeUp() } else { web.swipeDown() }
            tries += 1
        }
    }

    private func shot(_ name: String) {
        let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }

    private func dismissSystemAlertIfPresent() {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for label in ["OK", "Allow"] where springboard.buttons[label].waitForExistence(timeout: 2) {
            springboard.buttons[label].tap()
            return
        }
    }

    // MARK: - 1. A backup made by the PWA restores on a fresh install (migration path)

    func test1_restoresExistingPWABackupOnFirstLaunch() throws {
        app.launch()
        // CI placed a synthetic PWA backup in Documents; the app database is empty → offer it
        wait(textContaining("Restore your data?"), 30)
        wait(textContaining("120 trades"))
        button("Restore").tap()
        let balance = env["DEMO_BALANCE"] ?? "$46,864.59"
        wait(text(balance))

        // Quit and relaunch: data is still there, and no second prompt
        app.terminate()
        launchAndWait()
        wait(text(balance))
        XCTAssertFalse(textContaining("Restore your data?").exists)
    }

    // MARK: - 2. App Store screenshots (English + 简体中文)

    func test2_screenshots() throws {
        launchAndWait()
        shot("en-1-calendar")

        button("Add").tap()
        // the amount field is focused and the decimal keypad is up right away (keyboard priming)
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10), "keyboard did not appear")
        app.typeText("128.40")
        web.radioButtons["Loss"].firstMatch.tap()
        Thread.sleep(forTimeInterval: 0.8)
        shot("en-2-quick-add")
        button("Cancel").tap()
        // the half-typed entry is kept as a draft; discard it so later tests start clean
        button("Add").tap()
        if button("Discard").waitForExistence(timeout: 3) { button("Discard").tap() }
        button("Cancel").tap()

        tab("Trades"); shot("en-3-trades")
        tab("Analytics"); shot("en-4-analytics")
        tab("Accounts"); shot("en-5-accounts")

        // Chinese UI
        let zh = web.radioButtons["中文"].firstMatch
        reveal(zh)
        zh.tap()
        wait(button("日历"))
        tab("日历"); shot("zh-1-calendar")
        tab("统计"); shot("zh-4-analytics")
        tab("账户")
        let en = web.radioButtons["EN"].firstMatch
        reveal(en)
        en.tap()
        wait(button("Calendar"))
        tab("Calendar")
    }

    // MARK: - 3. Record a trade (no network involved) and keep it across a relaunch

    func test3_recordsTradeAndKeepsItAfterRelaunch() throws {
        launchAndWait()
        tab("Accounts")
        wait(textContaining("Running as the iOS app"))
        tab("Calendar")

        button("Add").tap()
        if button("Discard").waitForExistence(timeout: 2) { button("Discard").tap() }
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10), "keyboard did not appear")
        app.typeText("1234.56")
        wait(textContaining("+$1,234.56"))
        button("Save").tap()
        wait(textContaining("Saved +$1,234.56"), 10)
        wait(text("+$1,234.56"))

        app.terminate()
        launchAndWait()
        wait(text("+$1,234.56"))
    }

    // MARK: - 4. Export opens the system share sheet with "Save to Files"

    func test4_exportOpensShareSheet() throws {
        launchAndWait()
        tab("Accounts")
        let export = button("Export full backup (JSON)")
        reveal(export)
        export.tap()
        let saveToFiles = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] %@", "Save to Files")).firstMatch
        XCTAssertTrue(saveToFiles.waitForExistence(timeout: 15), "share sheet without Save to Files")
        shot("en-6-share-sheet")
        // close without saving
        if app.buttons["Close"].exists { app.buttons["Close"].tap() } else { app.swipeDown(velocity: .fast) }
        XCTAssertTrue(wait(button("Calendar")).exists)
    }

    // MARK: - 5. Restore picks a backup from Files (no duplicates on merge)

    func test5_restorePicksBackupFromFiles() throws {
        launchAndWait()
        tab("Accounts")
        let row = button("Restore from backup")
        reveal(row)
        row.tap()
        // the sheet's file button has the same label; it is the only hittable one now
        wait(web.buttons.matching(NSPredicate(format: "label == %@", "Restore from backup")).firstMatch).tap()

        // System Files picker: Browse → On My iPhone → Daybook → the PWA backup
        let browse = app.buttons["Browse"].firstMatch
        if browse.waitForExistence(timeout: 10) { browse.tap() }
        let onMyIPhone = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "On My iPhone")).firstMatch
        if onMyIPhone.waitForExistence(timeout: 5) { onMyIPhone.tap() }
        let folder = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Daybook")).firstMatch
        if folder.waitForExistence(timeout: 5) { folder.tap() }
        let file = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "PWA backup")).firstMatch
        guard file.waitForExistence(timeout: 10) else {
            throw XCTSkip("Could not navigate the system Files picker in this simulator; the picker opened but the file could not be selected by automation.")
        }
        file.tap()

        wait(textContaining("Checksum verified (SHA-256)"), 15)
        web.radioButtons.matching(NSPredicate(format: "label BEGINSWITH %@", "Merge into current data")).firstMatch.tap()
        web.buttons["Merge into current data"].firstMatch.tap()
        // everything in the file is already here → nothing added, nothing duplicated
        wait(textContaining("Merged: 0 added · 0 updated · 0 deleted"), 10)
    }

    // MARK: - 6. App Lock with Face ID (CI enrolls Face ID and keeps "matching" in the background)

    func test6_appLockWithFaceID() throws {
        guard env["FACEID"] == "1" else { throw XCTSkip("Face ID simulation not enabled") }
        launchAndWait()
        tab("Accounts")
        // WebKit exposes <input role="switch"> as a switch (or a checkbox on older iOS)
        let toggle = web.switches["App Lock"].firstMatch
        reveal(toggle)
        XCTAssertTrue(toggle.waitForExistence(timeout: 10), "App Lock switch not found (is biometry/passcode available?)")
        toggle.tap()
        dismissSystemAlertIfPresent() // "Allow Daybook to use Face ID?"
        wait(textContaining("App Lock is on"), 20)

        // Leave and come back: locked, then Face ID unlocks
        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 1.5)
        app.activate()
        let locked = textContaining("Daybook is locked")
        XCTAssertTrue(locked.waitForExistence(timeout: 5), "lock screen did not appear")
        let gone = NSPredicate(format: "exists == false")
        expectation(for: gone, evaluatedWith: locked)
        waitForExpectations(timeout: 25)
        wait(button("Calendar"))

        // Relaunch: still locked until authenticated
        app.terminate()
        app.launch()
        XCTAssertTrue(textContaining("Daybook is locked").waitForExistence(timeout: 15))
        expectation(for: gone, evaluatedWith: textContaining("Daybook is locked"))
        waitForExpectations(timeout: 25)

        // Turn it off again
        tab("Accounts")
        reveal(toggle)
        toggle.tap()
        wait(textContaining("App Lock is off"), 20)
    }
}

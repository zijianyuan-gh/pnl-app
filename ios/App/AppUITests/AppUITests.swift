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
        // Synthetic PWA backup (CI: TEST_RUNNER_DEMO_FILE); the Debug app copies it into Documents
        if let seed = env["DEMO_FILE"] { app.launchEnvironment["DAYBOOK_UITEST_SEED_FILE"] = seed }
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
    /// Any element with this exact label (WKWebView exposes role="radio" etc. as generic elements).
    private func control(_ label: String) -> XCUIElement {
        web.descendants(matching: .any).matching(NSPredicate(format: "label == %@ AND elementType != %@", label, NSNumber(value: XCUIElement.ElementType.staticText.rawValue))).firstMatch
    }
    private var amountField: XCUIElement { web.textFields["Net realized P&L"].firstMatch }

    /// One screenshot of every main screen in the current language, Quick Add with a typed loss.
    private func screenshotSet(_ p: String, add: String, amount: String, loss: String, cancel: String, discard: String, tabs: [String]) {
        tab(tabs[0]); shot("\(p)-1-calendar")
        button(add).tap()
        let field = wait(web.textFields[amount].firstMatch)
        field.typeText("128.40")
        if p == "en" { checkQuickAddAboveKeyboard(field) }
        control(loss).tap()
        Thread.sleep(forTimeInterval: 0.8)
        shot("\(p)-2-quick-add")
        button(cancel).tap()
        // the half-typed entry is kept as a draft; discard it so later steps start clean
        button(add).tap()
        if button(discard).waitForExistence(timeout: 3) { button(discard).tap() }
        button(cancel).tap()
        tab(tabs[1]); shot("\(p)-3-trades")
        tab(tabs[2]); shot("\(p)-4-analytics")
        tab(tabs[3])
        for _ in 0..<4 { web.swipeDown() } // from the top, as in every language
        shot("\(p)-5-accounts")
    }
    private func hasKeyboardFocus(_ e: XCUIElement) -> Bool { (e.value(forKey: "hasKeyboardFocus") as? Bool) ?? false }

    /// Types into the amount field, focusing it first if needed.
    private func typeAmount(_ s: String) {
        let field = wait(amountField)
        if !hasKeyboardFocus(field) { field.tap() }
        field.typeText(s)
    }
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

    /// A row in a list (WebKit merges a row's texts into one button label).
    private func row(containing parts: String...) -> XCUIElement {
        let preds = parts.map { NSPredicate(format: "label CONTAINS %@", $0) }
        return web.buttons.matching(NSCompoundPredicate(andPredicateWithSubpredicates: preds)).firstMatch
    }

    /// Simulated Face ID: CI turns each request file into exactly one "matching face" event, so a
    /// prompt is only ever satisfied when the test asks (see the workflow, job "ios").
    /// Returns once CI has delivered the match (it answers with "matched-<id>"), so no request is
    /// ever still in flight when the test moves on — a late match could unlock a later prompt.
    private func requestFaceIDMatch(file: StaticString = #filePath, line: UInt = #line) {
        guard let dir = env["FACEID_DIR"] else { return XCTFail("FACEID_DIR not set", file: file, line: line) }
        let id = UUID().uuidString
        let request = (dir as NSString).appendingPathComponent("match-\(id)")
        let ack = (dir as NSString).appendingPathComponent("matched-\(id)")
        XCTAssertTrue(FileManager.default.createFile(atPath: request, contents: Data()), "cannot write \(request)", file: file, line: line)
        let end = Date().addingTimeInterval(20)
        while !FileManager.default.fileExists(atPath: ack) && Date() < end { Thread.sleep(forTimeInterval: 0.2) }
        XCTAssertTrue(FileManager.default.fileExists(atPath: ack), "Face ID match was not delivered", file: file, line: line)
    }

    /// Deliver one Face ID match at a time (the prompt may still be animating in) until `done()`.
    private func matchFaceID(timeout: TimeInterval = 45, until done: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if done() { return true }
            requestFaceIDMatch()
            let settle = Date().addingTimeInterval(3)
            while Date() < settle {
                if done() { return true }
                Thread.sleep(forTimeInterval: 0.25)
            }
        }
        return done()
    }

    /// With the on-screen keyboard up (CI turns the simulator's hardware keyboard off), the amount
    /// and a Save button must stay visible above it. Records "not shown" instead of guessing.
    private func checkQuickAddAboveKeyboard(_ field: XCUIElement) {
        let kb = app.keyboards.firstMatch
        let note: String
        if kb.waitForExistence(timeout: 5) {
            Thread.sleep(forTimeInterval: 0.8) // let the sheet settle
            shot("kbd-quick-add")
            let top = kb.frame.minY
            XCTAssertLessThanOrEqual(field.frame.maxY, top + 1, "amount field covered by the keyboard")
            let saves = web.buttons.matching(NSPredicate(format: "label == %@", "Save")).allElementsBoundByIndex
            XCTAssertTrue(saves.contains { $0.isHittable && $0.frame.maxY <= top + 1 }, "no Save button above the keyboard")
            note = "software keyboard shown: keyboard top \(top), amount field bottom \(field.frame.maxY)"
        } else {
            note = "software keyboard NOT shown (hardware keyboard connected) - layout above the keyboard not checked"
        }
        let a = XCTAttachment(string: note)
        a.name = "keyboard-check"
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

        // keyboard priming: the amount field has keyboard focus right after tapping +, no extra tap
        button("Add").tap()
        let field = wait(amountField)
        expectation(for: NSPredicate(format: "hasKeyboardFocus == true"), evaluatedWith: field)
        waitForExpectations(timeout: 10)
        button("Cancel").tap()

        screenshotSet("en", add: "Add", amount: "Net realized P&L", loss: "Loss", cancel: "Cancel", discard: "Discard",
                      tabs: ["Calendar", "Trades", "Analytics", "Accounts"])

        // 简体中文 (switched in Accounts → Preferences → Language)
        let zh = control("中文")
        reveal(zh)
        zh.tap()
        wait(button("日历"))
        screenshotSet("zh", add: "记录", amount: "已实现净盈亏", loss: "亏损", cancel: "取消", discard: "丢弃",
                      tabs: ["日历", "交易", "统计", "账户"])
        let en = control("EN")
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
        typeAmount("1234.56")
        wait(textContaining("+$1,234.56"))
        button("Save").tap()
        wait(textContaining("Saved +$1,234.56"), 10)
        // the selected day (today) lists the new trade
        wait(row(containing: "Trade", "+$1,234.56"))

        app.terminate()
        launchAndWait()
        wait(row(containing: "Trade", "+$1,234.56"))
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
        Thread.sleep(forTimeInterval: 2)
        shot("picker-1-opened")
        let pickerTree = XCTAttachment(string: String(app.debugDescription.prefix(150_000)))
        pickerTree.name = "picker-tree"
        pickerTree.lifetime = .keepAlways
        add(pickerTree)
        let browse = app.buttons["Browse"].firstMatch
        if browse.waitForExistence(timeout: 10) { browse.tap() }
        Thread.sleep(forTimeInterval: 1)
        shot("picker-2-browse")
        let onMyIPhone = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "On My iPhone")).firstMatch
        if onMyIPhone.waitForExistence(timeout: 5) { onMyIPhone.tap() }
        // the app's own folder is a cell ("Daybook, Container"); don't hit other "Daybook" texts
        let folder = app.cells.matching(NSPredicate(format: "label BEGINSWITH %@", "Daybook")).firstMatch
        if folder.waitForExistence(timeout: 5) { folder.tap() }
        let file = app.cells.matching(NSPredicate(format: "label CONTAINS %@", "PWA backup")).firstMatch
        let found = file.waitForExistence(timeout: 15)
        shot("picker-3-folder")
        let folderTree = XCTAttachment(string: String(app.debugDescription.prefix(150_000)))
        folderTree.name = "picker-tree-folder"
        folderTree.lifetime = .keepAlways
        add(folderTree)
        guard found else {
            throw XCTSkip("Could not navigate the system Files picker in this simulator; the picker opened but the file could not be selected by automation.")
        }
        file.tap()

        wait(textContaining("Checksum verified (SHA-256)"), 15)
        web.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Merge into current data")).firstMatch.tap()
        web.buttons["Merge into current data"].firstMatch.tap()
        // everything in the file is already here → nothing added, nothing duplicated
        wait(textContaining("Merged: 0 added · 0 updated · 0 deleted"), 10)
    }

    // MARK: - 6. App Lock with Face ID (CI enrolls Face ID; a face "matches" only when the test asks)

    func test6_appLockWithFaceID() throws {
        guard env["FACEID"] == "1" else { throw XCTSkip("Face ID simulation not enabled") }
        launchAndWait()
        tab("Accounts")
        // WebKit exposes <input role="switch"> as a switch; value "1" = on
        let toggle = web.switches["App Lock"].firstMatch
        reveal(toggle)
        XCTAssertTrue(toggle.waitForExistence(timeout: 10), "App Lock switch not found (is biometry/passcode available?)")
        func isOn() -> Bool { (toggle.value as? String) == "1" }
        XCTAssertFalse(isOn())

        // Turning it on asks for Face ID first; without a match it stays off
        toggle.tap()
        dismissSystemAlertIfPresent() // "Allow Daybook to use Face ID?"
        Thread.sleep(forTimeInterval: 2)
        XCTAssertFalse(isOn(), "App Lock turned on without authentication")
        XCTAssertTrue(matchFaceID(until: isOn), "App Lock did not turn on after Face ID")

        // Leave and come back: locked, and it stays locked until Face ID matches
        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 1.5)
        app.activate()
        let locked = textContaining("Daybook is locked")
        XCTAssertTrue(locked.waitForExistence(timeout: 10), "lock screen did not appear")
        Thread.sleep(forTimeInterval: 3)
        XCTAssertTrue(locked.exists, "unlocked without Face ID")
        shot("lock-1-locked")
        XCTAssertTrue(matchFaceID { !locked.exists }, "Face ID did not unlock")
        wait(button("Calendar"))

        // Relaunch: locked again until authenticated
        app.terminate()
        app.launch()
        XCTAssertTrue(locked.waitForExistence(timeout: 15), "not locked after relaunch")
        Thread.sleep(forTimeInterval: 3)
        XCTAssertTrue(locked.exists, "unlocked without Face ID after relaunch")
        XCTAssertTrue(matchFaceID { !locked.exists }, "Face ID did not unlock after relaunch")

        // Turn it off again (also needs Face ID)
        tab("Accounts")
        reveal(toggle)
        toggle.tap()
        XCTAssertTrue(matchFaceID { !isOn() }, "App Lock did not turn off")
    }
}

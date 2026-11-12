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
        // more files for Documents: a tampered backup and a CSV (CI: TEST_RUNNER_DEMO_DIR)
        if let dir = env["DEMO_DIR"] { app.launchEnvironment["DAYBOOK_UITEST_SEED_DIR"] = dir }
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
        let sheet = wait(entrySheet)
        let field = wait(web.textFields[amount].firstMatch)
        field.typeText("128.40")
        if p == "en" { checkQuickAddAboveKeyboard(field) }
        // the Loss option inside this sheet (not a same-named control elsewhere on the page)
        let lossOption = sheet.descendants(matching: .any).matching(NSPredicate(format: "label == %@ AND elementType != %@", loss, NSNumber(value: XCUIElement.ElementType.staticText.rawValue))).firstMatch
        wait(lossOption).tap()
        let selectedEnd = Date().addingTimeInterval(5)
        while !isSelected(lossOption) && Date() < selectedEnd { Thread.sleep(forTimeInterval: 0.2) }
        XCTAssertTrue(isSelected(lossOption), "\(loss) was not selected")
        Thread.sleep(forTimeInterval: 0.5)
        shot("\(p)-2-quick-add")
        button(cancel).tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: sheet)
        waitForExpectations(timeout: 10)
        // the half-typed entry is kept as a draft; discard it so later steps start clean
        button(add).tap()
        if button(discard).waitForExistence(timeout: 3) { button(discard).tap() }
        button(cancel).tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: entrySheet)
        waitForExpectations(timeout: 10)
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
        let calendar = button("Calendar"), locked = textContaining("Daybook is locked"), chinese = button("日历")
        let end = Date().addingTimeInterval(30)
        while Date() < end && !calendar.exists && !locked.exists && !chinese.exists { Thread.sleep(forTimeInterval: 0.5) }
        // Only when an earlier test failed half-way (that failure is reported there), so this one
        // starts from the usual state instead of failing too: App Lock left on, or the UI left in 中文.
        if locked.exists && env["FACEID"] == "1" { _ = matchFaceID { !locked.exists } }
        if chinese.exists && !calendar.exists {
            tab("账户")
            let en = control("EN")
            reveal(en)
            en.tap()
        }
        wait(calendar, 30)
    }

    /// The open Quick Add sheet ("New entry" / "新记录").
    private var entrySheet: XCUIElement {
        web.descendants(matching: .any).matching(NSPredicate(format: "label ENDSWITH %@", "web dialog")).firstMatch
    }

    private func isSelected(_ e: XCUIElement) -> Bool {
        (e.value as? String) == "1" || (e.value as? NSNumber)?.intValue == 1
    }

    /// Back from the Home Screen. On a slow CI machine the first activation can be lost.
    private func bringAppBack(file: StaticString = #filePath, line: UInt = #line) {
        app.activate()
        if !app.wait(for: .runningForeground, timeout: 15) { app.activate() }
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 15), "the app did not come back to the foreground", file: file, line: line)
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

    private func attachTree(_ name: String) {
        let a = XCTAttachment(string: String(app.debugDescription.prefix(150_000)))
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }

    /// Counts shown under "Last backup" in Accounts, e.g. "3 accounts · 121 trades · 1 transfer".
    private func dataSummary() -> String { wait(textContaining("accounts · ")).label }

    /// In a system Files sheet (picker or "Save to Files"): Browse → On My iPhone → Daybook folder.
    private func goToDaybookFolder() {
        let browse = app.buttons["Browse"].firstMatch
        if browse.waitForExistence(timeout: 10) { browse.tap() }
        Thread.sleep(forTimeInterval: 1)
        let onMyIPhone = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "On My iPhone")).firstMatch
        if onMyIPhone.waitForExistence(timeout: 5) { onMyIPhone.tap() }
        // the app's own folder ("Daybook, Container") — never a file whose name starts with "Daybook"
        let folder = app.cells.matching(NSPredicate(format: "label BEGINSWITH %@ AND identifier CONTAINS %@", "Daybook", "Container")).firstMatch
        if folder.waitForExistence(timeout: 5) { folder.tap() }
        Thread.sleep(forTimeInterval: 1)
    }

    /// The Files picker is open: choose the file whose name contains `name` until `opened` appears.
    private func pickFile(_ name: String, until opened: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        Thread.sleep(forTimeInterval: 2)
        goToDaybookFolder()
        let cell = app.cells.matching(NSPredicate(format: "label CONTAINS %@", name)).firstMatch
        let found = cell.waitForExistence(timeout: 15)
        shot("picker-\(name)")
        if !found { attachTree("picker-tree-\(name)") }
        XCTAssertTrue(found, "\(name) not shown in the Files picker", file: file, line: line)
        // a tap during the folder's push animation can be ignored: tap until the picker closes
        for _ in 0..<4 where cell.exists && !opened.exists {
            if cell.isHittable { cell.tap() }
            _ = opened.waitForExistence(timeout: 4)
        }
        wait(opened, 15, file: file, line: line)
    }

    private func openRestorePicker() {
        tab("Accounts")
        let row = button("Restore from backup")
        reveal(row)
        row.tap()
        // the sheet's file button has the same label; the screen behind the sheet is hidden from VoiceOver
        wait(web.buttons.matching(NSPredicate(format: "label == %@", "Restore from backup")).firstMatch).tap()
    }

    /// Restore sheet with a verified file: choose "Merge" (its label also carries the help text) and run it.
    private func mergeRestore() {
        let option = web.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@ AND label != %@", "Merge into current data", "Merge into current data")).firstMatch
        if option.exists { option.tap() }
        web.buttons["Merge into current data"].firstMatch.tap()
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
        Thread.sleep(forTimeInterval: 2) // the whole page re-renders in the new language
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

    // MARK: - 4. Export opens the system share sheet; cancelling records no backup; links open Safari

    func test4_exportShareSheetAndExternalLinks() throws {
        launchAndWait()
        tab("Accounts")
        let export = button("Export full backup (JSON)")
        reveal(export)
        export.tap()
        let saveToFiles = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] %@", "Save to Files")).firstMatch
        XCTAssertTrue(saveToFiles.waitForExistence(timeout: 15), "share sheet without Save to Files")
        shot("en-6-share-sheet")
        // close without saving: not counted as a backup
        if app.buttons["Close"].exists { app.buttons["Close"].tap() } else { app.swipeDown(velocity: .fast) }
        wait(button("Calendar"))
        XCTAssertTrue(text("Never").exists, "a cancelled export was recorded as a backup")

        // About → Privacy Policy opens in Safari: the app itself never browses the web
        let privacy = control("Privacy Policy")
        reveal(privacy)
        privacy.tap()
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 20), "Privacy Policy did not open in Safari")
        Thread.sleep(forTimeInterval: 3) // let the app switch finish before the screenshot
        shot("link-1-safari")
        bringAppBack()
        wait(button("Accounts"))
        XCTAssertTrue(control("Privacy Policy").exists, "the app navigated away from its own screen")
    }

    // MARK: - 5. Restore picks a backup from Files (no duplicates on merge)

    func test5_restorePicksBackupFromFiles() throws {
        launchAndWait()
        tab("Accounts")
        let before = dataSummary()
        openRestorePicker()
        pickFile("PWA backup", until: textContaining("Checksum verified (SHA-256)"))
        shot("restore-1-verified")
        mergeRestore()
        // everything in the file is already here → nothing added, nothing duplicated
        wait(textContaining("Merged: 0 added · 0 updated · 0 deleted"), 10)
        XCTAssertEqual(dataSummary(), before)
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

        // Leave and come back (3 times, right after the previous unlock — the timing that once
        // slipped through): locked every time, and it stays locked until Face ID matches
        let locked = textContaining("Daybook is locked")
        for round in 1...3 {
            XCUIDevice.shared.press(.home)
            Thread.sleep(forTimeInterval: 1.5)
            bringAppBack()
            XCTAssertTrue(locked.waitForExistence(timeout: 10), "lock screen did not appear (round \(round))")
            Thread.sleep(forTimeInterval: 3)
            XCTAssertTrue(locked.exists, "unlocked without Face ID (round \(round))")
            if round == 1 { shot("lock-1-locked") }
            XCTAssertTrue(matchFaceID { !locked.exists }, "Face ID did not unlock (round \(round))")
        }
        wait(button("Calendar"))

        // Relaunch: locked again until authenticated
        app.terminate()
        app.launch()
        XCTAssertTrue(locked.waitForExistence(timeout: 15), "not locked after relaunch")
        Thread.sleep(forTimeInterval: 3)
        XCTAssertTrue(locked.exists, "unlocked without Face ID after relaunch")
        XCTAssertTrue(matchFaceID { !locked.exists }, "Face ID did not unlock after relaunch")

        // Turn it off again (also needs Face ID). The first tap can land while the system Face ID
        // sheet is still going away, so make sure the Accounts screen is really open.
        wait(button("Calendar"))
        Thread.sleep(forTimeInterval: 1)
        for _ in 0..<3 where !button("New account").exists { tab("Accounts"); _ = button("New account").waitForExistence(timeout: 3) }
        wait(button("New account"))
        reveal(toggle)
        toggle.tap()
        XCTAssertTrue(matchFaceID { !isOn() }, "App Lock did not turn off")
    }

    // MARK: - 7. Export → "Save to Files" → the file is in Files and restores (round trip)

    func test7_exportSavedToFilesRestores() throws {
        launchAndWait()
        tab("Accounts")
        let before = dataSummary()
        let export = button("Export full backup (JSON)")
        reveal(export)
        export.tap()
        let saveToFiles = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] %@", "Save to Files")).firstMatch
        XCTAssertTrue(saveToFiles.waitForExistence(timeout: 15), "share sheet without Save to Files")
        saveToFiles.tap()
        Thread.sleep(forTimeInterval: 2)
        shot("save-1-opened")
        goToDaybookFolder()
        // the Files sheet's own Save (outside the web view)
        var save = app.navigationBars.buttons["Save"].firstMatch
        if !save.waitForExistence(timeout: 10) { save = app.buttons.matching(NSPredicate(format: "label == %@", "Save")).firstMatch }
        let canSave = save.waitForExistence(timeout: 5)
        shot("save-2-folder")
        if !canSave { attachTree("save-tree") }
        XCTAssertTrue(canSave, "Save to Files: no Save button")
        save.tap()
        wait(textContaining("Backup exported"), 15)
        XCTAssertFalse(text("Never").exists, "the completed export was not recorded as a backup")

        // the saved file is in Files → On My iPhone → Daybook and passes the checksum
        openRestorePicker()
        pickFile("daybook-backup-", until: textContaining("Checksum verified (SHA-256)"))
        mergeRestore()
        wait(textContaining("Merged: 0 added · 0 updated · 0 deleted"), 10)
        XCTAssertEqual(dataSummary(), before)
    }

    // MARK: - 8. A tampered backup is refused and nothing changes

    func test8_tamperedBackupIsRefused() throws {
        launchAndWait()
        tab("Accounts")
        let before = dataSummary()
        openRestorePicker()
        pickFile("tampered", until: textContaining("Nothing was restored"))
        shot("restore-2-tampered-refused")
        XCTAssertFalse(web.buttons["Merge into current data"].exists, "a refused file can still be restored")
        XCTAssertFalse(web.buttons["Replace all current data"].exists, "a refused file can still be restored")
        button("Close").tap()
        XCTAssertEqual(dataSummary(), before)
        // and still the same after a relaunch
        app.terminate()
        launchAndWait()
        tab("Accounts")
        XCTAssertEqual(dataSummary(), before)
    }

    // MARK: - 9. CSV import through the Files picker

    func test9_csvImportThroughFilesPicker() throws {
        launchAndWait()
        tab("Accounts")
        let before = dataSummary()
        let row = button("Import CSV")
        reveal(row)
        row.tap()
        wait(button("Choose a CSV file")).tap()
        let run = web.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Import (")).firstMatch
        pickFile("Daybook import", until: run)
        shot("csv-1-preview")
        XCTAssertEqual(run.label, "Import (2)")
        run.tap()
        wait(textContaining("Imported 2 trades"), 10)
        XCTAssertNotEqual(dataSummary(), before)
        tab("Calendar")
        wait(self.row(containing: "CSVTEST", "+$77.77"))
        wait(self.row(containing: "CSVTEST", "−$11.11"))
    }

    // MARK: - Z. After the app is installed again over itself (= an update), everything is still there

    /// Run by CI in a second xcodebuild invocation, which reinstalls the app over the existing
    /// installation (same as an App Store update: the app bundle is replaced, the data is kept).
    func testZ_dataSurvivesReinstall() throws {
        guard env["AFTER_REINSTALL"] == "1" else { throw XCTSkip("only after CI reinstalls the app") }
        launchAndWait()
        // the database was not empty → no recovery prompt
        XCTAssertFalse(textContaining("Restore your data?").waitForExistence(timeout: 3), "data was lost on reinstall")
        tab("Accounts")
        // 120 restored + 1 recorded (test 3) + 2 imported from CSV (test 9)
        XCTAssertEqual(dataSummary(), "3 accounts · 123 trades · 1 transfer")
        shot("update-1-data-kept")
        tab("Calendar")
        wait(row(containing: "Trade", "+$1,234.56"))
        wait(row(containing: "CSVTEST", "+$77.77"))
    }
}

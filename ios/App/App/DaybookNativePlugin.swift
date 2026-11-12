import Foundation
import Capacitor
import UIKit
import UniformTypeIdentifiers
import LocalAuthentication

/// Native services for the Daybook web app. Everything stays on the device: no network,
/// no analytics, no data leaves the app unless the user shares a file themselves.
@objc(DaybookNativePlugin)
public class DaybookNativePlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
    public let identifier = "DaybookNativePlugin"
    public let jsName = "DaybookNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "shareFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "biometry", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPrivacyCover", returnType: CAPPluginReturnPromise),
    ]

    static let snapshotName = "Daybook Auto-Backup.json"
    static let previousSnapshotName = "Daybook Auto-Backup (previous day).json"
    static let privacyCoverKey = "daybook.privacyCover"
    private static let maxImportBytes = 50 * 1024 * 1024

    private var pickCall: CAPPluginCall?

    // MARK: - Share sheet (export)

    /// Writes the text to a temporary file and presents the iOS share sheet
    /// ("Save to Files", AirDrop, …). Resolves { completed, activityType }.
    @objc func shareFile(_ call: CAPPluginCall) {
        guard let name = call.getString("name"), let text = call.getString("text") else {
            call.reject("name and text are required")
            return
        }
        let safeName = name.replacingOccurrences(of: "/", with: "-")
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let url = dir.appendingPathComponent(safeName)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try Data(text.utf8).write(to: url, options: [.atomic, .completeFileProtection])
        } catch {
            call.reject("Could not prepare the file: \(error.localizedDescription)")
            return
        }
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else {
                call.reject("No view controller")
                return
            }
            let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            sheet.completionWithItemsHandler = { activityType, completed, _, error in
                try? FileManager.default.removeItem(at: dir)
                if let error = error {
                    call.reject(error.localizedDescription)
                } else {
                    call.resolve(["completed": completed, "activityType": activityType?.rawValue ?? ""])
                }
            }
            if let pop = sheet.popoverPresentationController {
                pop.sourceView = vc.view
                pop.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 1, height: 1)
                pop.permittedArrowDirections = []
            }
            vc.present(sheet, animated: true)
        }
    }

    // MARK: - Document picker (import)

    /// Lets the user pick a backup (kind "json") or a spreadsheet export (kind "csv") from Files.
    /// Resolves { cancelled: true } or { name, text, size }.
    @objc func pickFile(_ call: CAPPluginCall) {
        let kind = call.getString("kind") ?? "json"
        var types: [UTType] = kind == "csv"
            ? [.commaSeparatedText, .tabSeparatedText, .delimitedText, .plainText]
            : [.json, .plainText]
        if kind != "csv", let t = UTType(filenameExtension: "json") { types.append(t) }
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else {
                call.reject("No view controller")
                return
            }
            self.pickCall?.resolve(["cancelled": true])
            self.pickCall = call
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
            picker.delegate = self
            picker.allowsMultipleSelection = false
            picker.presentationController?.delegate = self
            vc.present(picker, animated: true)
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pickCall else { return }
        pickCall = nil
        guard let url = urls.first else {
            call.resolve(["cancelled": true])
            return
        }
        do {
            let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
            let size = (attrs[.size] as? NSNumber)?.intValue ?? 0
            if size > Self.maxImportBytes {
                call.reject("too_large")
                return
            }
            let data = try Data(contentsOf: url)
            guard let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .utf16) else {
                call.reject("not_text")
                return
            }
            call.resolve(["name": url.lastPathComponent, "text": text, "size": size])
        } catch {
            call.reject("read_failed")
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pickCall?.resolve(["cancelled": true])
        pickCall = nil
    }

    public func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        pickCall?.resolve(["cancelled": true])
        pickCall = nil
    }

    // MARK: - Automatic backup copy (Files → On My iPhone → Daybook)

    private func documentsURL() throws -> URL {
        try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    }

    /// Atomically replaces the automatic backup file. Once per calendar day the previous file is
    /// kept as "(previous day)", so a bad day can never overwrite the only good copy.
    @objc func writeSnapshot(_ call: CAPPluginCall) {
        guard let text = call.getString("text") else {
            call.reject("text is required")
            return
        }
        do {
            let docs = try documentsURL()
            let current = docs.appendingPathComponent(Self.snapshotName)
            let previous = docs.appendingPathComponent(Self.previousSnapshotName)
            let fm = FileManager.default
            if let attrs = try? fm.attributesOfItem(atPath: current.path),
               let modified = attrs[.modificationDate] as? Date,
               !Calendar.current.isDateInToday(modified) {
                try? fm.removeItem(at: previous)
                try fm.copyItem(at: current, to: previous)
            }
            let data = Data(text.utf8)
            try data.write(to: current, options: [.atomic])
            call.resolve(["bytes": data.count])
        } catch {
            call.reject("Could not write the automatic backup: \(error.localizedDescription)")
        }
    }

    /// Resolves { text, modifiedAt, previousText, previousModifiedAt } (nulls when absent).
    @objc func readSnapshot(_ call: CAPPluginCall) {
        do {
            let docs = try documentsURL()
            func read(_ name: String) -> (String?, Double?) {
                let url = docs.appendingPathComponent(name)
                guard let data = try? Data(contentsOf: url), let text = String(data: data, encoding: .utf8) else { return (nil, nil) }
                let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
                let modified = (attrs?[.modificationDate] as? Date).map { $0.timeIntervalSince1970 * 1000 }
                return (text, modified)
            }
            let (text, modified) = read(Self.snapshotName)
            let (prev, prevModified) = read(Self.previousSnapshotName)
            func orNull(_ v: Any?) -> Any { v ?? NSNull() }
            call.resolve([
                "text": orNull(text),
                "modifiedAt": orNull(modified),
                "previousText": orNull(prev),
                "previousModifiedAt": orNull(prevModified),
            ])
        } catch {
            call.resolve(["text": NSNull(), "modifiedAt": NSNull(), "previousText": NSNull(), "previousModifiedAt": NSNull()])
        }
    }

    // MARK: - App lock (Face ID / Touch ID / passcode)

    /// Resolves { available, biometry: "faceID" | "touchID" | "opticID" | "none" }.
    /// `available` means the device can authenticate the owner (biometrics or passcode).
    @objc func biometry(_ call: CAPPluginCall) {
        let ctx = LAContext()
        var err: NSError?
        let available = ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err)
        _ = ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        var type = "none"
        switch ctx.biometryType {
        case .faceID: type = "faceID"
        case .touchID: type = "touchID"
        default:
            if #available(iOS 17.0, *), ctx.biometryType == .opticID { type = "opticID" }
        }
        call.resolve(["available": available, "biometry": type])
    }

    /// Face ID / Touch ID with the device passcode as fallback. Resolves { success, error? }.
    @objc func authenticate(_ call: CAPPluginCall) {
        let reason = call.getString("reason") ?? "Unlock Daybook"
        let ctx = LAContext()
        ctx.localizedCancelTitle = call.getString("cancelTitle")
        ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, error in
            if success {
                call.resolve(["success": true])
            } else {
                var name = "failed"
                if let code = (error as? LAError)?.code {
                    switch code {
                    case .userCancel, .systemCancel, .appCancel: name = "cancelled"
                    case .passcodeNotSet: name = "passcode_not_set"
                    case .biometryLockout: name = "lockout"
                    default: name = "failed"
                    }
                }
                call.resolve(["success": false, "error": name])
            }
        }
    }

    /// When enabled, the app switcher shows a plain cover instead of a snapshot of your trades.
    @objc func setPrivacyCover(_ call: CAPPluginCall) {
        UserDefaults.standard.set(call.getBool("enabled") ?? false, forKey: Self.privacyCoverKey)
        call.resolve()
    }
}

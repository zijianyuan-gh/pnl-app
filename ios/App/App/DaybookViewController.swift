import UIKit
import Capacitor

/// Hosts the bundled web app (capacitor://localhost, served from the app bundle — never from the
/// network), registers the Daybook native plugin, and keeps the status bar readable on the dark UI.
class DaybookViewController: CAPBridgeViewController {
    private let daybook = DaybookNativePlugin()
    private var cover: UIView?
    /// Back from the background with App Lock on: keep the cover until the lock screen is drawn.
    private var holdCoverUntilLocked = false
    private var coverGeneration = 0

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(daybook)
        NSLog("Daybook: native plugin registered")
        #if DEBUG
        seedForUITests()
        #endif
        view.backgroundColor = UIColor(red: 10 / 255, green: 10 / 255, blue: 11 / 255, alpha: 1)
        webView?.isOpaque = false
        webView?.backgroundColor = view.backgroundColor
        webView?.scrollView.backgroundColor = view.backgroundColor

        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(willResignActive), name: UIApplication.willResignActiveNotification, object: nil)
        nc.addObserver(self, selector: #selector(didBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        nc.addObserver(self, selector: #selector(didEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        nc.addObserver(self, selector: #selector(lockShown), name: DaybookNativePlugin.lockShownNotification, object: nil)
    }

    // Status bar: light content on the dark UI, set in Info.plist (UIStatusBarStyle) because
    // CAPBridgeViewController's preferredStatusBarStyle cannot be overridden from this module.

    /// With App Lock on, hide the content before iOS takes the app-switcher snapshot.
    @objc private func willResignActive() {
        guard UserDefaults.standard.bool(forKey: DaybookNativePlugin.privacyCoverKey), cover == nil else { return }
        let v = UIView(frame: view.bounds)
        v.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        v.backgroundColor = view.backgroundColor
        let icon = UIImageView(image: UIImage(named: "LaunchIcon"))
        icon.contentMode = .scaleAspectFit
        icon.frame = CGRect(x: 0, y: 0, width: 96, height: 96)
        icon.center = CGPoint(x: v.bounds.midX, y: v.bounds.midY)
        icon.autoresizingMask = [.flexibleLeftMargin, .flexibleRightMargin, .flexibleTopMargin, .flexibleBottomMargin]
        v.addSubview(icon)
        view.addSubview(v)
        cover = v
        coverGeneration += 1
    }

    /// App Lock on: ask the web app to lock now, while iOS is moving it to the background.
    @objc private func didEnterBackground() {
        guard UserDefaults.standard.bool(forKey: DaybookNativePlugin.privacyCoverKey) else { return }
        holdCoverUntilLocked = true
        daybook.requestLock()
    }

    @objc private func lockShown() {
        removeCover()
    }

    private func removeCover() {
        holdCoverUntilLocked = false
        cover?.removeFromSuperview()
        cover = nil
    }

    #if DEBUG
    /// UI tests only (compiled out of Release/App Store builds): place a backup file in Documents
    /// exactly where a user's saved backup / the automatic copy would be. Never overwrites a file.
    private func seedForUITests() {
        guard let path = ProcessInfo.processInfo.environment["DAYBOOK_UITEST_SEED_FILE"], !path.isEmpty else { return }
        guard let data = FileManager.default.contents(atPath: path),
              let docs = try? FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        else {
            NSLog("Daybook UITest seed: cannot read %@", path)
            return
        }
        for name in [DaybookNativePlugin.snapshotName, "Daybook PWA backup.json"] {
            let url = docs.appendingPathComponent(name)
            if !FileManager.default.fileExists(atPath: url.path) {
                try? data.write(to: url, options: .atomic)
                NSLog("Daybook UITest seed: wrote %@ (%d bytes)", name, data.count)
            }
        }
    }
    #endif

    @objc private func didBecomeActive() {
        guard holdCoverUntilLocked else { return removeCover() }
        // the web app answers with lockShown; never keep the cover longer than 2 s
        let generation = coverGeneration
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            guard let self = self, self.holdCoverUntilLocked, self.coverGeneration == generation else { return }
            self.removeCover()
        }
    }
}

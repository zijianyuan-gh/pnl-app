import UIKit
import Capacitor

/// Hosts the bundled web app (capacitor://localhost, served from the app bundle — never from the
/// network), registers the Daybook native plugin, and keeps the status bar readable on the dark UI.
class DaybookViewController: CAPBridgeViewController {
    private var cover: UIView?

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(DaybookNativePlugin())
        view.backgroundColor = UIColor(red: 10 / 255, green: 10 / 255, blue: 11 / 255, alpha: 1)
        webView?.isOpaque = false
        webView?.backgroundColor = view.backgroundColor
        webView?.scrollView.backgroundColor = view.backgroundColor

        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(willResignActive), name: UIApplication.willResignActiveNotification, object: nil)
        nc.addObserver(self, selector: #selector(didBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

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
    }

    @objc private func didBecomeActive() {
        cover?.removeFromSuperview()
        cover = nil
    }
}

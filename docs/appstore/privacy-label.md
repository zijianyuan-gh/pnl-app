# App Privacy ("nutrition label") answers

App Store Connect → App Privacy → Get Started:

- **Do you or your third-party partners collect data from this app?** → **No, we do not collect data from this app.**
  Result shown on the App Store: **Data Not Collected**.

Why this is accurate:
- All records are stored only on the device (local database in the app; automatic backup file in the app's Documents folder).
- The iOS app makes no network requests of its own (its web content is bundled; production builds carry a Content-Security-Policy with `connect-src 'self'`, verified by automated tests). The Privacy Policy and Support links open in Safari only when the user taps them.
- No third-party SDKs (no analytics, ads, crash reporting, attribution).
- Face ID / Touch ID results are evaluated by iOS (LocalAuthentication); the app receives only success/failure.
- Files the user exports leave the app only through the iOS share sheet, by the user's choice.

Other App Store Connect answers:
- **Privacy Policy URL:** https://zijianyuan-gh.github.io/pnl-app/privacy.html (also linked in the app: Accounts → About → Privacy Policy).
- **Export compliance:** `ITSAppUsesNonExemptEncryption = NO` is set in Info.plist (the app uses only SHA-256 hashing for integrity checks and iOS's built-in protections), so no export documentation is needed.
- **Tracking (App Tracking Transparency):** not used; the app does not track.
- **Account deletion (5.1.1(v)):** not applicable — the app has no accounts. All data can be erased in the app (Accounts → Erase all data).

## Privacy manifest (`ios/App/App/PrivacyInfo.xcprivacy`)
Required for uploads since 2024 (otherwise App Store Connect rejects the build with ITMS-91053). It is bundled in the app (CI checks the Release archive) and matches the answers above:
- `NSPrivacyTracking` = false, no tracking domains, no collected data types.
- Required-reason APIs used by Daybook's own native code: **UserDefaults** — reason `CA92.1` (only remembers whether the App Lock privacy cover is on); **File timestamp** — reason `C617.1` (modification date of the automatic backup file in the app's own Documents folder).
- Capacitor ships its own manifest inside its framework.

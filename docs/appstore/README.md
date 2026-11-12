# Daybook for iOS — App Store package

Everything needed to submit Daybook to the App Store, except what only the account owner can do (Apple Developer membership, signing, uploading, submitting). Nothing has been signed, uploaded or submitted.

| File | Use |
| --- | --- |
| `metadata-en.md`, `metadata-zh-Hans.md` | Name, subtitle, keywords, promotional text, description, What's New, URLs, category, age rating |
| `review-notes.md` | Paste into App Review Information → Notes |
| `privacy-label.md` | App Privacy questionnaire answers (Data Not Collected), export compliance |
| `guidelines.md` | How the app addresses Guidelines 3.2.1(viii), 5.1.1(ix), 4.1, 4.2, 4.3, 5.1 |
| `screenshots/en/`, `screenshots/zh-Hans/` | Real screenshots of the iOS app, taken by the UI tests in the iOS Simulator (iPhone 17 Pro Max = 6.9" display, 1320 × 2868), synthetic demo data. Refresh: `python3 scripts/ios-appstore-screenshots.py <exported attachments>` (CI publishes them on the `ios-ci-output` branch) |
| Privacy policy | https://zijianyuan-gh.github.io/pnl-app/privacy.html (source: `public/privacy.html`) |
| Support page | https://zijianyuan-gh.github.io/pnl-app/support.html (source: `public/support.html`) |

**Identity:** App name "Daybook: P&L Trading Journal" (home-screen name "Daybook"), Bundle ID `io.github.zijianyuangh.daybook`, version 1.2.0 (build 1), iPhone only, iOS 15+, category Finance.
The Bundle ID can still be changed before the first upload (edit `scripts/ios-project.rb` + `capacitor.config.ts`, run `ruby scripts/ios-project.rb`) — never after.

## Readiness checklist

| Requirement | Status |
| --- | --- |
| Xcode project builds for device (Release, arm64) | ✅ CI: unsigned archive on every push |
| App works offline, bundled content, no remote URL | ✅ CI checks the bundle and config |
| App icon 1024 × 1024, no alpha; launch screen | ✅ |
| Privacy manifest (`PrivacyInfo.xcprivacy`) in the app | ✅ CI checks the Release archive |
| Only permission: Face ID usage description | ✅ unit test |
| Export compliance (`ITSAppUsesNonExemptEncryption = NO`) | ✅ |
| Privacy policy URL + link inside the app; support URL | ✅ live, checked by CI |
| Metadata EN + 简体中文, keywords, review notes, App Privacy answers | ✅ this folder |
| Screenshots 6.9" (1320 × 2868), EN + 简体中文 | ✅ `screenshots/` |
| iPhone app also runs on iPad (compatibility mode, Guideline 2.4.1) | ✅ CI launches it on an iPad simulator |
| Signing team, App Store Connect record, upload, TestFlight, review | ⏳ needs your Apple Developer membership |
| Your contact for App Review, copyright holder name | ⏳ fill in when submitting |

## What the owner has to do (once)

1. **Join the Apple Developer Program** (paid, yearly) with your Apple ID. An individual membership is fine for a personal record-keeping app (see `guidelines.md`).
2. **On a Mac with Xcode 26** (free from the Mac App Store):
   ```bash
   git clone https://github.com/zijianyuan-gh/pnl-app && cd pnl-app && npm ci && npm run ios:sync && npm run ios:open
   ```
   In Xcode: select the **App** target → *Signing & Capabilities* → tick *Automatically manage signing* → choose your **Team**. Xcode creates the certificate and the App ID for you.
3. **Try it on your iPhone first:** plug the iPhone in, select it as the run destination, press ▶︎ (or use TestFlight after step 4). Go through the 8-step checklist in `../iPhone安装与验收指南.md`, using the iOS app.
4. **Upload:** *Product → Archive* → *Distribute App* → *App Store Connect* → *Upload*. For every later upload run `npm run ios:version` first (build number must increase).
5. **App Store Connect** (https://appstoreconnect.apple.com): *Apps → +* → New App with the Bundle ID above; paste the metadata, upload `screenshots/en` (English) and `screenshots/zh-Hans` (Simplified Chinese localization) to the 6.9" iPhone slot, set the Privacy Policy URL, answer App Privacy with `privacy-label.md`, paste `review-notes.md` with your contact, choose the uploaded build, *Submit for Review*.

Nobody else should need your Apple ID password, certificates or keys; don't share them.

## Moving data from the web app (PWA) to the iOS app

The web app and the iOS app keep separate storage on the iPhone. Installing or updating one never deletes the other's data.

1. In the web app (Home Screen icon): **Accounts → Export full backup (JSON) → Save to Files** (e.g. iCloud Drive).
2. Open the iOS app → **Accounts → Restore from backup** → pick the file → check "Checksum verified (SHA-256)" and the counts → **Replace all current data** (empty app) or **Merge**.
3. Compare the balance and a few trades with the web app. If the restore fails nothing is changed; if you change your mind right away, tap **Undo**.
4. Keep the web app until you are satisfied; erase it later with **Accounts → Erase all data** in the web app if you want.

## Status
See the bottom of the main `README.md` ("iOS app — what is verified").

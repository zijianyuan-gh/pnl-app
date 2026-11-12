# App Review Guidelines — how Daybook addresses them

Checked against Apple's App Review Guidelines page, "Last Updated: October 16, 2026" (fetched 2026-11-12). Re-read the live page before submitting; wording changes.

| Guideline | What it asks | How Daybook complies | Residual risk |
| --- | --- | --- | --- |
| **3.2.1(viii)** | "Apps used for financial trading, investing, or money management should be submitted by the financial institution performing such services…" | Daybook performs none of these services. It is a manual journal: no broker/exchange/bank connection, no order execution, no custody or movement of money, no advice or signals. Stated in the description, the review notes, the in-app About text and the support page. | A reviewer may still ask. Answer with the review notes; do not rename the category or hide what the app is. |
| **5.1.1(ix)** | Apps providing services in highly regulated fields (banking and financial services, …) should come from a legal entity providing the services. | Same as above — Daybook provides record-keeping, not a regulated service. Comparable personal-finance trackers are published by individual developers. | Low–medium. An organization developer account is not required for a journal, but Apple decides. |
| **3.2.2(viii)** | No binary-options facilitation; CFD/forex must be licensed. | Daybook facilitates no trading at all. | None. |
| **4.1 Copycats** | Don't copy another app's name, icon, UI or brand. | Original name ("Daybook"), original icon and UI. The idea of a P&L calendar is common; nothing is copied from any specific app. Metadata names no other app. | Low. Keep competitor names out of keywords/descriptions. |
| **4.2 Minimum functionality** | "…elevate it beyond a repackaged website." | Fully offline app with bundled code (no website loaded); native Files picker, share sheet, automatic backup file visible in Files, Face ID / Touch ID App Lock with app-switcher privacy cover; no browsing UI or links except privacy/support. | Medium for any web-technology app. Mention the native features in the review notes (done). |
| **4.3 Spam** | One Bundle ID per app; don't submit something indistinguishable from what's widely available. | Single Bundle ID `io.github.zijianyuangh.daybook`. Distinguishing features: exact-cent accounting, separate trade/day win rates, transfer vs. P&L separation, verified backups, privacy (no data collected). | Low–medium (journals are a crowded category). |
| **5.1.1(i)** | Privacy policy linked in App Store Connect **and** inside the app. | https://zijianyuan-gh.github.io/pnl-app/privacy.html; in app: Accounts → About → Privacy Policy. Explains retention and deletion. | None. |
| **5.1.1(ii)/(v)** | Consent for data collection; account deletion if accounts exist. | No data collected; no accounts. "Erase all data" in the app. | None. |
| **5.1.2** | No sharing of personal data without permission; ATT for tracking. | Nothing is shared or tracked; exports happen only via the user's own share-sheet action. | None. |
| **2.3.x Accurate metadata** | Screenshots show the app in use; no misleading claims. | Screenshots are taken from the actual app in the iOS Simulator by the UI tests (synthetic demo data). App Lock is described as a screen lock, not encryption. | None. |
| **5.6 / Developer Code of Conduct** | Honest representation. | Description states what the app does and does not do. | — |

Practical advice for submission:
- Choose **Finance** as the primary category — it is the accurate one. Don't pick another category to avoid finance scrutiny.
- In App Review Information, paste `review-notes.md` and give a reachable contact.
- If Apple raises 3.2.1(viii) or 5.1.1(ix), reply in Resolution Center that the app is a personal record-keeping tool that performs no financial service, and point to the notes above.

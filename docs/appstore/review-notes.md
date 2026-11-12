# App Review Information — Notes for the reviewer

Paste the text between the lines into App Store Connect → App Review Information → Notes, unchanged. No demo account is needed (leave "Sign-in required" off). The reviewer contact (name, phone, e-mail) goes in the separate *Contact Information* fields of the same page, from your developer account — it is not part of these notes.

---

Daybook is a personal trading journal. People type in the results (profit or loss) of trades they made elsewhere and review them on a calendar and in statistics — like a spreadsheet or an expense tracker for trading results.

What Daybook is NOT (re. Guidelines 3.2.1(viii) and 5.1.1(ix)): it does not connect to any broker, exchange, bank or wallet; it does not execute, route or facilitate trades; it does not hold, move or manage money; it provides no investment advice, signals or recommendations; it has no in-app purchases or links to financial services. All numbers are the user's own manual records.

No sign-in is required. The app makes no network requests of its own (its content is bundled in the app); only the Privacy Policy and Support links in Accounts → About open in Safari when tapped. It collects no data ("Data Not Collected").

How to try it (about 2 minutes):
1. Tap "Create your first account", enter a name (e.g. "Stocks") and a starting balance, tap "New account".
2. Tap the + button, type an amount, choose Profit or Loss, tap Save. The day turns green or red on the Calendar.
3. Analytics tab: win rates, averages, best/worst day, charts.
4. Accounts → "Export full backup (JSON)" opens the iOS share sheet ("Save to Files").
5. Accounts → "Restore from backup" opens the Files picker; a backup is verified (SHA-256) before anything is restored.
6. Optional: Accounts → Preferences → App Lock (Face ID / Touch ID / passcode). Turning it on asks for authentication first.

Native iOS functionality (Guideline 4.2): works fully offline from first launch; native Files document picker and share sheet; an automatic backup file the user can see in Files → On My iPhone → Daybook; Face ID / Touch ID App Lock with an app-switcher privacy cover; VoiceOver labels on controls; native status bar and safe-area handling.

Permissions: Face ID usage description only (for the optional App Lock). No camera, photos, location, contacts, tracking or notifications.

---

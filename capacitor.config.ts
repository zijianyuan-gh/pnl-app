import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Native iOS shell. The production web build (dist/) is copied INTO the app bundle by
 * `npx cap sync ios` and served from capacitor://localhost — the app never loads the
 * website, so it works fully offline from the first launch.
 */
const config: CapacitorConfig = {
  appId: 'io.github.zijianyuangh.daybook',
  appName: 'Daybook',
  webDir: 'dist',
  ios: {
    scheme: 'Daybook',
    contentInset: 'never', // the web layout handles safe areas itself (viewport-fit=cover)
    backgroundColor: '#0a0a0b',
    scrollEnabled: false, // screens scroll inside the app; no whole-page rubber-banding
    allowsLinkPreview: false,
    limitsNavigationsToAppBoundDomains: false,
  },
  // No server.url: never point the app at a remote site.
};

export default config;

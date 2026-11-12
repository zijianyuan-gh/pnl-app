import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Native project invariants that must hold for every build (checked on Linux, no Xcode needed). */
const plist = readFileSync('ios/App/App/Info.plist', 'utf8');
const pbx = readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const capConfig = readFileSync('capacitor.config.ts', 'utf8');
const key = (k: string) => new RegExp(`<key>${k}</key>\\s*<(true|false)/>`).exec(plist)?.[1];

describe('iOS app configuration', () => {
  it('asks for no permission except Face ID (used only by the optional App Lock)', () => {
    const usage = [...plist.matchAll(/<key>(NS\w+UsageDescription)<\/key>/g)].map((m) => m[1]);
    expect(usage).toEqual(['NSFaceIDUsageDescription']);
    for (const banned of ['UIBackgroundModes', 'NSAppTransportSecurity', 'NSUserTrackingUsageDescription']) expect(plist).not.toContain(banned);
  });

  it('declares export compliance and Files visibility for the automatic backup', () => {
    expect(key('ITSAppUsesNonExemptEncryption')).toBe('false');
    expect(key('UIFileSharingEnabled')).toBe('true');
    expect(key('LSSupportsOpeningDocumentsInPlace')).toBe('true');
  });

  it('loads the bundled web build, never a remote server', () => {
    expect(capConfig).toContain("webDir: 'dist'");
    expect(capConfig).not.toMatch(/server\s*:\s*\{[^}]*url/);
    expect(capConfig).not.toMatch(/https?:\/\/(?!capacitorjs)/);
  });

  it('bundle id, version and build are consistent', () => {
    const ids = [...pbx.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map((m) => m[1]);
    expect(new Set(ids)).toEqual(new Set(['io.github.zijianyuangh.daybook', 'io.github.zijianyuangh.daybook.uitests']));
    expect(capConfig).toContain("appId: 'io.github.zijianyuangh.daybook'");
    const versions = new Set([...pbx.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1]));
    expect(versions).toEqual(new Set([pkg.version]));
    expect([...pbx.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].length).toBeGreaterThan(0);
    expect(new Set([...pbx.matchAll(/TARGETED_DEVICE_FAMILY = ([^;]+);/g)].map((m) => m[1]))).toEqual(new Set(['1']));
  });

  it('App Store icon is 1024×1024 without an alpha channel', () => {
    const png = readFileSync('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
    expect(png.readUInt32BE(16)).toBe(1024);
    expect(png.readUInt32BE(20)).toBe(1024);
    expect(png[25]).toBe(2); // IHDR colour type 2 = RGB (6 would be RGBA)
  });

  it('native plugin is registered: the scene and the storyboard both use the Daybook view controller', () => {
    // Capacitor 8 builds the root view controller in SceneDelegate, not from the storyboard
    const scene = readFileSync('ios/App/App/SceneDelegate.swift', 'utf8');
    expect(scene).toContain('rootViewController = DaybookViewController()');
    expect(scene).not.toMatch(/rootViewController = CAPBridgeViewController\(\)/);
    expect(readFileSync('ios/App/App/Base.lproj/Main.storyboard', 'utf8')).toContain('customClass="DaybookViewController"');
    const vc = readFileSync('ios/App/App/DaybookViewController.swift', 'utf8');
    expect(vc).toContain('private let daybook = DaybookNativePlugin()');
    expect(vc).toContain('registerPluginInstance(daybook)');
    expect(pbx).toContain('DaybookNativePlugin.swift in Sources');
    expect(pbx).toContain('AppUITests.swift in Sources');
  });

  it('App Lock is triggered by iOS itself when the app goes to the background', () => {
    const vc = readFileSync('ios/App/App/DaybookViewController.swift', 'utf8');
    const plugin = readFileSync('ios/App/App/DaybookNativePlugin.swift', 'utf8');
    const web = readFileSync('src/native/services.tsx', 'utf8');
    expect(vc).toMatch(/didEnterBackgroundNotification[\s\S]*daybook\.requestLock\(\)/);
    expect(plugin).toContain('notifyListeners("lockRequired"');
    expect(plugin).toContain('CAPPluginMethod(name: "lockShown"');
    expect(web).toContain("addListener('lockRequired'");
    // the privacy cover is removed only after the lock screen is drawn (or a 2 s fallback)
    expect(vc).toContain('holdCoverUntilLocked');
  });

  it('privacy policy and support pages exist (App Store 5.1.1 requires the policy link in the app)', () => {
    expect(existsSync('public/privacy.html')).toBe(true);
    expect(existsSync('public/support.html')).toBe(true);
    const about = readFileSync('src/screens/AccountsScreen.tsx', 'utf8');
    expect(about).toContain('privacy.html');
    expect(about).toContain('support.html');
  });
});

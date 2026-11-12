// Renders the app icon SVG to the PNG sizes required by iOS and the web manifest.
// Uses the pre-installed Playwright Chromium. Run: npm run icons
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';

const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8');
// iOS applies its own corner mask, so the touch icon and maskable icon use a full-bleed square.
const square = svg.replace('rx="112"', 'rx="0"');
const maskable = square.replace('translate(96 96)', 'translate(136 136) scale(0.75)');
const out = new URL('../public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(src, size, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${src.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: new URL(file, out).pathname, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
await render(svg, 192, 'icon-192.png');
await render(svg, 512, 'icon-512.png');
await render(maskable, 512, 'icon-maskable-512.png');
await render(square, 180, 'apple-touch-icon.png');
// iOS app: full-bleed 1024 master (alpha is removed in scripts/ios-assets.py)
await render(square, 1024, 'ios-appicon-1024.png');
await browser.close();
console.log('icons written');

// Sets the iOS app version from package.json and the build number.
//   node scripts/ios-version.mjs            → version = package.json, build = current + 1
//   node scripts/ios-version.mjs 42         → build = 42
// App Store Connect requires a new, higher build number for every upload.
import { readFileSync, writeFileSync } from 'node:fs';

const pbx = 'ios/App/App.xcodeproj/project.pbxproj';
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
let s = readFileSync(pbx, 'utf8');
const current = Math.max(...[...s.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => Number(m[1])));
const build = process.argv[2] ? Number(process.argv[2]) : current + 1;
if (!Number.isInteger(build) || build < 1) throw new Error('build number must be a positive integer');
s = s.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`).replace(/CURRENT_PROJECT_VERSION = \d+;/g, `CURRENT_PROJECT_VERSION = ${build};`);
writeFileSync(pbx, s);
console.log(`iOS version ${version} (build ${build})`);

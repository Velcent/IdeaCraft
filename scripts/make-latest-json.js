#!/usr/bin/env node
'use strict';

// Generate the Tauri updater feed (latest.json) for an IdeaCraft release.
//
// Usage:
//   npm run latest-json
//   node scripts/make-latest-json.js [--out path/to/latest.json]
//
// Reads the signed NSIS bundle produced by `npm run build`:
//   src-tauri/target/release/bundle/nsis/IdeaCraft_<version>_x64-setup.exe(.sig)
// and writes latest.json pointing at the GitHub release download URLs.
//
// Environment overrides:
//   IDEACRAFT_REPO=owner/name  GitHub repository (default placeholder must be
//                              replaced before a real release!)
//   IDEACRAFT_TAG=v1.0.0       release tag the URLs point at (default: v<version>)
//   IDEACRAFT_NOTES="..."      release notes text in the feed

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const conf = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const version = conf.version;
const productName = conf.productName || 'IdeaCraft';

const repo = process.env.IDEACRAFT_REPO || 'aamirenic/ideacraft';
const tag = process.env.IDEACRAFT_TAG || `v${version}`;
const notes = process.env.IDEACRAFT_NOTES || `IdeaCraft ${version}`;

const nsisDir = path.join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
const setupName = `${productName}_${version}_x64-setup.exe`;
const setupPath = path.join(nsisDir, setupName);
const sigPath = `${setupPath}.sig`;

if (!fs.existsSync(setupPath)) {
  console.error(`make-latest-json: bundle not found:`);
  console.error(`  ${setupPath}`);
  console.error(`Run \`npm run build\` first (with the signing env vars set).`);
  process.exitCode = 1;
  process.exit(process.exitCode);
}
if (!fs.existsSync(sigPath)) {
  console.error(`make-latest-json: signature file missing: ${sigPath}`);
  console.error(`Rebuild with TAURI_SIGNING_PRIVATE_KEY + TAURI_SIGNING_PRIVATE_KEY_PASSWORD set.`);
  process.exitCode = 1;
  process.exit(process.exitCode);
}

const signature = fs.readFileSync(sigPath, 'utf8').trim();
const url = `https://github.com/${repo}/releases/download/${tag}/${setupName}`;

const feed = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': { signature, url }
  }
};

const outArg = process.argv.indexOf('--out');
const outPath =
  outArg !== -1 && process.argv[outArg + 1] ? path.resolve(process.argv[outArg + 1]) : path.join(nsisDir, 'latest.json');

fs.writeFileSync(outPath, JSON.stringify(feed, null, 2) + '\n', 'utf8');

console.log('make-latest-json: wrote ' + outPath);
console.log('  version   : ' + version);
console.log('  artifact  : ' + setupName);
console.log('  url       : ' + url);
console.log('  signature : ' + signature.slice(0, 40) + '…');
console.log('');
console.log(`Upload BOTH to the GitHub release for tag ${tag}:`);
console.log('  - ' + setupName);
console.log('  - ' + setupName + '.sig  (optional, human-readable)');
console.log('  - latest.json (required for the auto-updater feed)');

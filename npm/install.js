#!/usr/bin/env node
'use strict';

// IdeaCraft postinstall hook.
//
// `npm install ideacraft` downloads the latest signed NSIS installer for this
// package's version from GitHub Releases and runs it silently:
//   - installs per-user (no admin rights, no UAC prompt) into %LOCALAPPDATA%\IdeaCraft
//   - creates Start Menu and Desktop shortcuts
//   - installs WebView2 automatically if the machine is missing it
//
// Environment overrides:
//   IDEACRAFT_SKIP_INSTALL=1   skip the app install entirely
//   IDEACRAFT_REPO=owner/name  install from a different GitHub repository
//   IDEACRAFT_STRICT=1         make install failures fail the npm install
//
// Any install failure is reported but does NOT fail the npm install (unless
// STRICT). Everything can be retried later with `ideacraft install` or
// `npx ideacraft install`.

const { execFile } = require('child_process');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

const REPO = process.env.IDEACRAFT_REPO || 'aamirenic/IdeaCraft';
const PKG_VERSION = require('./package.json').version;
const API = (v) => `https://api.github.com/repos/${REPO}/releases${v ? `/tags/v${v}` : '/latest'}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            'User-Agent': `ideacraft-npm/${PKG_VERSION} (npm installer)`,
            Accept: 'application/vnd.github+json'
          }
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return resolve(fetchJSON(res.headers.location));
          }
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            if (res.statusCode !== 200) {
              return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
            }
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(new Error(`Bad JSON from ${url}`));
            }
          });
        }
      )
      .on('error', reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': `ideacraft-npm/${PKG_VERSION}` } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(download(res.headers.location, dest));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        }
        const tmp = `${dest}.part`;
        const file = fs.createWriteStream(tmp);
        res.pipe(file);
        file.on('finish', () => file.close(() => {
          try {
            fs.renameSync(tmp, dest);
            resolve(dest);
          } catch (e) {
            reject(e);
          }
        }));
        file.on('error', reject);
      })
      .on('error', reject);
  });
}

function runInstaller(setupPath) {
  return new Promise((resolve, reject) => {
    console.log('IdeaCraft: installing silently (per-user, no admin rights needed)…');
    execFile(setupPath, ['/S'], { windowsHide: true, timeout: 5 * 60 * 1000 }, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function installedExePath() {
  const candidates = [
    path.join(os.homedir(), 'AppData', 'Local', 'IdeaCraft', 'IdeaCraft.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'IdeaCraft', 'IdeaCraft.exe'),
    path.join('C:', 'Program Files', 'IdeaCraft', 'IdeaCraft.exe')
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return null;
}

async function main() {
  if (process.env.IDEACRAFT_SKIP_INSTALL === '1') {
    console.log('IdeaCraft: IDEACRAFT_SKIP_INSTALL is set - skipping app install.');
    return;
  }
  if (os.platform() !== 'win32') {
    console.log(`IdeaCraft: this package installs the Windows desktop app (detected ${os.platform()}).`);
    console.log('Build from source for other platforms: https://github.com/' + REPO + '#build-from-source');
    return;
  }

  const already = installedExePath();
  if (already) {
    try {
      const st = fs.statSync(already);
      if (Date.now() - st.ctimeMs < 30_000) {
        console.log(`IdeaCraft: already installed freshly at ${already}`);
        return;
      }
    } catch (_) {}
  }

  console.log(`IdeaCraft: resolving latest release from github.com/${REPO}…`);
  let release;
  try {
    release = await fetchJSON(API());
    // If latest release has no usable Windows asset (e.g. a source-only tag),
    // fall back to the release pinned to this package's version.
    const hasSetup = (release.assets || []).some((a) => /_x64-setup\.exe$/i.test(a.name || ''));
    if (!hasSetup) {
      console.log(`IdeaCraft: latest release has no Windows installer; trying v${PKG_VERSION} release…`);
      release = await fetchJSON(API(PKG_VERSION));
    }
  } catch (e) {
    console.warn(`IdeaCraft: could not reach GitHub (#${e.message}).`);
    console.warn('IdeaCraft: install manually later with:');
    console.warn('  ideacraft install        (or: npx ideacraft install)');
    console.warn(`  ... or download from https://github.com/${REPO}/releases`);
    if (process.env.IDEACRAFT_STRICT === '1') process.exitCode = 1;
    return;
  }

  const tag = release.tag_name || '';
  const asset = (release.assets || []).find((a) => /_x64-setup\.exe$/i.test(a.name || ''));
  if (!asset) {
    console.warn(`IdeaCraft: release ${tag || '(untagged)'} has no Windows installer asset.`);
    console.warn(`IdeaCraft: download manually from https://github.com/${REPO}/releases`);
    if (process.env.IDEACRAFT_STRICT === '1') process.exitCode = 1;
    return;
  }

  const dest = path.join(os.tmpdir(), `ideacraft-setup-${tag || PKG_VERSION}.exe`);
  console.log(`IdeaCraft: downloading ${asset.name} (${Math.round((asset.size || 0) / 1048576 * 10) / 10} MB)…`);
  try {
    await download(asset.browser_download_url, dest);
    await runInstaller(dest);
  } catch (e) {
    console.warn(`IdeaCraft: install did not complete (${e.message}).`);
    console.warn('IdeaCraft: if the app is currently running, close it and run:');
    console.warn('  ideacraft install        (or: npx ideacraft install)');
    console.warn(`  ... or download from https://github.com/${REPO}/releases`);
    try {
      fs.unlinkSync(dest);
    } catch (_) {}
    if (process.env.IDEACRAFT_STRICT === '1') process.exitCode = 1;
    return;
  } finally {
    try {
      fs.unlinkSync(dest);
    } catch (_) {}
  }

  const exe = installedExePath();
  console.log('IdeaCraft: installed successfully.');
  console.log(`IdeaCraft: app location: ${exe || '%LOCALAPPDATA%\\IdeaCraft\\IdeaCraft.exe'}`);
  console.log('IdeaCraft: launch it from the Start Menu, the Desktop shortcut, or by running:');
  console.log('  ideacraft                (or: npx ideacraft)');
  console.log(`IdeaCraft: remove it any time with "ideacraft uninstall" or from Settings > Apps.`);
  await sleep(500);
}

main().catch((e) => {
  console.warn(`IdeaCraft: unexpected installer error: ${e.message}`);
  if (process.env.IDEACRAFT_STRICT === '1') process.exitCode = 1;
});

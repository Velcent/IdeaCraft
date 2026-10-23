#!/usr/bin/env node
'use strict';

// `ideacraft` command line:
//   ideacraft                 launch the installed IdeaCraft app
//   ideacraft install         (re)run the silent app installer
//   ideacraft uninstall       remove the installed app
//   ideacraft where           print the installed app path
//   ideacraft --version       print this package's version

const { execFile, spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = process.env.IDEACRAFT_REPO || 'aamirenic/IdeaCraft';
const PKG_VERSION = require('./package.json').version;

function candidates() {
  const localAppData = path.join(os.homedir(), 'AppData', 'Local');
  return [
    path.join(localAppData, 'IdeaCraft', 'IdeaCraft.exe'),
    path.join(localAppData, 'Programs', 'IdeaCraft', 'IdeaCraft.exe'),
    path.join('C:', 'Program Files', 'IdeaCraft', 'IdeaCraft.exe')
  ];
}

function findInstalled() {
  for (const p of candidates()) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) {}
  }
  // Last resort: ask the registry where the NSIS uninstaller recorded the app.
  try {
    for (const hive of ['HKCU', 'HKLM']) {
      const key = `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\IdeaCraft`;
      const out = spawnSync('reg', ['query', key, '/v', 'DisplayIcon'], { encoding: 'utf8', windowsHide: true });
      const match = out && out.stdout && out.stdout.match(/DisplayIcon\s+REG_SZ\s+(\S+\.exe)/i);
      if (match && fs.existsSync(match[1])) return match[1];
    }
  } catch (_) {}
  return null;
}

const installer = path.join(__dirname, 'install.js');

function usage() {
  console.log('IdeaCraft command line');
  console.log('');
  console.log('  ideacraft              launch the IdeaCraft app');
  console.log('  ideacraft install      install / repair the app (silent)');
  console.log('  ideacraft uninstall    remove the installed app');
  console.log('  ideacraft where        print the installed app path');
  console.log('  ideacraft --version    print version');
  console.log('');
  console.log(`Docs: https://github.com/${REPO}`);
}

(async () => {
  const [arg0, arg1] = process.argv.slice(2);

  if (arg0 === '--version' || arg0 === '-v' || arg0 === 'version') {
    console.log(`ideacraft ${PKG_VERSION}`);
    return;
  }

  if (arg0 === 'help' || arg0 === '--help' || arg0 === '-h') {
    usage();
    return;
  }

  if (arg0 === 'install') {
    // Re-run the postinstall flow on demand.
    const { fork } = require('child_process');
    fork(installer, { stdio: 'inherit' });
    return;
  }

  if (arg0 === 'where') {
    const exe = findInstalled();
    if (exe) {
      console.log(exe);
    } else {
      console.error('IdeaCraft is not installed yet. Run: ideacraft install');
      process.exitCode = 1;
    }
    return;
  }

  if (arg0 === 'uninstall') {
    const appDir = path.dirname(findInstalled() || path.join(os.homedir(), 'AppData', 'Local', 'IdeaCraft', 'IdeaCraft.exe'));
    const uninstaller = path.join(appDir, 'uninstall.exe');
    if (!fs.existsSync(uninstaller)) {
      console.error(`No uninstaller found at ${uninstaller}.`);
      console.error('Remove IdeaCraft from Windows Settings > Apps instead.');
      process.exitCode = 1;
      return;
    }
    console.log('IdeaCraft: uninstalling (silent)…');
    spawn(uninstaller, ['/S'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return;
  }

  // Default (no args): launch the app.
  const exe = findInstalled();
  if (!exe) {
    console.error('IdeaCraft is installed via npm but the app itself is not installed yet.');
    console.error('Run this to finish installation:');
    console.error('');
    console.error('  ideacraft install');
    console.error('');
    console.error(`Or download the installer from https://github.com/${REPO}/releases`);
    process.exitCode = 1;
    return;
  }
  spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
})().catch((e) => {
  console.error(`ideacraft: ${e.message}`);
  process.exitCode = 1;
});

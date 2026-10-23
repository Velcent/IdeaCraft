#!/usr/bin/env node
'use strict';

// IdeaCraft smoke test.
//
// Drives the REAL desktop app over the WebView2 DevTools protocol (CDP) and
// verifies the core flows end to end:
//   1. app boots (UI mounted, no uncaught page errors)
//   2. seeded content is present (sidebar has pages incl. the Welcome page)
//   3. Ctrl+N creates a page in the UI, title typing works, Enter moves focus
//      from the title into the first content block, body text lands in it
//   4. trash + delete-forever remove the page again (backend + sidebar)
//   5. the workspace returns to its pre-test state (test is self-cleaning)
//
// The test closes any running IdeaCraft instance and starts its own with a
// debug port, then closes it. Usage:
//   npm run smoke
//   node tests/smoke.js            ( IDEACRAFT_EXE=<path> to pick the exe )

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execSync, spawn } = require('child_process');

const PORT = Number(process.env.IDEACRAFT_CDP_PORT || 9223);
const TYPED_TITLE = 'Smoke write check';
const TYPED_BODY = 'smoke-test body paragraph created by npm run smoke';

const out = {
  exe: null,
  pageUrl: null,
  verdict: 'FAIL',
  checks: [],
  pageErrors: []
};

function record(name, ok, detail) {
  out.checks.push({ name, ok: !!ok, detail: detail || null });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function findExe() {
  const candidates = [
    process.env.IDEACRAFT_EXE,
    path.join(os.homedir(), 'AppData', 'Local', 'IdeaCraft', 'IdeaCraft.exe'),
    path.join(__dirname, '..', 'IdeaCraft.exe'),
    path.join(__dirname, '..', 'src-tauri', 'target', 'release', 'ideacraft.exe')
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return path.resolve(p);
    } catch (_) {}
  }
  return null;
}

function killApp() {
  try {
    execSync('taskkill /IM IdeaCraft.exe /F /T', { stdio: 'ignore' });
  } catch (_) {}
  try {
    execSync('ping -n 2 127.0.0.1 >NUL', { stdio: 'ignore' });
  } catch (_) {}
}

function cdpReady(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitCdp(url, seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await cdpReady(url)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function evalPage(page, fn, ...args) {
  return page.evaluate(fn, ...args);
}

(async () => {
  try {
    require.resolve('playwright-core');
  } catch (_) {
    console.error('smoke: missing dev dependency. Run `npm install` at the repo root first.');
    process.exit(2);
  }

  const exe = findExe();
  out.exe = exe;
  if (!exe) {
    record('locate IdeaCraft.exe', false, 'not found; set IDEACRAFT_EXE or run npm run build');
    console.log('\n' + JSON.stringify(out, null, 2));
    process.exit(1);
  }

  killApp();
  const child = spawn(exe, [], {
    cwd: path.dirname(exe),
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
    stdio: 'ignore',
    detached: true
  });
  child.unref();
  const cdpURL = `http://127.0.0.1:${PORT}/json/version`;
  const up = await waitCdp(cdpURL, 40);
  record('app boots with debug port', up, up ? `CDP ${cdpURL}` : `IdeaCraft did not expose CDP on 127.0.0.1:${PORT}`);
  if (!up) {
    killApp();
    console.log('\n' + JSON.stringify(out, null, 2));
    process.exit(1);
  }

  let browser = null;
  try {
    const { chromium } = require('playwright-core');
    browser = await chromium.connectOverCDP(cdpURL);
    const ctx = browser.contexts()[0];
    const page = ctx.pages()[0] || (await ctx.newPage());
    out.pageUrl = page.url();
    page.on('pageerror', (e) => out.pageErrors.push(String((e && e.message) || e)));

    await page.waitForSelector('#app[data-theme]', { timeout: 20000 });
    await page.waitForFunction(
      () => window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function',
      null,
      { timeout: 20000 }
    );

    // 1) boot
    const boot = await evalPage(page, () => {
      const app = document.getElementById('app');
      const tree = document.getElementById('pageTree');
      return {
        readyState: document.readyState,
        theme: app ? app.dataset.theme : null,
        treeItems: tree ? tree.children.length : 0
      };
    });
    record('UI mounted with theme', boot.readyState === 'complete' && !!boot.theme, `theme=${boot.theme}`);
    await page
      .waitForFunction(() => {
        const t = document.getElementById('pageTree');
        return t && t.children.length >= 2;
      }, null, { timeout: 10000 })
      .catch(() => {});
    record('sidebar tree populated', boot.treeItems >= 2, `items=${boot.treeItems}`);

    // 2) seed presence (backend + sidebar count before the test writes anything)
    const sidebarBefore = await evalPage(
      page,
      () =>
        window.__TAURI__.core
          .invoke('get_sidebar')
          .then((r) => ({ count: (r.pages || []).length, titles: (r.pages || []).map((p) => p.title || '') }))
    );
    record(
      'seeded content present',
      sidebarBefore.count >= 3 && sidebarBefore.titles.some((t) => /welcome/i.test(t)),
      `pages=${sidebarBefore.count}`
    );

    // 3) create page through the real UI
    await page.keyboard.press('Control+N');
    await page.waitForSelector('#view .page-title', { timeout: 15000 });
    // wait until the title editor actually has keyboard focus (async after view render)
    await page
      .waitForFunction(() => document.activeElement && document.activeElement.classList.contains('page-title'), null, { timeout: 10000 })
      .catch(() => {});
    await page.keyboard.type(TYPED_TITLE, { delay: 20 });
    await page.keyboard.press('Enter');
    const focus = await evalPage(page, () => {
      const a = document.activeElement;
      return a ? `${a.tagName} ${(a.className || '').toString()}` : null;
    });
    record('title Enter focuses content', /block-inner/.test(focus || ''), focus);
    await page.keyboard.type(TYPED_BODY, { delay: 12 });
    const bodyText = await evalPage(
      page,
      () => Array.from(document.querySelectorAll('#view .block-content')).map((b) => b.textContent || '').join('\n')
    );
    record('body text typed into content', bodyText.includes(TYPED_BODY));
    const titleText = await evalPage(page, () => {
      const t = document.querySelector('#view .page-title');
      return t ? (t.textContent || '').trim() : null;
    });
    record('typed page title visible', titleText === TYPED_TITLE, `view title=${titleText}`);

    // 4) cleanup: trash + delete forever through the backend
    // exact title first; fall back to a suffix match so a partially typed
    // title can never leave an orphan test page behind
    const createdId = await evalPage(
      page,
      ({ exact, fallback }) =>
        window.__TAURI__.core.invoke('get_sidebar').then((r) => {
          const pages = r.pages || [];
          const hit = pages.find((p) => (p.title || '') === exact) || pages.find((p) => (p.title || '').includes(fallback));
          return hit ? hit.id : null;
        }),
      { exact: TYPED_TITLE, fallback: 'write check' }
    );
    record('created page registered in backend', !!createdId, `id=${createdId}`);

    if (createdId) {
      const trashedCount = await evalPage(
        page,
        (id) => window.__TAURI__.core.invoke('trash_page', { id }).then((n) => n, () => null),
        createdId
      );
      record('trash_page works', typeof trashedCount === 'number', `affected=${trashedCount}`);
      const trashedAt = await evalPage(
        page,
        (id) =>
          window.__TAURI__.core
            .invoke('get_page_detail', { id })
            .then((d) => (d && d.page && d.page.trashedAt) || null)
            .catch(() => null),
        createdId
      );
      record('trash verified in DB', !!trashedAt);
      await evalPage(page, (id) => window.__TAURI__.core.invoke('delete_page_forever', { id }).catch(() => null), createdId);
      const afterDelete = await evalPage(
        page,
        (id) =>
          window.__TAURI__.core
            .invoke('get_page_detail', { id })
            .then(() => 'still-exists')
            .catch(() => 'deleted'),
        createdId
      );
      record('delete forever works', afterDelete === 'deleted', `state=${afterDelete}`);

      const sidebarAfter = await evalPage(
        page,
        () => window.__TAURI__.core.invoke('get_sidebar').then((r) => ({ count: (r.pages || []).length, titles: (r.pages || []).map((p) => p.title || '') }))
      );
      record(
        'sidebar clean after delete',
        !sidebarAfter.titles.includes(TYPED_TITLE) && sidebarAfter.count === sidebarBefore.count,
        `before=${sidebarBefore.count} after=${sidebarAfter.count}`
      );
    }

    record('no uncaught page errors', out.pageErrors.length === 0, out.pageErrors.length ? out.pageErrors.slice(0, 3).join(' | ') : '');
  } catch (e) {
    record('smoke driver ran', false, String((e && e.message) || e));
  } finally {
    if (browser) await browser.close().catch(() => {});
    killApp();
  }

  const failed = out.checks.filter((c) => !c.ok);
  out.verdict = failed.length === 0 ? 'PASS' : 'FAIL';
  console.log('');
  console.log(`smoke: ${out.verdict} — ${out.checks.length - failed.length}/${out.checks.length} checks`);
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.verdict === 'PASS' ? 0 : 1);
})();

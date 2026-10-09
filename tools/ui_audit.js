// UI audit: every tenant + owner view at phone / iPad / desktop widths -> layout problems + screenshots.
//   npm i playwright && npx playwright install chromium        (once)
//   node tools/ui_audit.js http://127.0.0.1:8088                (local Nginx; demo seed + demo_accounts.txt)
//   VPS=phone:390x844 ONLY=a-billing,a-settings node tools/ui_audit.js <base>
// Reports per page: SCROLLX (the whole page scrolls sideways), elements off the screen, inputs under 150 px,
// buttons under 32 px high. Screenshots go to evidence/ui-audit/ (gitignored). Exit code 1 = something to fix.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const BASE = (process.argv[2] || 'http://127.0.0.1:8088').replace(/\/$/, '');
const SHOTS = path.join(ROOT, 'evidence', 'ui-audit'); fs.mkdirSync(SHOTS, { recursive: true });
const acc = fs.readFileSync(path.join(ROOT, 'demo_accounts.txt'), 'utf8');
const room = acc.match(/ห้อง 305: \S+\/r\/(\S+)/)[1];
const pwA = acc.match(/owner\.a@dormdesk\.demo \/ (\S+)/)[1];
const VPS = (process.env.VPS || 'small:360x740,phone:390x844,ipad:768x1024,ipadL:1180x820,desk:1440x900').split(',').map((s) => { const [n, wh] = s.split(':'); const [w, h] = wh.split('x').map(Number); return { n, w, h }; });
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const out = []; const errs = [];
async function audit(pg, label, vp) {
  await pg.waitForTimeout(900);
  const r = await pg.evaluate(() => {
    const vw = document.documentElement.clientWidth; const res = { scroll: document.documentElement.scrollWidth - vw, off: [], narrow: [], small: [] };
    const vis = (e) => { const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && e.offsetParent !== null; };
    document.querySelectorAll('body *').forEach((e) => {
      if (!vis(e) || e.classList.contains('skip')) return; const b = e.getBoundingClientRect(); if (b.width === 0) return;
      // inside a horizontal scroller is fine
      let p = e.parentElement, inScroll = false; while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') { inScroll = true; break; } p = p.parentElement; }
      if (!inScroll && (b.right > vw + 1 || b.left < -1)) res.off.push(`${e.tagName.toLowerCase()}.${(e.className && e.className.baseVal === undefined ? e.className : '').toString().split(' ').slice(0,2).join('.')} [${Math.round(b.left)}..${Math.round(b.right)}] "${(e.innerText || e.value || '').trim().slice(0, 40)}"`);
      if ((e.tagName === 'INPUT' && !['checkbox','radio','file','hidden'].includes(e.type)) || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT') if (b.width < 150) res.narrow.push(`${e.tagName.toLowerCase()}#${e.id || e.name || e.type} w=${Math.round(b.width)}`);
      if ((e.tagName === 'BUTTON' || (e.tagName === 'A' && e.classList.contains('btn'))) && b.height < 32 && b.width > 0) res.small.push(`${(e.innerText || e.getAttribute('aria-label') || '').trim().slice(0,25)} h=${Math.round(b.height)}`);
    });
    res.off = [...new Set(res.off)].slice(0, 12); res.narrow = [...new Set(res.narrow)].slice(0, 10); res.small = [...new Set(res.small)].slice(0, 8);
    return res;
  });
  out.push({ label, vp: vp.n, ...r });
  await pg.screenshot({ path: path.join(SHOTS, `${vp.n}-${label}.png`), fullPage: true });
}
(async () => {
  const b = await chromium.launch();
  for (const vp of VPS) {
    const ctx = await b.newContext({ viewport: { width: vp.w, height: vp.h }, hasTouch: vp.w < 1100, isMobile: vp.w < 700, deviceScaleFactor: 1 });
    const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(vp.n + ' ' + e.message));
    const tenant = [['t-home', ''], ['t-repair', '#repair'], ['t-bills', '#bills'], ['t-fines', '#fines'], ['t-facilities', '#facilities'], ['t-booking', '#booking'], ['t-parking', '#parking']];
    for (const [l, h] of tenant) { if (ONLY && !ONLY.includes(l)) continue; await pg.goto(`${BASE}/r/${room}${h}`); await audit(pg, l, vp); }
    if (!ONLY || ONLY.includes('landing')) { await pg.goto(BASE + '/'); await audit(pg, 'landing', vp); }
    if (!ONLY || ONLY.some((x) => x.startsWith('a-'))) {
      await pg.goto(BASE + '/admin'); await pg.waitForTimeout(600); await audit(pg, 'a-login', vp);
      await pg.fill('#email', 'owner.a@dormdesk.demo'); await pg.fill('#password', pwA); await pg.click('#loginBtn'); await pg.waitForTimeout(1500);
      for (const tab of ['dash', 'reqs', 'rooms', 'cats', 'billing', 'parking', 'spaces', 'settings', 'ai']) {
        if (ONLY && !ONLY.includes('a-' + tab)) continue;
        const btn = pg.locator(`#tabs [data-tab="${tab}"]`); if (!(await btn.count()) || !(await btn.isVisible())) { out.push({ label: 'a-' + tab, vp: vp.n, note: 'tab hidden' }); continue; }
        await btn.click(); await audit(pg, 'a-' + tab, vp);
        if (tab === 'reqs') { const row = pg.locator('#reqList > *').first(); if (await row.count()) { await row.click(); await audit(pg, 'a-req-drawer', vp); await pg.keyboard.press('Escape'); await pg.waitForTimeout(300); } }
      }
    }
    await ctx.close();
  }
  for (const o of out) {
    const bad = (o.scroll > 0 ? ` SCROLLX=${o.scroll}` : '') + (o.off && o.off.length ? `\n    off-screen: ${o.off.join('\n                ')}` : '') + (o.narrow && o.narrow.length ? `\n    narrow inputs: ${o.narrow.join(', ')}` : '') + (o.small && o.small.length ? `\n    small tap targets: ${o.small.join(', ')}` : '') + (o.note ? ' ' + o.note : '');
    console.log(`${o.vp.padEnd(6)} ${o.label.padEnd(14)}${bad || ' ok'}`);
  }
  console.log('page errors:', errs);
  await b.close();
  process.exit(out.some((o) => o.scroll > 0 || (o.off && o.off.length)) || errs.length ? 1 : 0);
})();

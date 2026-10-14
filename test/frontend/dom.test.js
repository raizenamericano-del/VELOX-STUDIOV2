'use strict';

/**
 * Boots the real frontend (index.html + icons.js + app.js) inside jsdom and
 * asserts: no console errors, platform grid renders, resolve → result render
 * works, and a failed resolve renders the friendly error card.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const HEALTH = {
  status: 'ok', app: 'VELOX', uptimeSeconds: 5, timestamp: new Date().toISOString(),
  engine: { engine: 'yt-dlp', available: true, version: '2026.08.19', ffmpeg: true, cache: 10 },
  cache: { entries: 0, hits: 0, misses: 0, hitRate: 0, ttlMinutes: 10 },
  queue: { active: 0, pending: 0 }, platforms: 14,
};

const RESOLVE_OK = {
  platform: 'tiktok', platformName: 'TikTok', url: 'https://www.tiktok.com/@tiktok/video/1',
  title: 'Video uji coba', author: '@tiktok', thumbnail: null, duration: '0:15',
  kind: 'video', isPlaylist: false, via: 'tikwm', ms: 812, warnings: [],
  items: [{
    id: '1', title: 'Video uji coba', thumbnail: null, duration: '0:15', kind: 'video',
    formats: [
      { id: 'hd', label: 'HD · Tanpa Watermark', tag: 'HD', ext: 'mp4', kind: 'video', size: '4.1 MB', url: '/api/dl?t=direct&u=x' },
      { id: 'music', label: 'Sound · MP3', tag: 'MP3', ext: 'mp3', kind: 'audio', url: '/api/dl?t=direct&u=y' },
    ],
  }],
};

const RESOLVE_ERR = {
  ok: false,
  error: { code: 'NOT_FOUND', title: 'Kontennya sudah tidak ada', message: 'Post ini sudah dihapus.', hint: 'Cek lagi linknya.' },
};

function makeDom({ fetchImpl }) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(`jsdomError: ${e.message}`));
  vc.on('error', (...a) => errors.push(`console.error: ${a.join(' ')}`));

  const dom = new JSDOM(read('public/index.html'), {
    runScripts: 'outside-only',
    pretendToBeVisual: false,
    url: 'http://localhost/',
    virtualConsole: vc,
  });
  const { window } = dom;

  // minimal APIs the app touches
  window.fetch = fetchImpl;
  window.URL.createObjectURL = () => 'blob:mock';
  window.URL.revokeObjectURL = () => {};
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.HTMLElement.prototype.scrollIntoView = () => {};
  Object.defineProperty(window.navigator, 'clipboard', { value: { readText: async () => '', writeText: async () => {} }, configurable: true });

  window.eval(read('public/js/icons.js'));
  window.eval(read('public/js/app.js'));

  // the app registers a 60s health interval; without closing the window the
  // jsdom event loop never drains and the test runner hangs.
  const close = () => { try { window.close(); } catch { /* already closed */ } };
  return { dom, window, errors, close };
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

test('frontend boots with no console errors and renders 14 platform cards', async (t) => {
  t.after(() => ctx.close());
  let ctx;
  ctx = makeDom({
    fetchImpl: async (url) => ({
      ok: true, status: 200, headers: new Map([['content-type', 'application/json']]),
      json: async () => (String(url).includes('/api/health') ? HEALTH : RESOLVE_OK),
    }),
  });
  const { window, errors } = ctx;
  await tick(30);

  assert.deepStrictEqual(errors, [], `console errors on boot: ${errors.join(' | ')}`);
  const cards = window.document.querySelectorAll('.plat-card');
  assert.strictEqual(cards.length, 14, 'expected 14 platform cards');

  // every card must carry a real inline SVG icon (no external requests)
  for (const card of cards) {
    assert.ok(card.querySelector('.plat-ico svg path')?.getAttribute('d')?.length > 20, 'card missing icon path');
  }
  assert.match(window.document.querySelector('.status-pill')?.textContent || '', /online|cek/);
});

test('submitting a link renders the result card with video + audio options', async (t) => {
  t.after(() => ctx.close());
  let ctx;
  let postedBody = null;
  ctx = makeDom({
    fetchImpl: async (url, opts = {}) => {
      if (String(url).includes('/api/resolve')) {
        postedBody = JSON.parse(opts.body);
        return { ok: true, status: 200, headers: new Map(), json: async () => RESOLVE_OK };
      }
      return { ok: true, status: 200, headers: new Map(), json: async () => HEALTH };
    },
  });
  const { window, errors } = ctx;
  await tick(20);

  const doc = window.document;
  doc.querySelector('#urlInput').value = 'https://www.tiktok.com/@tiktok/video/1';
  doc.querySelector('#urlInput').dispatchEvent(new window.Event('input', { bubbles: true }));
  doc.querySelector('#dlForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

  await tick(40);

  assert.deepStrictEqual(errors, [], `console errors: ${errors.join(' | ')}`);
  assert.strictEqual(postedBody?.url, 'https://www.tiktok.com/@tiktok/video/1', 'URL was not POSTed to /api/resolve');

  assert.ok(doc.querySelector('.result-card'), 'result card not rendered');
  assert.match(doc.querySelector('.result-title').textContent, /Video uji coba/);

  const labels = [...doc.querySelectorAll('.fmt-label')].map((n) => n.textContent);
  assert.ok(labels.some((l) => l.includes('HD · Tanpa Watermark')), `video option missing: ${labels}`);
  assert.ok(labels.some((l) => l.includes('Sound · MP3')), `audio option missing: ${labels}`);

  // history persisted to localStorage
  const hist = JSON.parse(window.localStorage.getItem('velox.history.v1') || '[]');
  assert.strictEqual(hist.length, 1, 'history entry not written');
  assert.strictEqual(hist[0].platform, 'tiktok');
});

test('a result with a thumbnail renders no leaked markup and shows format notes + readable via label', async (t) => {
  t.after(() => ctx.close());
  let ctx;
  const data = {
    ...RESOLVE_OK, platform: 'instagram', platformName: 'Instagram', via: 'izuka-aio',
    thumbnail: 'https://scontent.cdninstagram.com/v/t51/thumb.jpg',
    items: [{
      ...RESOLVE_OK.items[0],
      formats: [
        { id: 'v-1', label: '1080p · MP4', tag: 'HD', ext: 'mp4', kind: 'video', url: '/api/dl?t=direct&u=x' },
        { id: '137', label: '2160p · MP4', tag: 'HD', ext: 'mp4', kind: 'video', note: 'video saja, tanpa audio', url: '/api/dl?t=engine&u=x' },
      ],
    }],
  };
  ctx = makeDom({
    fetchImpl: async (url) => {
      if (String(url).includes('/api/resolve')) return { ok: true, status: 200, headers: new Map(), json: async () => data };
      return { ok: true, status: 200, headers: new Map(), json: async () => HEALTH };
    },
  });
  const { window, errors } = ctx;
  await tick(20);
  const doc = window.document;
  doc.querySelector('#urlInput').value = 'https://www.instagram.com/reel/abc/';
  doc.querySelector('#dlForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick(40);

  assert.deepStrictEqual(errors, [], `console errors: ${errors.join(' | ')}`);
  const card = doc.querySelector('.result-card');
  assert.ok(card, 'result card not rendered');
  assert.ok(!card.textContent.includes('this.remove()'), 'inline handler text leaked into the card');
  assert.ok(!card.textContent.includes("');"), 'stray quote/paren text leaked into the card');
  assert.ok(card.querySelector('.thumb-wrap img.thumb-img'), 'thumbnail img missing');
  assert.ok(card.querySelector('.thumb-wrap .thumb-fallback'), 'fallback must sit behind the image');
  assert.match(card.querySelector('.chip.via').textContent, /via API cadangan/);
  const subs = [...card.querySelectorAll('.fmt-sub')].map((n) => n.textContent);
  assert.ok(subs.some((t) => /tanpa audio/.test(t)), `format note not rendered: ${subs}`);

  // a broken thumbnail just disappears, leaving the fallback
  card.querySelector('img.thumb-img').dispatchEvent(new window.Event('error'));
  assert.ok(!card.querySelector('img.thumb-img'), 'broken thumbnail should remove itself');
  assert.ok(card.querySelector('.thumb-fallback'));
  assert.ok(!card.textContent.includes('remove()'));
});

test('a failed resolve shows the friendly error card, not a raw code', async (t) => {
  t.after(() => ctx.close());
  let ctx;
  ctx = makeDom({
    fetchImpl: async (url) => {
      if (String(url).includes('/api/resolve')) return { ok: false, status: 404, headers: new Map(), json: async () => RESOLVE_ERR };
      return { ok: true, status: 200, headers: new Map(), json: async () => HEALTH };
    },
  });
  const { window, errors } = ctx;
  await tick(20);

  const doc = window.document;
  doc.querySelector('#urlInput').value = 'https://www.instagram.com/reel/gone/';
  doc.querySelector('#dlForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick(40);

  assert.deepStrictEqual(errors, [], `console errors: ${errors.join(' | ')}`);
  const card = doc.querySelector('.err-card');
  assert.ok(card, 'error card not rendered');
  assert.match(card.textContent, /Kontennya sudah tidak ada/);
  assert.match(card.textContent, /Saran/, 'hint not shown to the user');
  assert.ok(doc.querySelector('#retryBtn'), 'retry button missing');
});

test('empty input is rejected client-side without a request', async (t) => {
  t.after(() => ctx.close());
  let ctx;
  let called = 0;
  ctx = makeDom({
    fetchImpl: async (url) => { called++; return { ok: true, status: 200, headers: new Map(), json: async () => HEALTH }; },
  });
  const { window, errors } = ctx;
  await tick(20);

  const doc = window.document;
  doc.querySelector('#urlInput').value = '';
  doc.querySelector('#dlForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick(20);

  const resolveCalls = called; // health ping is the only allowed call
  assert.ok(resolveCalls <= 1, `expected no /api/resolve call, got ${resolveCalls} fetches`);
  assert.match(doc.querySelector('#hintText').textContent, /Tempel dulu/, 'no inline validation message');
  assert.deepStrictEqual(errors, [], `console errors: ${errors.join(' | ')}`);
});

// Studio 2.0 regression coverage. Upstream responses are explicit test fixtures.
const healthyFetch = async () => ({ ok: true, status: 200, headers: new Map(), json: async () => HEALTH });

test('Studio theme toggles and persists the chosen appearance', async t => {
  const ctx = makeDom({ fetchImpl: healthyFetch }); t.after(ctx.close);
  const d = ctx.window.document;
  d.querySelector('#themeBtn').click();
  assert.equal(d.documentElement.dataset.theme, 'light');
  assert.equal(ctx.window.localStorage.getItem('velox.theme.v2'), 'light');
  assert.match(d.querySelector('#themeBtn').getAttribute('aria-label'), /gelap/);
  d.querySelector('#themeBtn').click();
  assert.equal(d.documentElement.dataset.theme, 'dark');
  assert.deepEqual(ctx.errors, []);
});

test('Studio platform search filters cards and handles an empty search result', async t => {
  const ctx = makeDom({ fetchImpl: healthyFetch }); t.after(ctx.close);
  const d = ctx.window.document, search = d.querySelector('#platformSearch');
  search.value = 'youtube'; search.dispatchEvent(new ctx.window.Event('input'));
  assert.equal(d.querySelectorAll('.plat-card:not([hidden])').length, 1);
  search.value = 'this-platform-does-not-exist'; search.dispatchEvent(new ctx.window.Event('input'));
  assert.equal(d.querySelectorAll('.plat-card:not([hidden])').length, 0);
  assert.equal(d.querySelector('#platformEmpty').hidden, false);
  search.value = ''; search.dispatchEvent(new ctx.window.Event('input'));
  assert.equal(d.querySelectorAll('.plat-card:not([hidden])').length, 14);
});

test('Studio platform choices focus input without submitting fabricated sample URLs', async t => {
  let resolveCalls = 0;
  const ctx = makeDom({ fetchImpl: async url => { if (url.includes('/resolve')) resolveCalls++; return healthyFetch(); } }); t.after(ctx.close);
  const d = ctx.window.document;
  d.querySelector('.plat-card[data-platform="instagram"]').click();
  assert.equal(d.activeElement.id, 'urlInput');
  assert.equal(d.querySelector('#urlInput').value, '');
  assert.match(d.querySelector('#urlInput').placeholder, /Instagram/);
  await tick(10);
  assert.equal(resolveCalls, 0);
});

test('Studio rejects invalid URLs, credentials and local addresses before a resolve request', async t => {
  let resolveCalls = 0;
  const ctx = makeDom({ fetchImpl: async url => { if (url.includes('/resolve')) resolveCalls++; return healthyFetch(); } }); t.after(ctx.close);
  const d = ctx.window.document;
  for (const url of ['hello', 'javascript:alert(1)', 'file:///etc/passwd', 'http://127.0.0.1/a', 'https://name:secret@example.com/a', 'https://host.local/video', 'not a url']) {
    d.querySelector('#urlInput').value = url;
    d.querySelector('#dlForm').dispatchEvent(new ctx.window.Event('submit', { cancelable: true }));
    assert.equal(d.querySelector('#urlInput').getAttribute('aria-invalid'), 'true', url);
  }
  assert.equal(resolveCalls, 0);
  assert.deepEqual(ctx.errors, []);
});

test('Studio platform detection is based on hostname, not arbitrary path text', async t => {
  const ctx = makeDom({ fetchImpl: healthyFetch }); t.after(ctx.close);
  const d = ctx.window.document, input = d.querySelector('#urlInput');
  input.value = 'https://example.com/tiktok.com'; input.dispatchEvent(new ctx.window.Event('input'));
  assert.doesNotMatch(d.querySelector('#hintText').textContent, /TikTok terdeteksi/);
  input.value = 'https://tiktok.com.evil.example/video/1'; input.dispatchEvent(new ctx.window.Event('input'));
  assert.doesNotMatch(d.querySelector('#hintText').textContent, /TikTok terdeteksi/);
  input.value = 'https://vm.tiktok.com/abc'; input.dispatchEvent(new ctx.window.Event('input'));
  assert.match(d.querySelector('#hintText').textContent, /TikTok terdeteksi/);
});

test('Studio normalizes a protocol-less URL and filters available result formats', async t => {
  let body;
  const ctx = makeDom({ fetchImpl: async (url, opts) => {
    if (!url.includes('/resolve')) return healthyFetch();
    body = JSON.parse(opts.body); return { ok: true, json: async () => RESOLVE_OK };
  } }); t.after(ctx.close);
  const d = ctx.window.document;
  d.querySelector('#urlInput').value = 'www.tiktok.com/@tiktok/video/1';
  d.querySelector('#dlForm').dispatchEvent(new ctx.window.Event('submit', { cancelable: true }));
  await tick(20);
  assert.equal(body.url, 'https://www.tiktok.com/@tiktok/video/1');
  d.querySelector('[data-filter="audio"]').click();
  assert.equal(d.querySelector('[data-format-group="video"]').hidden, true);
  assert.equal(d.querySelector('[data-format-group="audio"]').hidden, false);
  d.querySelector('[data-filter="all"]').click();
  assert.equal(d.querySelector('[data-format-group="video"]').hidden, false);
  assert.doesNotMatch(d.querySelector('.result-stats').textContent, /Tanpa watermark/);
});

test('Studio API tabs support keyboard navigation, visibility and ARIA selection', async t => {
  const ctx = makeDom({ fetchImpl: healthyFetch }); t.after(ctx.close);
  const d = ctx.window.document;
  d.querySelector('#tab-resolve').focus();
  d.querySelector('.api-tabs').dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(d.activeElement.id, 'tab-download');
  assert.equal(d.querySelector('#tab-download').getAttribute('aria-selected'), 'true');
  assert.equal(d.querySelector('#p-resolve').hidden, true);
  assert.equal(d.querySelector('#p-download').hidden, false);
});

test('Studio history dialog restores focus and traps keyboard navigation', async t => {
  const ctx = makeDom({ fetchImpl: healthyFetch }); t.after(ctx.close);
  const d = ctx.window.document;
  d.querySelector('#historyBtn').focus(); d.querySelector('#historyBtn').click();
  assert.equal(d.querySelector('#historyDrawer').getAttribute('aria-hidden'), 'false');
  assert.equal(d.querySelector('#historyDrawer').hasAttribute('inert'), false);
  assert.equal(d.activeElement.id, 'closeHistory');
  d.querySelector('#historyDrawer').dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  assert.equal(d.activeElement.id, 'closeHistory');
  d.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(d.querySelector('#historyDrawer').getAttribute('aria-hidden'), 'true');
  assert.equal(d.activeElement.id, 'historyBtn');
});

test('Studio malformed history storage recovers without a crash', async t => {
  const ctx = makeDom({ fetchImpl: healthyFetch }); t.after(ctx.close);
  ctx.window.localStorage.setItem('velox.history.v1', '{"url":"not-an-array"}');
  assert.equal(ctx.window.VELOX.history().length, 0);
  ctx.window.localStorage.setItem('velox.history.v1', '[null,{}, {"url":"javascript:alert(1)"}]');
  assert.equal(ctx.window.VELOX.history().length, 0);
});

test('Studio clear-history action can be undone', async t => {
  const ctx = makeDom({ fetchImpl: async url => url.includes('/resolve') ? { ok: true, json: async () => RESOLVE_OK } : healthyFetch() }); t.after(ctx.close);
  await ctx.window.VELOX.resolve('https://www.tiktok.com/@tiktok/video/1');
  const d = ctx.window.document;
  d.querySelector('#clearHistory').click();
  assert.equal(ctx.window.VELOX.history().length, 0);
  d.querySelector('.toast .text-btn').click();
  assert.equal(ctx.window.VELOX.history().length, 1);
});

test('Studio cancel aborts the active browser request and resets busy state', async t => {
  let resolveCalls = 0;
  const ctx = makeDom({ fetchImpl: async (url, options) => {
    if (!url.includes('/resolve')) return healthyFetch();
    resolveCalls++;
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('cancel'), { name: 'AbortError' }))));
  } }); t.after(ctx.close);
  const first = ctx.window.VELOX.resolve('https://youtu.be/abc');
  await ctx.window.VELOX.resolve('https://youtu.be/other');
  assert.equal(resolveCalls, 1);
  const d = ctx.window.document;
  assert.equal(d.querySelector('#dlForm').getAttribute('aria-busy'), 'true');
  d.querySelector('#cancelBtn').click(); await first;
  assert.equal(d.querySelector('#dlForm').getAttribute('aria-busy'), 'false');
  assert.equal(d.querySelector('#goBtn').disabled, false);
  assert.match(d.querySelector('.err-head').textContent, /dibatalkan/);
});

test('Studio safely escapes metadata and rejects off-origin download actions', async t => {
  let externalCalls = 0;
  const ctx = makeDom({ fetchImpl: async url => {
    if (url.startsWith('https://evil.example')) externalCalls++;
    return url.includes('/resolve') ? { ok: true, json: async () => ({ ...RESOLVE_OK, title: '<img src=x onerror=alert(1)>', items: [{ formats: [{ kind: 'video', label: 'Invalid external URL', url: 'https://evil.example/file' }] }] }) } : healthyFetch();
  } }); t.after(ctx.close);
  await ctx.window.VELOX.resolve('https://youtu.be/abc');
  const d = ctx.window.document;
  assert.equal(d.querySelector('.result-title img'), null);
  assert.match(d.querySelector('.result-title').textContent, /<img/);
  d.querySelector('.fmt-btn').click(); await tick(10);
  assert.equal(externalCalls, 0);
  assert.match(d.querySelector('.toast').textContent, /tidak valid/);
});

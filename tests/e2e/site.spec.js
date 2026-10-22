const { test, expect } = require('@playwright/test');

test('subscription and membership forms use the native Librarian front door', async ({ page }) => {
  // Intercept the signup flow so this exercises the rendered client without
  // creating subscribers or sending confirmation mail.
  await page.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort());
  const actions = [];
  await page.route('https://librarian.thingelstad.com/auth', async (route) => {
    actions.push(route.request().postDataJSON().action);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(actions.at(-1) === 'check'
        ? { status: 'not_found' }
        : { status: 'subscribed' }),
    });
  });
  for (const path of ['/', '/archive/353/', '/members/']) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    const forms = page.locator('[data-api-base]');
    expect(await forms.count(), path).toBeGreaterThan(0);
    for (const form of await forms.all()) {
      await expect(form).toHaveAttribute('data-api-base', 'https://librarian.thingelstad.com');
    }
  }
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const form = page.locator('.subscribe-shell').first();
  await form.locator('input[type="email"]').fill('native-routing@example.com');
  await form.locator('button[type="submit"]').click();
  await expect(form.locator('.subscribe-status')).toContainText('Check your inbox to confirm your subscription.');
  expect(actions).toEqual(['check', 'subscribe']);
});

test('the subscribe form sends a Turnstile token and never posts to Buttondown', async ({ page }) => {
  await page.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort());
  // A stand-in for Cloudflare's script: it hands out one token per render or
  // reset, so a reused token and a fresh one can be told apart.
  let scriptLoads = 0;
  await page.route(/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/, async (route) => {
    scriptLoads += 1;
    await route.fulfill({
      contentType: 'text/javascript',
      body: `
        (function() {
          var issued = 0, widgets = [];
          window.turnstile = {
            render: function(el, opts) {
              widgets.push(opts);
              setTimeout(function() { opts.callback('token-' + (++issued)); }, 10);
              return widgets.length - 1;
            },
            reset: function(id) {
              setTimeout(function() { widgets[id].callback('token-' + (++issued)); }, 10);
            }
          };
          setTimeout(function() { window.weeklyThingTurnstileLoaded(); }, 0);
        })();`,
    });
  });
  const calls = [];
  await page.route('https://librarian.thingelstad.com/auth', async (route) => {
    const body = route.request().postDataJSON();
    calls.push({ action: body.action, email: body.email, token: body.turnstile_token });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body.action === 'check' ? { status: 'not_found' } : { status: 'subscribed' }),
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(scriptLoads, 'no Cloudflare script on a plain page view').toBe(0);
  const form = page.locator('.subscribe-shell').first();
  await expect(form.locator('form')).not.toHaveAttribute('action', /./);
  await form.locator('input[type="email"]').fill('reader@example.com');
  await form.locator('button[type="submit"]').click();
  await expect(form.locator('.subscribe-status')).toContainText('Check your inbox');
  expect(scriptLoads).toBe(1);
  // One token covers check then subscribe for the same address.
  expect(calls).toEqual([
    { action: 'check', email: 'reader@example.com', token: 'token-1' },
    { action: 'subscribe', email: 'reader@example.com', token: 'token-1' },
  ]);

  // A different address gets a fresh token: the Librarian binds a token to
  // the first address it saw.
  await form.locator('input[type="email"]').fill('other@example.com');
  await form.locator('button[type="submit"]').click();
  await expect.poll(() => calls.length).toBe(4);
  expect(calls[2]).toEqual({ action: 'check', email: 'other@example.com', token: 'token-2' });
});

// 2026-10-16: an interactive challenge held the post for up to two minutes
// and readers left before subscribing. Observe mode must never hold a
// reader: the form posts within a few seconds, without a token if none came.
for (const [name, script] of [
  [
    'an interactive challenge nobody answers',
    `(function() {
      window.turnstile = {
        render: function(el, opts) {
          setTimeout(function() { opts['before-interactive-callback'] && opts['before-interactive-callback'](); }, 10);
          return 0;
        },
        reset: function() {}
      };
      setTimeout(function() { window.weeklyThingTurnstileLoaded(); }, 0);
    })();`,
  ],
  ['a Cloudflare script that never loads', null],
]) {
  test(`the subscribe form posts within the bound under ${name}`, async ({ page }) => {
    await page.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort());
    await page.route(/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/, async (route) => {
      if (script) await route.fulfill({ contentType: 'text/javascript', body: script });
      // else: never answer, like a stalled network
    });
    const calls = [];
    await page.route('https://librarian.thingelstad.com/auth', async (route) => {
      const body = route.request().postDataJSON();
      calls.push({ action: body.action, token: body.turnstile_token, at: Date.now() });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body.action === 'check' ? { status: 'not_found' } : { status: 'subscribed' }),
      });
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const form = page.locator('.subscribe-shell').first();
    await form.locator('input[type="email"]').fill('patient@example.com');
    const clicked = Date.now();
    await form.locator('button[type="submit"]').click();
    await expect(form.locator('.subscribe-status')).toContainText('Check your inbox', { timeout: 8000 });
    expect(calls.map((c) => [c.action, c.token])).toEqual([
      ['check', undefined],
      ['subscribe', undefined],
    ]);
    // One bounded wait (3 s) for the check; the subscribe right behind it.
    expect(calls[0].at - clicked).toBeLessThan(4500);
    expect(calls[1].at - calls[0].at).toBeLessThan(1000);
  });
}

// 2026-10-20: the Librarian enforces on this site. A post that left without
// a token (the three-second bound) is refused; the form then waits for the
// token, however long the checkbox takes, and posts once more with it.
test('a refused post waits for the token and is sent once more', async ({ page }) => {
  await page.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort());
  // Cloudflare's stand-in answers only after the first post has gone out
  // token-less: five seconds, past the three-second bound.
  await page.route(/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/, async (route) => {
    await route.fulfill({
      contentType: 'text/javascript',
      body: `
        (function() {
          var issued = 0, widgets = [];
          window.turnstile = {
            render: function(el, opts) {
              widgets.push(opts);
              setTimeout(function() { opts.callback('late-' + (++issued)); }, 5000);
              return widgets.length - 1;
            },
            reset: function(id) {
              setTimeout(function() { widgets[id].callback('late-' + (++issued)); }, 500);
            }
          };
          setTimeout(function() { window.weeklyThingTurnstileLoaded(); }, 0);
        })();`,
    });
  });
  const calls = [];
  await page.route('https://librarian.thingelstad.com/auth', async (route) => {
    const body = route.request().postDataJSON();
    calls.push({ action: body.action, token: body.turnstile_token });
    if (!body.turnstile_token) {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'turnstile_failed', error: 'We couldn’t confirm this request came from a person.' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body.action === 'check' ? { status: 'not_found' } : { status: 'subscribed' }),
    });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const form = page.locator('.subscribe-shell').first();
  await form.locator('input[type="email"]').fill('patient@example.com');
  await form.locator('button[type="submit"]').click();
  await expect(form.locator('.subscribe-status')).toContainText('Confirming you’re a person', { timeout: 6000 });
  await expect(form.locator('.subscribe-status')).toContainText('Check your inbox', { timeout: 15000 });
  // Refused once without a token, then sent again with the token the reset
  // produced (the stand-in names tokens as they are issued, so the reset's
  // comes first); the subscribe that follows reuses it and is not refused.
  expect(calls).toEqual([
    { action: 'check', token: undefined },
    { action: 'check', token: 'late-1' },
    { action: 'subscribe', token: 'late-1' },
  ]);
});

test('a Turnstile refusal that stands is shown, not sent to Buttondown', async ({ page }) => {
  await page.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort());
  let posts = 0;
  await page.route('https://librarian.thingelstad.com/auth', (route) => {
    posts += 1;
    return route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'turnstile_failed', error: 'We couldn’t confirm this request came from a person.' }),
    });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const form = page.locator('.subscribe-shell').first();
  await form.locator('input[type="email"]').fill('refused@example.com');
  await form.locator('button[type="submit"]').click();
  await expect(form.locator('.subscribe-status')).toContainText('confirm this request came from a person');
  await expect(page).toHaveURL(/127\.0\.0\.1/);
  // Cloudflare's script never loaded here, so there was no token to wait
  // for and nothing to send again.
  expect(posts).toBe(1);
});

test('main navigation stays on one row at mobile widths', async ({ page }) => {
  const sizes = [
    { width: 320, height: 568 },
    { width: 360, height: 740 },
    { width: 390, height: 844 },
    { width: 414, height: 896 },
    { width: 430, height: 932 },
  ];

  for (const viewport of sizes) {
    await page.setViewportSize(viewport);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const navLayout = await page.locator('.site-nav').evaluate((nav) => {
      const links = Array.from(nav.querySelectorAll('a'));
      const rowTops = new Set(links.map((link) => Math.round(link.getBoundingClientRect().top)));
      const firstLink = links[0].getBoundingClientRect();

      return {
        rows: rowTops.size,
        bodyScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        firstLinkLeft: Math.round(firstLink.left),
      };
    });

    expect(navLayout.rows, `${viewport.width}px nav rows`).toBe(1);
    expect(navLayout.bodyScrollWidth, `${viewport.width}px body width`).toBeLessThanOrEqual(navLayout.viewportWidth);
    expect(navLayout.firstLinkLeft, `${viewport.width}px first link`).toBeGreaterThanOrEqual(0);

    const lastLinkRight = await page.locator('.site-nav').evaluate((nav) => {
      nav.scrollLeft = nav.scrollWidth;
      return Math.round(nav.querySelector('a:last-child').getBoundingClientRect().right);
    });
    expect(lastLinkRight, `${viewport.width}px last link after scrolling`).toBeLessThanOrEqual(
      viewport.width,
    );
  }
});

test("the Jamie's sites strip opens every page, with Weekly Thing marked current", async ({ page }) => {
  // The strip is rendered at build time from the vendored shared/sites.json
  // (npm run sites:sync). Nothing leaves the machine: every request off
  // 127.0.0.1 (Tinylytics, Google Fonts) is refused.
  await page.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort());
  const { sites } = require('../../apps/site/_data/sites.json');
  const expected = sites
    .filter((s) => s.in_sites_strip)
    .map((s) => ({
      href: `${s.url}?ref=sites-strip-weekly`,
      title: s.description,
      text: s.strip_label,
      current: s.id === 'weekly',
    }));
  expect(expected.filter((s) => s.current)).toHaveLength(1);
  // One label per site everywhere: this site reads "Weekly Thing" here too, never "Newsletter".
  expect(expected.find((s) => s.current).text).toBe('Weekly Thing');

  await page.setViewportSize({ width: 1280, height: 800 });
  for (const path of ['/', '/archive/', '/archive/351/', '/topics/', '/about/', '/search/']) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    // First thing in the body after the skip link, right above the header.
    await expect(page.locator('body > .skip-link + nav.sites-strip + header.site-header'), path).toHaveCount(1);
    const strip = page.getByRole('navigation', { name: "Jamie's sites" });
    await expect(strip.locator('.sites-strip__label'), path).toHaveText("Jamie's sites");
    await expect(strip.locator('.sites-strip__label'), path).toBeVisible();
    const links = await strip.locator('.sites-strip__item > a').evaluateAll((els) =>
      els.map((a) => ({
        href: a.getAttribute('href'),
        title: a.getAttribute('title'),
        text: a.textContent.trim(),
        current: a.getAttribute('aria-current') === 'true',
      })));
    expect(links, path).toEqual(expected);
    await expect(strip.locator('.sites-strip__item--current'), path).toHaveCount(1);
    await expect(strip.locator('.sites-strip__item--current'), path).toHaveClass(/sites-strip__item--weekly/);
  }

  // Phones: one row that scrolls sideways, no label, and the page stays put.
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const layout = await page.locator('.sites-strip').evaluate((strip) => {
      const inner = strip.querySelector('.sites-strip__inner');
      const tops = new Set(Array.from(strip.querySelectorAll('.sites-strip__item'))
        .map((li) => Math.round(li.getBoundingClientRect().top)));
      inner.scrollLeft = inner.scrollWidth;
      const last = strip.querySelector('.sites-strip__item:last-child a').getBoundingClientRect();
      return {
        rows: tops.size,
        labelShown: strip.querySelector('.sites-strip__label').offsetParent !== null,
        lastRight: Math.round(last.right),
        pageWidth: document.documentElement.scrollWidth,
      };
    });
    expect(layout.rows, `${width}px strip rows`).toBe(1);
    expect(layout.labelShown, `${width}px label`).toBe(false);
    expect(layout.lastRight, `${width}px last site after scrolling`).toBeLessThanOrEqual(width);
    expect(layout.pageWidth, `${width}px page width`).toBeLessThanOrEqual(width);
  }
});

test("Jamie's h-card, rel=me and the ref on every link to his other sites", async ({ page }) => {
  // Conventions: thingelstad.com AGENTS.md, "Jamie on every site" and
  // "Links between the sites". Built pages only; nothing leaves the machine.
  await page.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort());
  const { owner } = require('../../apps/site/_data/sites.json');

  for (const path of ['/', '/archive/', '/archive/353/', '/about/', '/podcast/', '/members/', '/search/', '/topics/']) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    const me = await page.locator('head link[rel="me"]').evaluateAll((els) => els.map((l) => l.getAttribute('href')));
    expect(me, path).toEqual(owner.rel_me);
    const card = page.locator('.site-footer a.h-card');
    await expect(card, path).toHaveCount(1);
    await expect(card, path).toHaveAttribute('href', owner.url); // identity link: no ref
    await expect(card, path).toHaveAttribute('rel', 'me author');
    await expect(card.locator('img.u-photo'), path).toHaveAttribute('src', owner.avatar);
    await expect(card.locator('.p-name'), path).toHaveText(owner.name);
    await expect(card.locator('data.p-note'), path).toHaveAttribute('value', owner.note);
    // Template links to Jamie's other sites carry a weekly ref (the strip keeps
    // its own sites-strip-weekly). Issue text and its audio chapters are content
    // and are left as written.
    const bare = await page.locator('a[href*=".thingelstad.com"]').evaluateAll((els) => els
      .filter((a) => !a.closest('.issue-content, .issue-chapters-section, .faq-page'))
      .filter((a) => !a.classList.contains('h-card'))
      .map((a) => a.getAttribute('href'))
      .filter((href) => /^https:\/\/(www|thingy|another)\.thingelstad\.com/.test(href))
      .filter((href) => !/[?&]ref=(weekly|sites-strip-weekly)\b/.test(href)));
    expect(bare, path).toEqual([]);
  }

  await page.goto('/archive/353/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.issue-byline-name a')).toHaveAttribute('href', `${owner.url}?ref=weekly-byline`);
  await expect(page.locator('.issue-byline-avatar')).toHaveAttribute('src', owner.avatar);
  await expect(page.locator('.issue-action-explore')).toHaveAttribute('href', /\/chat\/\?issue=353&ref=weekly-issue$/);
  await expect(page.locator('.site-nav a.is-external')).toHaveAttribute('href', /\/\?ref=weekly-nav$/);
  await page.goto('/podcast/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('a[href="https://another.thingelstad.com/?ref=weekly-podcast"]')).toHaveCount(1);
});

test('legacy Thingy URL redirects to standalone chat', async ({ page }) => {
  await page.route('https://thingy.thingelstad.com/chat/?prompt=RSS', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Thingy Chat</title><h1>Thingy Chat</h1>',
    });
  });

  await page.goto('/thingy/?prompt=RSS#sources');

  await expect(page).toHaveURL('https://thingy.thingelstad.com/chat/?prompt=RSS#sources');
  await expect(page.locator('h1')).toHaveText('Thingy Chat');
});

test('old librarian URL redirects to standalone chat', async ({ page }) => {
  await page.route('https://thingy.thingelstad.com/chat/', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Thingy Chat</title><h1>Thingy Chat</h1>',
    });
  });

  await page.goto('/librarian/');

  await expect(page).toHaveURL('https://thingy.thingelstad.com/chat/');
  await expect(page.locator('h1')).toHaveText('Thingy Chat');
});

test('issue text and RSS carry no generated-file notice', async ({ request }) => {
  // 294 is a back-catalogue page re-rendered by WT Builder; 351 was authored there.
  for (const path of ['/archive/294.txt', '/archive/351.txt', '/rss']) {
    const res = await request.get(path);
    expect(res.ok(), path).toBeTruthy();
    const text = await res.text();
    expect(text, path).not.toContain('Generated by');
    expect(text, path).not.toContain('do not edit directly');
  }
});

test('the transcript panel shows WebVTT escapes as the characters they stand for, never as markup', async ({ page }) => {
  // WT Builder writes cue text with the standard WebVTT escapes (&amp; &lt;
  // &gt;); the panel decodes them and still sets each cue as text. Nothing
  // leaves the machine: every request off 127.0.0.1 is refused, and the
  // .vtt is served here.
  const vtt = [
    'WEBVTT',
    '',
    '00:00:00.000 --> 00:00:02.000',
    '<v Jamie>Procter &amp; Gamble say 3 &lt; 4, and &lt;b&gt;this&lt;/b&gt; is not bold --&gt; ever.',
    '',
    '00:00:02.000 --> 00:00:03.000',
    '<v Thingy>&lt;img src=x onerror="window.pwned=1"&gt; and &amp;amp; stays one escape.',
    '',
  ].join('\n');
  await page.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort());
  await page.route(/\.vtt$/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/vtt', headers: { 'Access-Control-Allow-Origin': '*' }, body: vtt }),
  );

  await page.goto('/archive/351/', { waitUntil: 'domcontentloaded' });
  await page.locator('.issue-transcript summary').click();

  const cues = page.locator('.issue-transcript-body .issue-cue > span:last-child');
  await expect(cues).toHaveText([
    'Procter & Gamble say 3 < 4, and <b>this</b> is not bold --> ever.',
    '<img src=x onerror="window.pwned=1"> and &amp; stays one escape.',
  ]);
  await expect(page.locator('.issue-transcript-body b')).toHaveCount(0);
  await expect(page.locator('.issue-transcript-body img[src="x"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
});

test('a firewalled address is told it is under review, on subscribe and on check', async ({ page }) => {
  await page.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort());
  const review = 'This email address was flagged as suspicious and has been recorded for review. It isn’t subscribed yet.';
  let checkAnswer = { status: 200, body: { status: 'not_found' } };
  await page.route('https://librarian.thingelstad.com/auth', (route) => {
    const { action } = route.request().postDataJSON();
    const answer = action === 'check' ? checkAnswer : { status: 200, body: { status: 'needs_jamie', subscriber_status: 'blocked', error: review } };
    return route.fulfill({ status: answer.status, contentType: 'application/json', body: JSON.stringify(answer.body) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const form = page.locator('.subscribe-shell').first();
  const status = form.locator('.subscribe-status');
  await form.locator('input[type="email"]').fill('flagged@example.com');
  await form.locator('button[type="submit"]').click();
  await expect(status).toContainText('recorded for review');
  await expect(status).not.toContainText('Check your inbox');

  checkAnswer = { status: 403, body: { status: 'inactive', under_review: true, error: review } };
  await form.locator('input[type="email"]').fill('flagged2@example.com');
  await form.locator('button[type="submit"]').click();
  await expect(status).toContainText('recorded for review');
  await expect(form.getByRole('button', { name: 'Resubscribe' })).toHaveCount(0);
});

test('the home page draws three reader quotes and three issue excerpts on each visit', async ({ browser }) => {
  const quotes = require('../../apps/site/_data/quotes.json');
  const samples = require('../../apps/site/_data/voiceSamples.json');
  const visibleTexts = (page, selector) => page.locator(selector).evaluateAll((els) =>
    els.filter((el) => el.offsetParent !== null).map((el) => el.querySelector('p').textContent.trim()));

  // Without JavaScript the featured quotes and the first excerpts show.
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  const plain = await noJs.newPage();
  await plain.goto('/', { waitUntil: 'domcontentloaded' });
  const featured = quotes.filter((q) => q.featured).slice(0, 3).map((q) => `“${q.text}”`);
  expect(await visibleTexts(plain, '.home-readers-quotes > .home-q')).toEqual(featured);
  expect(await visibleTexts(plain, '.home-voice-grid > .home-voice-card'))
    .toEqual(samples.slice(0, 3).map((s) => `“${s.text}”`));
  await noJs.close();

  // With it, every quote is in the page, three show, and the wide lead slot
  // gets a long one. Pin Math.random so the draw is a known one.
  const js = await browser.newContext();
  const page = await js.newPage();
  await page.addInitScript(() => { Math.random = () => 0; });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(await page.locator('.home-readers-quotes > .home-q').count()).toBe(quotes.length);
  expect(await page.locator('.home-voice-grid > .home-voice-card').count()).toBe(samples.length);
  const shown = await visibleTexts(page, '.home-readers-quotes > .home-q');
  expect(shown).toHaveLength(3);
  expect(shown[0].length).toBeGreaterThanOrEqual(90 + 2);
  expect(shown).not.toEqual(featured);
  expect(await visibleTexts(page, '.home-voice-grid > .home-voice-card')).toHaveLength(Math.min(3, samples.length));
  await js.close();
});

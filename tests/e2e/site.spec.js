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

test('a Turnstile refusal is shown, not sent to Buttondown', async ({ page }) => {
  await page.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort());
  await page.route('https://librarian.thingelstad.com/auth', (route) => route.fulfill({
    status: 403,
    contentType: 'application/json',
    body: JSON.stringify({ status: 'turnstile_failed', error: 'We couldn’t confirm this request came from a person.' }),
  }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const form = page.locator('.subscribe-shell').first();
  await form.locator('input[type="email"]').fill('refused@example.com');
  await form.locator('button[type="submit"]').click();
  await expect(form.locator('.subscribe-status')).toContainText('confirm this request came from a person');
  await expect(page).toHaveURL(/127\.0\.0\.1/);
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

const { test, expect } = require('@playwright/test');

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

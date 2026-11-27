import { test, expect, type Page } from '@playwright/test';
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('browser@test.local');
  await page.getByLabel('Password', { exact: true }).fill('Browser-password-123!');
  await page.getByRole('button', { name: 'Open my counter' }).click();
  await expect(page.getByRole('heading', { name: 'Live cart' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use command' })).toBeDisabled();
}
async function command(page: Page, text: string) {
  await page.getByLabel('Command transcript').fill(text);
  await page.getByRole('button', { name: 'Use command' }).click();
}
test('mixed-language counter, explicit checkout and on-demand public QR receipt', async ({
  page,
}) => {
  await login(page);
  await command(page, '1 kilo toor dal, 2 Lifebuoy sabun, aur 1 bread packet');
  await expect(page.getByLabel('Quantity for Toor dal')).toHaveValue('1000');
  await expect(page.getByLabel('Quantity for Lifebuoy')).toHaveValue('2');
  await page.getByRole('button', { name: 'Review checkout' }).click();
  await expect(page.getByRole('button', { name: /Record sale/ })).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /Record sale/ }).click();
  await expect(page.getByText('LAST COMPLETED SALE')).toBeVisible();
  await expect(page.getByLabel('Quantity for Toor dal')).toHaveCount(0);
  await page.getByRole('button', { name: 'Share receipt QR', exact: true }).click();
  await expect(page.getByAltText('Open this sale receipt')).toBeVisible();
  const link = await page
    .getByRole('link', { name: 'Open receipt', exact: true })
    .getAttribute('href');
  const receipt = await page.context().newPage();
  await receipt.goto(link!);
  await expect(receipt.getByText('Payment confirmed by merchant')).toBeVisible();
  await expect(receipt.getByText('Lifebuoy 100 g soap')).toBeVisible();
});
test('Khata supports partial settlement and retains itemized purchases', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: '03 Khata Ledger' }).click();
  await page.getByRole('button', { name: /Ramesh/ }).click();
  await expect(page.getByRole('heading', { name: 'Pending · ₹140.00' })).toBeVisible();
  await page.getByLabel('Payment amount (₹)').fill('100');
  await page.getByRole('button', { name: 'Settle payment' }).click();
  await expect(page.getByRole('heading', { name: 'Pending · ₹40.00' })).toBeVisible();
  await page.getByRole('button', { name: 'Items', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Credit purchase · ₹140.00' })).toBeVisible();
  await expect(page.getByText(/Rice.*2000 gram/)).toBeVisible();
});
test('offline app shell recovers the draft and blocks checkout', async ({ page, context }) => {
  await login(page);
  await command(page, 'aadha kilo rice');
  await expect(page.getByLabel('Quantity for Rice')).toHaveValue('500');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForTimeout(500);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Offline · draft only')).toBeVisible();
  await expect(page.getByLabel('Quantity for Rice')).toHaveValue('500');
  await expect(page.getByRole('button', { name: 'Review checkout' })).toBeDisabled();
  await context.setOffline(false);
});
test('lost checkout response survives reload and retry records only one sale', async ({ page }) => {
  await login(page);
  await command(page, '1 kilo chana dal');
  await page.getByRole('button', { name: 'Review checkout' }).click();
  await page.getByRole('checkbox').check();
  let intercepted = false;
  await page.route(/\/api\/v1\/stores\/[^/]+\/sales$/, async (route) => {
    if (route.request().method() === 'POST' && !intercepted) {
      intercepted = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: /Record sale/ }).click();
  await expect(page.getByRole('button', { name: 'Check / retry checkout' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Check / retry checkout' })).toBeVisible();
  await page.getByRole('button', { name: 'Check / retry checkout' }).click();
  await expect(page.getByText('LAST COMPLETED SALE')).toBeVisible();
  const user = await (await page.request.get('/api/v1/auth/me')).json();
  const products = await (
    await page.request.get(`/api/v1/stores/${user.stores[0].storeId}/products`)
  ).json();
  expect(products.items.find((p: { name: string }) => p.name === 'Chana dal').quantity).toBe(19000);
});
test('mobile counter fits its viewport and supports manual product entry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole('button', { name: /Biscuits 100 g packet/ }).click();
  await expect(page.getByLabel('Quantity for Biscuits')).toHaveValue('1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-counter.png', fullPage: true });
});
test('a failed post-sale refresh cannot restore the sold cart', async ({ page }) => {
  await login(page);
  await command(page, '1 milk');
  await page.getByRole('button', { name: 'Review checkout' }).click();
  await page.getByRole('checkbox').check();
  await page.route(/\/api\/v1\/stores\/[^/]+\/products\?/, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Test refresh failure' } }),
    }),
  );
  await page.getByRole('button', { name: /Record sale/ }).click();
  await expect(page.getByText('LAST COMPLETED SALE')).toBeVisible();
  await expect(
    page.getByText('Sale recorded. Refresh the store when the connection returns.'),
  ).toBeVisible();
  await expect(page.getByLabel('Quantity for Milk')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review checkout' })).toBeDisabled();
});

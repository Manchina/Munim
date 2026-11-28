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
  await command(page, '1 milk');
  await expect(page.getByLabel('Quantity for Milk')).toHaveValue('1');
  await expect(page.getByRole('button', { name: 'Review checkout' })).toBeDisabled();
  await context.setOffline(false);
});
test('dictated or typed text reaches the agent only on submit and falls back locally', async ({
  page,
}) => {
  const transcripts: string[] = [];
  await page.route(/\/stores\/[^/]+\/commands\/interpret$/, (route) => {
    const { transcript } = route.request().postDataJSON() as { transcript: string };
    transcripts.push(transcript);
    if (transcript === '1 milk')
      return route.fulfill({
        status: 503,
        json: { error: { code: 'AGENT_UNAVAILABLE', message: 'Mock outage' } },
      });
    const command =
      transcript === 'put half a kilo of rice in the cart' ? '0.5 kg rice' : 'credit Ramesh';
    return route.fulfill({ json: { type: 'normalized', command } });
  });
  await login(page);
  await page.getByLabel('Command transcript').fill('Munim, put half a kilo of rice in the cart');
  await expect(page.getByLabel('Quantity for Rice')).toHaveCount(0);
  expect(transcripts).toEqual([]);
  await page.getByRole('button', { name: 'Use command' }).click();
  await expect(page.getByLabel('Quantity for Rice')).toHaveValue('500');

  await command(page, '1 milk');
  await expect(page.getByLabel('Quantity for Milk')).toHaveValue('1');
  await expect(page.getByText('OpenAI unavailable · Using local commands')).toBeVisible();

  await command(page, 'Put this under Ramesh bhai’s credit');
  await expect(page.getByRole('button', { name: /Record sale/ })).toBeDisabled();
  await expect(page.getByText(/Record .* as credit for Ramesh/)).toBeVisible();
  expect(transcripts).toEqual([
    'put half a kilo of rice in the cart',
    '1 milk',
    'Put this under Ramesh bhai’s credit',
  ]);
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

test('recording fallback transcribes on request and waits for command submission', async ({
  page,
}) => {
  await page.addInitScript(() => {
    class FailedRecognition {
      onerror?: (e: { error: string }) => void;
      start() {
        setTimeout(() => this.onerror?.({ error: 'network' }), 0);
      }
      abort() {}
    }
    class DemoRecorder {
      static isTypeSupported() {
        return true;
      }
      state = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable?: (e: { data: Blob }) => void;
      onstop?: () => void;
      constructor(readonly stream: MediaStream) {}
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['test clip'], { type: this.mimeType }) });
        this.onstop?.();
      }
    }
    Object.defineProperty(window, 'SpeechRecognition', { value: FailedRecognition });
    Object.defineProperty(window, 'MediaRecorder', { value: DemoRecorder });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => ({ getTracks: () => [{ stop() {} }] }),
    });
  });
  let uploads = 0;
  await page.route(/\/stores\/[^/]+\/commands\/transcribe$/, (route) => {
    uploads++;
    expect(route.request().postDataBuffer()?.toString()).toBe('test clip');
    return route.fulfill({ json: { transcript: 'aadha kilo rice' } });
  });
  await login(page);
  await page.getByRole('button', { name: /Start voice session/ }).click();
  await expect(page.getByText('Browser speech is unavailable.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Record command' }).click();
  await expect(page.getByText('Recording · Transcribe sends this clip to OpenAI.')).toBeVisible();
  expect(uploads).toBe(0);
  await page.getByRole('button', { name: 'Discard' }).click();
  expect(uploads).toBe(0);

  await page.getByRole('button', { name: 'Record command' }).click();
  await page.getByRole('button', { name: 'Transcribe recording' }).click();
  await expect(page.getByLabel('Command transcript')).toHaveValue('aadha kilo rice');
  await expect(page.getByLabel('Quantity for Rice')).toHaveCount(0);
  expect(uploads).toBe(1);
  await page.getByRole('button', { name: 'Use command' }).click();
  await expect(page.getByLabel('Quantity for Rice')).toHaveValue('500');
});

type DemoSpeech = {
  emit: (text: string, final?: boolean) => boolean;
  prompt: () => string | null;
  finish: () => void;
};
declare global {
  interface Window {
    demoSpeech: DemoSpeech;
  }
}

async function mockSpeech(page: Page) {
  await page.addInitScript(() => {
    let mic: MockRecognition | undefined;
    let speech: SpeechSynthesisUtterance | undefined;
    class MockRecognition {
      onresult?: (value: unknown) => void;
      results: { isFinal: boolean; 0: { transcript: string } }[] = [];
      resultIndex = 0;
      start() {
        mic = this;
      }
      abort() {
        if (mic === this) mic = undefined;
      }
    }
    Object.defineProperty(window, 'SpeechRecognition', { value: MockRecognition });
    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        speak: (utterance: SpeechSynthesisUtterance) => {
          speech = utterance;
        },
        cancel: () => {
          speech = undefined;
        },
      },
    });
    window.demoSpeech = {
      emit: (text, final = true) => {
        if (!mic?.onresult) return false;
        const recognition = mic;
        const resultIndex = recognition.resultIndex;
        recognition.results[resultIndex] = { isFinal: final, 0: { transcript: text } };
        if (final) recognition.resultIndex++;
        recognition.onresult!({ resultIndex, results: recognition.results });
        return true;
      },
      prompt: () => speech?.text ?? null,
      finish: () => {
        const finished = speech;
        speech = undefined;
        finished?.dispatchEvent(new Event('end'));
      },
    };
  });
}

test('one voice session interprets commands and checks credit approval before writing', async ({
  page,
}) => {
  await mockSpeech(page);
  const transcripts: string[] = [];
  let commits = 0;
  page.on('request', (req) => {
    if (req.method() === 'POST' && /\/stores\/[^/]+\/sales$/.test(req.url())) commits++;
  });
  await page.route(/\/stores\/[^/]+\/commands\/interpret$/, (route) => {
    const { transcript } = route.request().postDataJSON() as { transcript: string };
    transcripts.push(transcript);
    if (transcript === '1 milk')
      return route.fulfill({
        status: 503,
        json: { error: { code: 'AGENT_UNAVAILABLE', message: 'Mock outage' } },
      });
    const command =
      transcript === 'put half a kilo of rice in the cart' ? '0.5 kg rice' : 'credit Ramesh';
    return route.fulfill({ json: { type: 'normalized', command } });
  });
  await login(page);
  await page.getByRole('button', { name: /Start voice session/ }).click();

  const emit = (text: string, final = true) =>
    page.evaluate(([words, isFinal]) => window.demoSpeech.emit(words, isFinal), [
      text,
      final,
    ] as const);
  const say = (text: string) => expect.poll(() => emit(text)).toBe(true);
  const readback = async (text: string) => {
    await expect.poll(() => page.evaluate(() => window.demoSpeech.prompt())).toContain(text);
  };
  const finish = () => page.evaluate(() => window.demoSpeech.finish());

  await expect.poll(() => emit('A customer said Munim, add soap')).toBe(true);
  expect(await emit('Munim, add soap', false)).toBe(true);
  await expect(page.getByLabel('Command transcript')).toBeEmpty();
  expect(transcripts).toEqual([]);

  await say('Munim, put half a kilo of rice in the cart');
  await expect(page.getByLabel('Quantity for Rice')).toHaveValue('500');
  await readback('Added 500 grams of Rice');
  await finish();

  await say('Munim, 1 milk');
  await expect(page.getByLabel('Quantity for Milk')).toHaveValue('1');
  await expect(page.getByText('OpenAI unavailable · Using local commands')).toBeVisible();
  await readback('Added 1 Milk');
  await finish();

  await say('Munim, Ramesh bhai ke khate mein likh do');
  await readback('on credit for Ramesh');
  expect(await emit('Munim, confirm credit')).toBe(false);
  expect(commits).toBe(0);
  await finish();
  await page.clock.setFixedTime(new Date(Date.now() + 31000));
  await say('Munim, confirm credit');
  await readback('Please ask for checkout');
  expect(commits).toBe(0);
  await finish();

  await say('Munim, Ramesh bhai ke khate mein likh do');
  await readback('on credit for Ramesh');
  await finish();
  await say('Munim, confirm credit');
  await expect(page.getByText('LAST COMPLETED SALE')).toBeVisible();
  await readback('Sale recorded');
  await finish();
  await say('Munim, confirm credit');
  await readback('Please ask for checkout');
  expect(commits).toBe(1);
  expect(transcripts).toEqual([
    'put half a kilo of rice in the cart',
    '1 milk',
    'Ramesh bhai ke khate mein likh do',
    'Ramesh bhai ke khate mein likh do',
  ]);
  await page.getByRole('button', { name: /Stop voice session/ }).click();
  await expect(page.getByRole('button', { name: /Start voice session/ })).toBeVisible();
  expect(await emit('Munim, add soap')).toBe(false);

  const user = await (await page.request.get('/api/v1/auth/me')).json();
  const base = `/api/v1/stores/${user.stores[0].storeId}`;
  const products = (await (await page.request.get(base + '/products')).json()).items;
  expect(products.find((p: { name: string }) => p.name === 'Rice').quantity).toBe(37500);
  const customer = (await (await page.request.get(base + '/customers')).json()).items.find(
    (value: { name: string }) => value.name === 'Ramesh',
  );
  const sales = (await (await page.request.get(base + '/sales')).json()).items;
  expect(
    sales.filter((sale: { customerId: string }) => sale.customerId === customer.id),
  ).toHaveLength(2);
  expect(sales[0].customerId).toBe(customer.id);
  const balance = await (await page.request.get(`${base}/customers/${customer.id}/khata`)).json();
  expect(
    balance.items.filter((entry: { saleId: string }) => entry.saleId === sales[0].id),
  ).toHaveLength(1);
});

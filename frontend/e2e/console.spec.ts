import { expect, test, type Page } from "@playwright/test";
import type { Detail, EventRow, Publication } from "../src/api";

test.use({ viewport: { width: 1440, height: 1000 } });
const headers = { Authorization: "Bearer nexora-local-admin" };
test.beforeAll(async ({ request }) => {
  test.setTimeout(95000);
  await expect
    .poll(
      async () => {
        const response = await request.get(
          "/api/messages?include_deliveries=true&order=oldest",
          { headers },
        );
        if (!response.ok()) return false;
        const events: EventRow[] = await response.json();
        return events.some(
          (event) =>
            event.source === "CRM" &&
            event.deliveries?.length === 2 &&
            event.deliveries.every(
              (delivery) => delivery.status === "SUCCEEDED",
            ),
        );
      },
      {
        timeout: 90000,
        intervals: [500, 1000, 2000],
        message: "Seed profile has reached ERP and Billing",
      },
    )
    .toBe(true);
});
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
async function login(page: Page, role = "admin", path = "/") {
  await page.goto(path);
  await page.getByLabel("Ключ доступа").fill("nexora-local-" + role);
  await button(page, "Войти").click();
  await expect(button(page, "Выйти")).toBeVisible({ timeout: 20000 });
}
async function go(page: Page, name: string) {
  const toggle = button(page, "Разделы");
  if (
    (await toggle.isVisible()) &&
    (await toggle.getAttribute("aria-expanded")) !== "true"
  )
    await toggle.click();
  await page
    .getByRole("navigation", { name: "Разделы консоли" })
    .getByRole("link", { name, exact: true })
    .click();
}
async function shot(page: Page, name: string, fullPage = false) {
  if (!process.env.NEXORA_SCREENSHOTS) return;
  await page.mouse.move(2, 2);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    return document.fonts.ready;
  });
  await page.screenshot({
    path: process.env.NEXORA_SCREENSHOTS + "/" + name + ".png",
    fullPage,
  });
}
async function describe(page: Page, id: string): Promise<Detail | null> {
  const r = await page.request.get("/api/messages/" + id, { headers });
  return r.ok() ? r.json() : null;
}
async function waitDelivery(
  page: Page,
  id: string,
  wanted: Record<string, string>,
) {
  await expect
    .poll(
      async () => {
        const detail = await describe(page, id);
        return Object.fromEntries(
          detail?.deliveries.map((d) => [d.target, d.status]) ?? [],
        );
      },
      { timeout: 30000, intervals: [250, 500, 1000] },
    )
    .toEqual(wanted);
  return (await describe(page, id))!;
}
async function publish(page: Page, name: string) {
  await go(page, "Клиенты CRM");
  await page.getByLabel("Наименование").fill(name);
  await page.getByLabel("Контактный email").fill("e2e@example.test");
  const wait = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/customers") && r.request().method() === "POST",
    { timeout: 22000 },
  );
  await button(page, "Создать клиента").click();
  const result = await wait;
  expect(result.status()).toBe(201);
  return (await result.json()) as Publication;
}
function destination(page: Page, target: string) {
  return page
    .getByRole("group", { name: "Выбор доставки" })
    .getByRole("button", { name: new RegExp("^" + target + " ") });
}
async function selected(page: Page, target: string) {
  await destination(page, target).press("Enter");
  await expect(
    page.getByRole("heading", { name: "Доставка · " + target }),
  ).toBeVisible();
}
async function openEvent(page: Page) {
  await page.getByRole("link", { name: /Открыть событие/ }).press("Enter");
}

test("CRM creation reaches ERP and Billing and reconciles", async ({
  page,
}) => {
  test.setTimeout(100000);
  await login(page, "admin", "/customers");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const created = await publish(page, "Nexora E2E " + Date.now());
  await page.route(
    "**/api/messages/" + created.event_id,
    (route) =>
      route.fulfill({ status: 404, json: { detail: "MESSAGE_MISSING" } }),
    { times: 1 },
  );
  await openEvent(page);
  await expect(
    page.getByRole("heading", { name: "Ожидается приём события" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Копировать Event ID" }),
  ).toBeVisible();
  const detail = await waitDelivery(page, created.event_id, {
    ERP: "SUCCEEDED",
    Billing: "SUCCEEDED",
  });
  expect(detail.event.correlation_id).toBe(created.correlation_id);
  await expect(destination(page, "ERP")).toContainText("Применено");
  await expect(destination(page, "Billing")).toContainText("Применено");
  await shot(page, "workbench");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await button(page, "Копировать Correlation ID").press("Enter");
  await expect(page.getByText("Скопировано", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    created.correlation_id,
  );
  await selected(page, "ERP");
  await shot(page, "successful-delivery", true);
  await page
    .getByText("Преобразование и поля назначения", { exact: true })
    .click();
  await page
    .getByText("SOAP Envelope · реконструкция", { exact: true })
    .click();
  await expect(page.getByLabel("Содержимое XML")).toContainText(
    "UpsertPartner",
  );
  await shot(page, "payload-inspector", true);
  await go(page, "Сообщения");
  await page
    .getByRole("combobox", { name: "Идентификатор", exact: true })
    .selectOption("correlation_id");
  await page
    .getByLabel("Correlation ID", { exact: true })
    .fill(created.correlation_id);
  await button(page, "Найти").press("Enter");
  const event = page.getByRole("link", {
    name: "Открыть " + created.event_id,
    exact: true,
  });
  await expect(event).toBeVisible();
  await shot(page, "messages");
  const filtered = page.url();
  await event.click();
  await selected(page, "ERP");
  await page.getByRole("link", { name: "← Журнал сообщений" }).click();
  await expect(page).toHaveURL(filtered);
  await expect(page.getByLabel("Correlation ID", { exact: true })).toHaveValue(
    created.correlation_id,
  );
  await page.goBack();
  await expect(destination(page, "ERP")).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(filtered);
  await login(
    page,
    "admin",
    new URL(filtered).pathname + new URL(filtered).search,
  );
  await expect(event).toBeVisible();
  await go(page, "Сверка");
  await page.getByLabel("Глобальный ID клиента").fill(created.record.id);
  await button(page, "Выполнить сверку").click();
  await expect(page.getByText("Расхождений нет.")).toBeVisible({
    timeout: 18000,
  });
  await shot(page, "reconciliation");
  await go(page, "Маршруты");
  await expect(
    page.getByRole("heading", { name: "Архитектура обмена" }),
  ).toBeVisible();
  await expect(
    page.getByText("POST /soap · UpsertPartner", { exact: true }),
  ).toBeVisible();
  await shot(page, "routes");
  for (const name of [
    "nexora.openapi.json",
    "crm.openapi.json",
    "billing.openapi.json",
    "partner.wsdl",
    "partner.xsd",
    "asyncapi.yaml",
  ])
    expect((await page.request.get("/contracts/" + name)).ok()).toBeTruthy();
  expect(errors).toEqual([]);
});

test("lab submits a real invalid event and shows quarantine", async ({
  page,
}) => {
  test.setTimeout(70000);
  await login(page, "admin", "/lab");
  const old: { event_id: string }[] = await (
    await page.request.get("/api/errors?dead_only=true", { headers })
  ).json();
  const ids = new Set(old.map((r) => r.event_id));
  const receipt = page.waitForResponse(
    (r) =>
      r.url().endsWith("/lab/publish/invalid") &&
      r.request().method() === "POST",
    { timeout: 22000 },
  );
  await button(page, "Отправить неверный контракт").click();
  const published = await receipt;
  expect(published.status()).toBe(202);
  expect((await published.json()).published).toBe("invalid");
  let issue = "";
  await expect
    .poll(
      async () => {
        const response = await page.request.get("/api/errors?dead_only=true", {
          headers,
        });
        const rows: { event_id: string; code: string }[] =
          await response.json();
        issue =
          rows.find(
            (row) => !ids.has(row.event_id) && row.code === "INVALID_CONTRACT",
          )?.event_id ?? "";
        return Boolean(issue);
      },
      { timeout: 25000 },
    )
    .toBe(true);
  await shot(page, "lab");
  await go(page, "Очередь DLQ");
  await page
    .getByRole("link", { name: "Входной карантин · " + issue.slice(0, 8) })
    .click();
  await expect(
    page.getByText("Получатели не назначены. Исходное тело недоступно.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(button(page, "Подготовить повтор")).toHaveCount(0);
});

test("mobile viewer can read routes and cannot access lab", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(page, "viewer");
  expect(
    await page
      .locator("header.app-bar")
      .evaluate((e) => e.getBoundingClientRect().height),
  ).toBeLessThanOrEqual(112);
  expect(
    await page.getByRole("navigation", { name: "Разделы консоли" }).count(),
  ).toBe(0);
  await button(page, "Разделы").press("Enter");
  await expect(page.getByRole("link", { name: "Лаборатория" })).toHaveCount(0);
  await page
    .getByRole("link", { name: "Маршруты", exact: true })
    .press("Enter");
  await expect(
    page.getByRole("cell", { name: "customer.profile", exact: true }),
  ).toBeVisible();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBe(width);
  }
  await button(page, "Разделы").press("Enter");
  await page.getByRole("link", { name: "Сообщения", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(button(page, "Разделы")).toBeFocused();
});

test("partial delivery keeps independent state and preserves replay history", async ({
  page,
}) => {
  test.setTimeout(120000);
  await login(page, "admin", "/customers");
  const fault = "/api/lab/availability/ERP";
  async function setAvailability(unavailable: boolean) {
    await expect
      .poll(
        async () =>
          (
            await page.request.put(fault, {
              headers,
              data: { unavailable },
            })
          ).ok(),
        { timeout: 18000, message: "Set the desired ERP availability" },
      )
      .toBe(true);
  }
  let restored = false;
  try {
    await setAvailability(true);
    const created = await publish(page, "Recovery E2E " + Date.now());
    await openEvent(page);
    await waitDelivery(page, created.event_id, {
      ERP: "RETRY",
      Billing: "SUCCEEDED",
    });
    await expect(
      page.getByText("Частичный результат · ожидается повтор", { exact: true }),
    ).toBeVisible({ timeout: 6000 });
    await expect(
      page.getByText("Следующая попытка", { exact: true }),
    ).toBeVisible();
    await shot(page, "partial-delivery");
    await shot(page, "retry-details", true);
    const terminal = await waitDelivery(page, created.event_id, {
      ERP: "DEAD",
      Billing: "SUCCEEDED",
    });
    const erp = terminal.deliveries.find((d) => d.target === "ERP")!;
    const billing = terminal.deliveries.find((d) => d.target === "Billing")!;
    expect(erp.attempts.map((a) => a.number)).toEqual([1, 2, 3, 4]);
    await go(page, "Очередь DLQ");
    const link = page.getByRole("link", {
      name: "ERP · " + created.event_id.slice(0, 8),
      exact: true,
    });
    await expect(link).toBeVisible();
    await shot(page, "dlq");
    await go(page, "Сводка");
    await expect(
      page.getByRole("link", {
        name: "ERP · " + created.event_id.slice(0, 8),
        exact: true,
      }),
    ).toBeVisible();
    await shot(page, "dashboard");
    await go(page, "Очередь DLQ");
    await link.click();
    await expect(page).toHaveURL(new RegExp("delivery=" + erp.id));
    await expect(
      page.getByRole("heading", { name: "Доставка · ERP" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Разбор ошибки", exact: true }),
    ).toBeVisible();
    await shot(page, "error-inspector", true);
    await setAvailability(false);
    restored = true;
    await button(page, "Подготовить повтор").press("Enter");
    await expect(button(page, "Повторить доставку")).toBeFocused();
    const replayResponse = page.waitForResponse(
      (r) => r.url().endsWith("/replay") && r.request().method() === "POST",
    );
    await button(page, "Повторить доставку").press("Enter");
    expect((await replayResponse).status()).toBe(202);
    const recovered = await waitDelivery(page, created.event_id, {
      ERP: "SUCCEEDED",
      Billing: "SUCCEEDED",
    });
    const recoveredErp = recovered.deliveries.find((d) => d.target === "ERP")!;
    expect(recoveredErp.id).toBe(erp.id);
    expect(recoveredErp.attempts.map((a) => [a.generation, a.number])).toEqual([
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
      [1, 1],
    ]);
    expect(
      recovered.deliveries.find((d) => d.target === "Billing")?.attempts,
    ).toEqual(billing.attempts);
    await expect(
      page.getByText("Восстановление завершено. Delivery ID сохранён.", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 10000 });
    await shot(page, "timeline", true);
    await shot(page, "recovery");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(destination(page, "ERP")).toBeVisible();
    await shot(page, "mobile-trace", true);
    await page.setViewportSize({ width: 320, height: 820 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBe(320);
  } finally {
    if (!restored) await setAvailability(false);
  }
});

test("duplicate keeps identity and stale processing remains distinct", async ({
  page,
}) => {
  test.setTimeout(100000);
  await login(page, "admin", "/customers");
  const created = await publish(page, "Version E2E " + Date.now());
  const first = await waitDelivery(page, created.event_id, {
    ERP: "SUCCEEDED",
    Billing: "SUCCEEDED",
  });
  const duplicate = await page.request.post("/api/lab/publish/duplicate", {
    headers,
    data: { event_id: created.event_id },
  });
  expect(duplicate.status()).toBe(202);
  expect((await duplicate.json()).event_id).toBe(created.event_id);
  const update = await page.request.put("/api/customers/" + created.record.id, {
    headers,
    data: { name: "Version 2", email: null },
  });
  expect(update.ok()).toBeTruthy();
  const updated = (await update.json()) as Publication;
  await waitDelivery(page, updated.event_id, {
    ERP: "SUCCEEDED",
    Billing: "SUCCEEDED",
  });
  expect((await describe(page, created.event_id))?.deliveries).toEqual(
    first.deliveries,
  );
  const stale = await page.request.post("/api/lab/publish/stale", {
    headers,
    data: { event_id: updated.event_id },
  });
  expect(stale.status()).toBe(202);
  const { event_id } = await stale.json();
  const result = await waitDelivery(page, event_id, {
    ERP: "SUCCEEDED",
    Billing: "SUCCEEDED",
  });
  expect(result.deliveries.map((d) => d.outcome)).toEqual(["STALE", "STALE"]);
  await login(page, "admin", "/messages/" + event_id);
  await expect(destination(page, "ERP")).toContainText(
    "Устаревшая версия пропущена",
  );
  await expect(destination(page, "ERP")).toContainText("Доставлено");
  await shot(page, "stale-result", true);
});

test("lost confirmation preserves uncertainty and does not post again", async ({
  page,
}) => {
  test.setTimeout(100000);
  let releaseList = () => {};
  const holdList = new Promise<void>((resolve) => {
    releaseList = resolve;
  });
  let held = false;
  await page.route("**/api/customers", async (route) => {
    if (!held && route.request().method() === "GET") {
      held = true;
      await holdList;
    }
    await route.continue();
  });
  let created: Publication;
  try {
    await login(page, "admin", "/customers");
    created = await publish(page, "Uncertain payment " + Date.now());
    await expect(
      page.getByRole("row").filter({ hasText: created.record.id }),
    ).toBeVisible();
  } finally {
    releaseList();
  }
  await waitDelivery(page, created.event_id, {
    ERP: "SUCCEEDED",
    Billing: "SUCCEEDED",
  });
  const path = "/api/customers/" + created.record.id + "/payment";
  let posts = 0;
  let payment: Publication | undefined;
  await page.route(
    "**" + path,
    async (route) => {
      posts++;
      const actual = await route.fetch({ maxRetries: 0 });
      expect(actual.status()).toBe(201);
      payment = (await actual.json()) as Publication;
      await route.fulfill({
        status: 502,
        json: { detail: "SOURCE_UNAVAILABLE" },
      });
    },
    { times: 1 },
  );
  const row = page.getByRole("row").filter({ hasText: created.record.id });
  await row.getByRole("button", { name: "Оплатить", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Результат операции пока неизвестен" }),
  ).toBeVisible();
  await expect(
    row.getByRole("button", { name: "Оплатить", exact: true }),
  ).toBeDisabled();
  expect(posts).toBe(1);
  await waitDelivery(page, payment!.event_id, { CRM: "SUCCEEDED" });
  await shot(page, "uncertain-payment");
  await page.getByRole("link", { name: "Проверить события оплаты" }).click();
  await expect(page).toHaveURL(new RegExp("customer_id=" + created.record.id));
  await expect(
    page.getByRole("link", {
      name: "Открыть " + payment!.event_id,
      exact: true,
    }),
  ).toBeVisible();
  const matches: EventRow[] = await (
    await page.request.get(
      "/api/messages?source=Billing&kind=customer.payment&customer_id=" +
        created.record.id,
      { headers },
    )
  ).json();
  expect(matches.map((r) => r.id)).toEqual([payment!.event_id]);
  await go(page, "Клиенты CRM");
  await expect(
    row.getByRole("button", { name: "Оплатить", exact: true }),
  ).toBeDisabled();
});

test("search distinguishes validation, an empty result, and a read failure", async ({
  page,
}) => {
  test.setTimeout(65000);
  await login(page, "viewer", "/messages");
  const input = page.getByRole("textbox", { name: "Event ID", exact: true });
  const originalUrl = page.url();
  await input.fill("invalid-id");
  await input.press("Enter");
  await expect(page.getByRole("alert")).toContainText("Введите полный UUID");
  await expect(input).toBeFocused();
  await expect(page).toHaveURL(originalUrl);

  const missing = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await input.fill(missing);
  await input.press("Enter");
  await expect(page.getByText("Событий по этим условиям нет.")).toBeVisible({
    timeout: 20000,
  });
  await expect(page).toHaveURL(new RegExp("event_id=" + missing));
  await page.route("**/api/messages?*event_id=*", (route) =>
    route.abort("failed"),
  );
  await expect(page.getByRole("alert")).toContainText(
    "Связь с сервером прервана.",
    { timeout: 16000 },
  );
  await expect(input).toHaveValue(missing);
  await page.unrouteAll();
  await login(page, "viewer", "/messages/" + missing);
  await expect(
    page.getByRole("heading", { name: "Событие недоступно" }),
  ).toBeVisible({ timeout: 20000 });
  await expect(
    page.getByRole("heading", { name: "Ожидается приём события" }),
  ).toHaveCount(0);
});

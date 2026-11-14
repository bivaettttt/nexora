import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, role = "admin") {
  await page.goto("/");
  await page.getByLabel("Ключ доступа").fill("nexora-local-" + role);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Сводка обмена" }),
  ).toBeVisible();
}

test("CRM creation reaches ERP and Billing and reconciles", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("link", { name: "Клиенты CRM", exact: true })
    .first()
    .click();
  await page.getByLabel("Наименование").fill("Nexora E2E");
  await page.getByLabel("Контактный email").fill("e2e@example.test");
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/customers") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Создать клиента" }).click();
  const created = await (await response).json();
  await expect
    .poll(async () => {
      const result = await page.request.get(
        "/api/messages/" + created.event_id,
        { headers: { Authorization: "Bearer nexora-local-admin" } },
      );
      if (!result.ok()) return [];
      return (await result.json()).deliveries.map(
        (d: { status: string }) => d.status,
      );
    })
    .toEqual(["SUCCEEDED", "SUCCEEDED"]);
  await page.getByRole("link", { name: /Открыть событие/ }).click();
  await expect(
    page.getByRole("heading", { name: "Доставка · ERP" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Доставка · Billing" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Сверка", exact: true }).click();
  await page.getByLabel("Глобальный ID клиента").fill(created.record.id);
  await page.getByRole("button", { name: "Выполнить сверку" }).click();
  await expect(page.getByText("Расхождений нет.")).toBeVisible();
});

test("lab submits a real invalid event and shows quarantine", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("link", { name: "Лаборатория" }).click();
  await page
    .getByRole("button", { name: "Отправить неверный контракт" })
    .click();
  await expect(page.getByText(/"published": "invalid"/)).toBeVisible();
  await expect(page.getByText("INVALID_CONTRACT").first()).toBeVisible();
});

test("mobile viewer can read routes and cannot access lab", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "viewer");
  await expect(page.getByRole("link", { name: "Лаборатория" })).toHaveCount(0);
  await page.getByRole("link", { name: "Маршруты", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "customer.profile", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBe(390);
});

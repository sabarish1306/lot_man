import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ImportResult } from "../src/api";

let textResult: ImportResult;
let imageResult: ImportResult;
const fixture = (name: string) => path.resolve(".verification", name);

test.beforeAll(async ({ request }) => {
  test.setTimeout(900_000);
  execFileSync(
    process.env.PYTHON ||
      (process.platform === "win32"
        ? "../paddle-env/Scripts/python.exe"
        : "python3"),
    ["tests/create_fixtures.py"],
  );
  const schema = await request.get("/api/openapi.json");
  expect(
    schema.ok(),
    "Start the real FastAPI backend on port 8000 before running these tests.",
  ).toBeTruthy();
  async function result(id: string | undefined, name: string) {
    if (id)
      await expect
        .poll(async () => (await request.get(`/api/imports/${id}`)).ok(), {
          timeout: 600_000,
          intervals: [3000, 5000],
          message: "Waiting for the real in-flight import to finish",
        })
        .toBeTruthy();
    const response = id
      ? await request.get(`/api/imports/${id}`)
      : await request.post("/api/imports", {
          multipart: {
            file: {
              name,
              mimeType: "application/zip",
              buffer: readFileSync(fixture(name)),
            },
          },
          timeout: 0,
        });
    expect(response.ok()).toBeTruthy();
    return (await response.json()) as ImportResult;
  }
  textResult = await result(process.env.TEST_TEXT_IMPORT_ID, "text.zip");
});

async function openImport(page: Page, id: string) {
  await page.getByLabel("Have an import ID?").fill(id);
  await page.getByRole("button", { name: "Open import", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Import results", exact: true }),
  ).toBeVisible();
}

test("real upload, indeterminate loading, duplicate prevention, empty results and browser reopening", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "WhatsApp Ticket Import" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Process ZIP" }),
  ).toBeDisabled();
  await page.screenshot({
    path: "test-results/import-desktop.png",
    fullPage: true,
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let posts = 0;
  await page.route("**/api/imports", async (route) => {
    posts++;
    await gate;
    await route.continue();
  });
  await page
    .getByLabel("Choose WhatsApp export ZIP")
    .setInputFiles(fixture("empty.zip"));
  await page.getByRole("button", { name: "Process ZIP" }).click();
  await expect(
    page.getByText(
      "Processing messages and images. This may take several minutes.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Processing…", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Replace file" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Remove", exact: true }),
  ).toBeDisabled();
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/imports") &&
      response.request().method() === "POST",
  );
  release();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const saved = (await response.json()) as ImportResult;
  expect(posts).toBe(1);
  await expect(
    page.getByText("Accepted at import time: 0 (historical).", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No draft entries in this import" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /Needs review/ }).click();
  await expect(
    page.getByRole("heading", { name: "No issues reported" }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", {
      name: `Open import ${saved.import_id}`,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Import results", exact: true }),
  ).toBeVisible();
  const storage = await page.evaluate(() =>
    localStorage.getItem("ticket-import.opened.v1"),
  );
  expect(storage).toContain(saved.import_id);
  expect(storage).not.toContain("Frontend verification");
});

test("real drafts preserve zeros, duplicates, source timestamps, search, and keyboard tabs", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await openImport(page, textResult.import_id);
  const expected = textResult.drafts.flatMap((draft) =>
    draft.tickets.map((ticket) => ticket.ticket_number),
  );
  expect(expected).toEqual(["001234", "007890", "001234"]);
  await expect(page.locator(".ticket-link span")).toHaveText(expected);
  await expect(
    page.getByText("Accepted at import time: 0 (historical).", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "View source for ticket 001234" })
    .first()
    .click();
  await expect(
    page.getByRole("complementary", { name: "Source message" }),
  ).toContainText("001234-5\n007890*2\n001234-5");
  await expect(page.locator(".source-panel dd").last()).toHaveText(
    textResult.drafts[0].message_timestamp_raw!,
  );
  await page.getByLabel("Search by ticket number or sender").fill("001234");
  await expect(page.locator(".ticket-link")).toHaveCount(2);
  await page
    .getByLabel("Search by ticket number or sender")
    .fill("frontend VERIFICATION");
  await expect(page.locator(".ticket-link")).toHaveCount(3);
  await page
    .getByLabel("Search by ticket number or sender")
    .fill("not-a-match");
  await expect(
    page.getByRole("heading", { name: "No matching entries" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await page.screenshot({
    path: "test-results/drafts-desktop.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: /Draft entries/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /Needs review/ })).toBeFocused();
  await expect(
    page.getByRole("heading", {
      name: "Attachment is missing or could not be matched.",
    }),
  ).toBeVisible();
  await expect(page.locator(".review-content img")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("real source image proxy, enlarged dialog, OCR and model details, and failed image fallback", async ({
  page,
  request,
}) => {
  test.setTimeout(900_000);
  const id = process.env.TEST_IMAGE_IMPORT_ID;
  if (id)
    await expect
      .poll(async () => (await request.get(`/api/imports/${id}`)).ok(), {
        timeout: 600_000,
        intervals: [5000],
        message: "Waiting for real OCR processing to finish",
      })
      .toBeTruthy();
  const response = id
    ? await request.get(`/api/imports/${id}`)
    : await request.post("/api/imports", {
        multipart: {
          file: {
            name: "image.zip",
            mimeType: "application/zip",
            buffer: readFileSync(fixture("image.zip")),
          },
        },
        timeout: 0,
      });
  expect(response.ok()).toBeTruthy();
  imageResult = (await response.json()) as ImportResult;
  await page.goto("/");
  await openImport(page, imageResult.import_id);
  await page.getByRole("tab", { name: /Needs review/ }).click();
  const image = page.locator(".image-trigger img").first();
  await expect(image).toHaveAttribute("src", /^\/api\/imports\//);
  await expect
    .poll(() =>
      image.evaluate(
        (element: HTMLImageElement) =>
          element.complete && element.naturalWidth > 0,
      ),
    )
    .toBeTruthy();
  const zoom = page.getByRole("button", {
    name: "Enlarge source image for issue 1",
  });
  await zoom.click();
  await expect(
    page.getByRole("dialog", { name: "Source image preview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Close image preview" }),
  ).toBeFocused();
  await page.screenshot({
    path: "test-results/image-preview.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(zoom).toBeFocused();
  const ocr = page
    .locator("summary")
    .filter({ hasText: /^OCR regions/ })
    .first();
  if (await ocr.count()) {
    await ocr.click();
    await expect(
      page.getByText(
        "Recognition scores do not guarantee correct digits. Check the source image.",
      ),
    ).toBeVisible();
    await expect(page.locator(".ocr-table tbody tr")).not.toHaveCount(0);
  }
  const suggested = page.getByText("Suggested extraction — unverified", {
    exact: true,
  });
  if (await suggested.count()) {
    await suggested.click();
    await expect(page.locator(".json-output")).toBeVisible();
  }
  await page.screenshot({
    path: "test-results/review-desktop.png",
    fullPage: true,
  });
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/image-review-mobile.png",
    fullPage: true,
  });
  await page.route("**/api/imports/*/images/*", (route) =>
    route.abort("failed"),
  );
  await page.reload();
  await page
    .getByRole("button", {
      name: `Open import ${imageResult.import_id}`,
      exact: true,
    })
    .click();
  await page.getByRole("tab", { name: /Needs review/ }).click();
  await expect(
    page.getByText("Image unavailable", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".image-trigger")).toHaveCount(0);
});

test("ZIP validation, drag and drop, replace/remove and 100 MB limit", async ({
  page,
}) => {
  await page.goto("/");
  const picker = page.getByLabel("Choose WhatsApp export ZIP");
  await picker.setInputFiles({
    name: "wrong.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("test"),
  });
  await expect(page.getByRole("alert")).toContainText(
    "Choose a WhatsApp export ZIP",
  );
  await page.locator(".drop-zone").evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["test input"], "dropped.zip", { type: "application/zip" }),
    );
    element.dispatchEvent(
      new DragEvent("drop", { bubbles: true, dataTransfer: transfer }),
    );
  });
  await expect(
    page.getByRole("heading", { name: "dropped.zip" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Process ZIP" })).toBeEnabled();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Replace file" }).click();
  await (await chooser).setFiles(fixture("empty.zip"));
  await expect(page.getByRole("heading", { name: "empty.zip" })).toBeVisible();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Process ZIP" }),
  ).toBeDisabled();
  await picker.evaluate((element: HTMLInputElement) => {
    const transfer = new DataTransfer();
    const file = new File(["size-check"], "oversize.zip", {
      type: "application/zip",
    });
    Object.defineProperty(file, "size", { value: 100 * 1024 * 1024 + 1 });
    transfer.items.add(file);
    element.files = transfer.files;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.getByRole("alert")).toContainText(
    "exceeds the 100 MB limit",
  );
});

test("real FastAPI detail strings, objects and validation arrays; no POST retry on network failure", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Have an import ID?").fill("0".repeat(32));
  await page.getByRole("button", { name: "Open import", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Import not found.");
  await page.getByLabel("Choose WhatsApp export ZIP").setInputFiles({
    name: "invalid.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("not a ZIP"),
  });
  await page.getByRole("button", { name: "Process ZIP" }).click();
  await expect(page.getByRole("alert")).toContainText("import_id:");
  await expect(page.getByRole("alert")).toContainText("File is not a zip file");
  // Send a deliberately missing form field; the 422 response is from FastAPI.
  await page.route("**/api/imports", (route) =>
    route.continue({
      postData: "",
      headers: { "content-type": "application/json" },
    }),
  );
  await page.getByRole("button", { name: "Process ZIP" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "body → file: Field required",
  );
  await page.unroute("**/api/imports");
  let attempts = 0;
  await page.route("**/api/imports", (route) => {
    attempts++;
    return route.abort("failed");
  });
  await page.getByRole("button", { name: "Process ZIP" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Server processing may still be running",
  );
  expect(attempts).toBe(1);
  await page.route("**/api/imports/*", (route) => route.abort("failed"));
  await page.getByRole("button", { name: "Open import", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Could not reach the backend",
  );
});

test("mobile layout, escaped source text and unavailable browser storage", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Storage unavailable", "QuotaExceededError");
    };
  });
  await page.goto("/");
  await page.screenshot({
    path: "test-results/import-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page
    .getByLabel("Choose WhatsApp export ZIP")
    .setInputFiles(fixture("escaped.zip"));
  await page.getByRole("button", { name: "Process ZIP" }).click();
  await expect(
    page.getByRole("heading", { name: "Import results", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Browser storage is unavailable/)).toBeVisible();
  await page.getByRole("tab", { name: /Needs review/ }).click();
  await page.getByText("Original source message", { exact: true }).click();
  await expect(page.locator(".source-text")).toContainText(
    "<img src=x onerror=",
  );
  await expect(page.locator(".source-text img")).toHaveCount(0);
  await page.screenshot({
    path: "test-results/review-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await openImport(page, textResult.import_id);
  await expect(page.locator(".ticket-link")).toHaveCount(3);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});

test("upload and results pass automated accessibility checks", async ({
  page,
}) => {
  await page.goto("/");
  const upload = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(upload.violations).toEqual([]);
  await openImport(page, textResult.import_id);
  const drafts = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(drafts.violations).toEqual([]);
  await page.getByRole("tab", { name: /Needs review/ }).click();
  const review = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(review.violations).toEqual([]);
});

// Final-record lookup checks now live in tickets.spec.ts with isolated storage.

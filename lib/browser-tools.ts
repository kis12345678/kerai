import { tool } from "ai";
import { z } from "zod";
import { chromium, type Browser, type Page } from "playwright";

const NAV_TIMEOUT_MS = 20_000;
const ACTION_TIMEOUT_MS = 10_000;
const MAX_TEXT_CHARS = 20_000;

declare global {
  var __omniaiBrowser: Browser | undefined;
  var __omniaiPage: Page | undefined;
}

// Singleton browser/page kept on globalThis so it survives Next.js dev-mode module reloads and
// stays open across tool calls — navigating, then clicking, then reading is one continuous session.
async function getPage(): Promise<Page> {
  if (!globalThis.__omniaiBrowser || !globalThis.__omniaiBrowser.isConnected()) {
    globalThis.__omniaiBrowser = await chromium.launch({ headless: true });
  }
  if (!globalThis.__omniaiPage || globalThis.__omniaiPage.isClosed()) {
    globalThis.__omniaiPage = await globalThis.__omniaiBrowser.newPage();
  }
  return globalThis.__omniaiPage;
}

function truncate(text: string): string {
  return text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n…(truncated)` : text;
}

export function createBrowserTools() {
  const browserNavigate = tool({
    description:
      "Open a URL in a real, persistent headless browser tab (survives across calls — this is one " +
      "continuous session, not a fresh tab each time). Use this instead of webFetch when a page needs " +
      "JavaScript to render, or before clicking/typing on it.",
    inputSchema: z.object({ url: z.string() }),
    execute: async ({ url }) => {
      try {
        const page = await getPage();
        await page.goto(url, { timeout: NAV_TIMEOUT_MS, waitUntil: "domcontentloaded" });
        const title = await page.title();
        return { url: page.url(), title };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  });

  const browserGetText = tool({
    description: "Get the visible text content of the current browser tab.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const page = await getPage();
        const text = await page.locator("body").innerText();
        return { url: page.url(), text: truncate(text) };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  });

  const browserScreenshot = tool({
    description: "Take a screenshot of the current browser tab and return it as an image.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const page = await getPage();
        const buffer = await page.screenshot({ type: "png" });
        return { url: page.url(), image: `data:image/png;base64,${buffer.toString("base64")}` };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  });

  const browserClick = tool({
    description:
      "Click an element in the current browser tab, by CSS selector or by its visible text. " +
      "Requires user approval.",
    inputSchema: z.object({
      selector: z.string().optional().describe("CSS selector to click"),
      text: z.string().optional().describe("Visible text to click, if selector isn't known"),
    }),
    execute: async ({ selector, text }) => {
      try {
        const page = await getPage();
        if (selector) {
          await page.locator(selector).first().click({ timeout: ACTION_TIMEOUT_MS });
        } else if (text) {
          await page.getByText(text, { exact: false }).first().click({ timeout: ACTION_TIMEOUT_MS });
        } else {
          return { error: "Provide either selector or text" };
        }
        return { success: true, url: page.url() };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  });

  const browserType = tool({
    description: "Type text into an input/textarea in the current browser tab. Requires user approval.",
    inputSchema: z.object({
      selector: z.string(),
      text: z.string(),
    }),
    execute: async ({ selector, text }) => {
      try {
        const page = await getPage();
        await page.locator(selector).first().fill(text, { timeout: ACTION_TIMEOUT_MS });
        return { success: true };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  });

  const browserPressKey = tool({
    description:
      "Press a keyboard key in the current browser tab (e.g. \"Enter\" to submit a form/search box). " +
      "Requires user approval.",
    inputSchema: z.object({ key: z.string() }),
    execute: async ({ key }) => {
      try {
        const page = await getPage();
        await page.keyboard.press(key);
        return { success: true };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  });

  return {
    browserNavigate,
    browserGetText,
    browserScreenshot,
    browserClick,
    browserType,
    browserPressKey,
  };
}

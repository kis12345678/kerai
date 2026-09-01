/**
 * KERAI Browser Engine
 *
 * Playwright-based browser automation with:
 * - Open/close browser sessions
 * - Navigate to URLs
 * - Search (Google, Bing, DuckDuckGo)
 * - Extract page content (text, links, images, headings)
 * - Click elements by selector
 * - Type text into inputs
 * - Fill forms
 * - Take screenshots
 * - Execute JavaScript
 * - Get page info (title, URL, meta)
 *
 * Priority over coordinates:
 *   1. Official API
 *   2. DOM / selectors
 *   3. Accessibility tree
 *   4. Vision (screenshot)
 */

import type { Browser, Page, BrowserContext } from "playwright-core";

// ── Browser Manager ────────────────────────────────────────────

let _browser: Browser | null = null;
let _context: BrowserContext | null = null;
let _page: Page | null = null;

async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser;

  const { chromium } = await import("playwright-core");

  // Detect environment
  const isVercel = !!process.env.VERCEL;
  const isWindows = process.platform === "win32";

  const launchOptions: Record<string, any> = {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
    ],
  };

  // On local Windows, try to find installed Chromium
  if (isWindows && !isVercel) {
    const possiblePaths = [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    ];
    const fs = await import("node:fs");
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        launchOptions.executablePath = p;
        break;
      }
    }
  }

  // On Vercel, use the bundled chromium
  if (isVercel) {
    launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
  }

  try {
    _browser = await chromium.launch(launchOptions);
    _context = await _browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1920, height: 1080 },
      locale: "en-US",
      timezoneId: "America/New_York",
    });
    _page = await _context.newPage();
    console.log("[Browser] Chromium launched successfully");
    return _browser;
  } catch (err) {
    console.error("[Browser] Failed to launch Chromium:", (err as Error).message);
    throw new Error(`Browser launch failed: ${(err as Error).message}. On Vercel, ensure playwright is in devDependencies and browsers are installed at build time.`);
  }
}

async function getPage(): Promise<Page> {
  await getBrowser();
  if (!_page || _page.isClosed()) {
    _page = await _context!.newPage();
  }
  return _page;
}

export async function closeBrowser(): Promise<void> {
  try {
    if (_page && !_page.isClosed()) await _page.close().catch(() => {});
    if (_context) await _context.close().catch(() => {});
    if (_browser) await _browser.close().catch(() => {});
  } catch { /* ignore */ }
  _page = null;
  _context = null;
  _browser = null;
  _browser = null;
  console.log("[Browser] Closed");
}

// ── Browser Operations ─────────────────────────────────────────

export interface PageInfo {
  title: string;
  url: string;
  description: string;
  keywords: string;
  favicon: string;
  charset: string;
}

export interface ExtractedContent {
  title: string;
  url: string;
  text: string;
  headings: { level: string; text: string }[];
  links: { text: string; url: string }[];
  images: { alt: string; src: string }[];
  meta: Record<string, string>;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface ElementInfo {
  tag: string;
  text: string;
  href?: string;
  id?: string;
  className?: string;
  visible: boolean;
}

/**
 * Navigate to a URL
 */
export async function navigate(url: string): Promise<{ title: string; url: string; status: number }> {
  const page = await getPage();
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  return {
    title: await page.title(),
    url: page.url(),
    status: response?.status() ?? 0,
  };
}

/**
 * Get page info (title, meta tags)
 */
export async function getPageInfo(): Promise<PageInfo> {
  const page = await getPage();
  return page.evaluate(() => {
    const getMeta = (name: string) => {
      const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
      return el?.getAttribute("content") || "";
    };
    return {
      title: document.title,
      url: window.location.href,
      description: getMeta("description") || getMeta("og:description"),
      keywords: getMeta("keywords"),
      favicon: document.querySelector("link[rel='icon']")?.getAttribute("href") || "",
      charset: document.characterSet || "UTF-8",
    };
  });
}

/**
 * Extract content from the current page
 */
export async function extractContent(maxLength: number = 50000): Promise<ExtractedContent> {
  const page = await getPage();
  return page.evaluate((max) => {
    // Extract text content
    const body = document.body;
    const text = body?.innerText?.slice(0, max) || "";

    // Extract headings
    const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"))
      .map((h) => ({ level: h.tagName.toLowerCase(), text: h.textContent?.trim() || "" }))
      .filter((h) => h.text.length > 0)
      .slice(0, 50);

    // Extract links
    const links = Array.from(document.querySelectorAll("a[href]"))
      .map((a) => ({ text: a.textContent?.trim() || "", url: (a as HTMLAnchorElement).href }))
      .filter((l) => l.text.length > 0 && l.url.startsWith("http"))
      .slice(0, 100);

    // Extract images
    const images = Array.from(document.querySelectorAll("img"))
      .map((img) => ({ alt: img.alt || "", src: img.src || "" }))
      .filter((i) => i.src.length > 0)
      .slice(0, 50);

    // Extract meta tags
    const meta: Record<string, string> = {};
    document.querySelectorAll("meta[name], meta[property]").forEach((m) => {
      const key = m.getAttribute("name") || m.getAttribute("property") || "";
      const val = m.getAttribute("content") || "";
      if (key && val) meta[key] = val;
    });

    return { title: document.title, url: window.location.href, text, headings, links, images, meta };
  }, maxLength);
}

/**
 * Search the web using a search engine
 */
export async function searchWeb(
  query: string,
  engine: "google" | "bing" | "duckduckgo" = "google",
  maxResults: number = 10
): Promise<SearchResult[]> {
  const page = await getPage();

  const urls: Record<string, string> = {
    google: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
    bing: `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
    duckduckgo: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
  };

  await page.goto(urls[engine], { waitUntil: "domcontentloaded", timeout: 30000 });

  // Wait for results to load
  await page.waitForTimeout(2000);

  // Extract search results
  return page.evaluate((max) => {
    const results: { title: string; url: string; snippet: string }[] = [];

    // Google results
    document.querySelectorAll("div.g, div[data-sokoban-container]").forEach((el) => {
      const linkEl = el.querySelector("a[href]");
      const titleEl = el.querySelector("h3");
      const snippetEl = el.querySelector(".VwiC3b, .IsZvec, [data-sncf]");
      if (linkEl && titleEl) {
        results.push({
          title: titleEl.textContent?.trim() || "",
          url: (linkEl as HTMLAnchorElement).href,
          snippet: snippetEl?.textContent?.trim() || "",
        });
      }
    });

    // Bing results
    if (results.length === 0) {
      document.querySelectorAll(".b_algo").forEach((el) => {
        const linkEl = el.querySelector("a[href]");
        const titleEl = el.querySelector("h2");
        const snippetEl = el.querySelector(".b_caption p");
        if (linkEl && titleEl) {
          results.push({
            title: titleEl.textContent?.trim() || "",
            url: (linkEl as HTMLAnchorElement).href,
            snippet: snippetEl?.textContent?.trim() || "",
          });
        }
      });
    }

    // DuckDuckGo results
    if (results.length === 0) {
      document.querySelectorAll("[data-testid='result']").forEach((el) => {
        const linkEl = el.querySelector("a[href]");
        const titleEl = el.querySelector("h2");
        const snippetEl = el.querySelector("[data-result='snippet']");
        if (linkEl && titleEl) {
          results.push({
            title: titleEl.textContent?.trim() || "",
            url: (linkEl as HTMLAnchorElement).href,
            snippet: snippetEl?.textContent?.trim() || "",
          });
        }
      });
    }

    return results.slice(0, max);
  }, maxResults);
}

/**
 * Click an element by CSS selector
 */
export async function clickElement(selector: string, options?: { waitForNavigation?: boolean }): Promise<void> {
  const page = await getPage();
  if (options?.waitForNavigation) {
    await Promise.all([
      page.waitForNavigation({ timeout: 15000 }).catch(() => {}),
      page.click(selector, { timeout: 10000 }),
    ]);
  } else {
    await page.click(selector, { timeout: 10000 });
  }
}

/**
 * Type text into an input field
 */
export async function typeText(selector: string, text: string, options?: { pressEnter?: boolean; clear?: boolean }): Promise<void> {
  const page = await getPage();
  if (options?.clear) {
    await page.fill(selector, "");
  }
  await page.type(selector, text, { delay: 30 });
  if (options?.pressEnter) {
    await page.keyboard.press("Enter");
  }
}

/**
 * Fill a form field
 */
export async function fillField(selector: string, value: string): Promise<void> {
  const page = await getPage();
  await page.fill(selector, value);
}

/**
 * Get all interactive elements on the page
 */
export async function getInteractiveElements(): Promise<ElementInfo[]> {
  const page = await getPage();
  return page.evaluate(() => {
    const selectors = "a, button, input, textarea, select, [role='button'], [onclick], [tabindex]";
    return Array.from(document.querySelectorAll(selectors))
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: el.textContent?.trim()?.slice(0, 100) || "",
        href: (el as HTMLAnchorElement).href || undefined,
        id: el.id || undefined,
        className: el.className ? String(el.className).slice(0, 100) : undefined,
        visible: true,
      }))
      .slice(0, 100);
  });
}

/**
 * Take a screenshot of the current page
 */
export async function takeScreenshot(options?: { fullPage?: boolean; selector?: string }): Promise<{ base64: string; width: number; height: number }> {
  const page = await getPage();

  let buffer: Buffer;
  if (options?.selector) {
    const el = await page.$(options.selector);
    buffer = el ? await el.screenshot({ type: "png" }) : await page.screenshot({ type: "png", fullPage: options?.fullPage });
  } else {
    buffer = await page.screenshot({ type: "png", fullPage: options?.fullPage });
  }

  return {
    base64: buffer.toString("base64"),
    width: page.viewportSize()?.width ?? 1920,
    height: page.viewportSize()?.height ?? 1080,
  };
}

/**
 * Execute JavaScript in the page context
 */
export async function executeScript(script: string): Promise<any> {
  const page = await getPage();
  return page.evaluate(script);
}

/**
 * Wait for an element to appear
 */
export async function waitForElement(selector: string, timeout: number = 10000): Promise<boolean> {
  const page = await getPage();
  try {
    await page.waitForSelector(selector, { timeout });
    return true;
  } catch {
    return false;
  }
}

/**
 * Scroll the page
 */
export async function scroll(direction: "up" | "down" | "top" | "bottom", amount?: number): Promise<void> {
  const page = await getPage();
  switch (direction) {
    case "top":
      await page.evaluate(() => window.scrollTo(0, 0));
      break;
    case "bottom":
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      break;
    case "up":
      await page.evaluate((a) => window.scrollBy(0, -(a || 500)), amount);
      break;
    case "down":
      await page.evaluate((a) => window.scrollBy(0, a || 500), amount);
      break;
  }
}

/**
 * Get the current page URL and title
 */
export async function getCurrentPage(): Promise<{ url: string; title: string }> {
  const page = await getPage();
  return { url: page.url(), title: await page.title() };
}

/**
 * Go back/forward in browser history
 */
export async function goBack(): Promise<void> {
  const page = await getPage();
  await page.goBack({ timeout: 15000 });
}

export async function goForward(): Promise<void> {
  const page = await getPage();
  await page.goForward({ timeout: 15000 });
}

/**
 * Download a file
 */
export async function downloadFile(url: string, filename?: string): Promise<{ path: string; size: number }> {
  const page = await getPage();
  const downloadPath = `/tmp/downloads/${filename || "download"}`;

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30000 }),
    page.goto(url),
  ]);

  const path = await download.path();
  if (!path) throw new Error("Download failed");

  const fs = await import("node:fs");
  const dest = downloadPath + (download.suggestedFilename() || "");
  fs.mkdirSync("/tmp/downloads", { recursive: true });
  fs.copyFileSync(path, dest);

  return { path: dest, size: fs.statSync(dest).size };
}

/**
 * Upload a file to an input[type=file]
 */
export async function uploadFile(selector: string, filePath: string): Promise<void> {
  const page = await getPage();
  await page.setInputFiles(selector, filePath);
}

/**
 * Check browser status
 */
export function getBrowserStatus(): { running: boolean; url: string | null } {
  return {
    running: !!_browser?.isConnected(),
    url: _page?.url() ?? null,
  };
}

// ── Cleanup on process exit ────────────────────────────────────

process.on("exit", () => {
  _browser?.close().catch(() => {});
});

process.on("SIGINT", () => {
  _browser?.close().catch(() => {});
  process.exit(0);
});

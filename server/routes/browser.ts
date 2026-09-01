/**
 * KERAI Browser API Routes
 *
 * REST API for browser automation:
 *   GET  /api/browser/status      - Browser status (running, current URL)
 *   POST /api/browser/navigate    - Navigate to URL
 *   GET  /api/browser/info        - Current page info
 *   GET  /api/browser/extract     - Extract page content
 *   POST /api/browser/search      - Web search
 *   POST /api/browser/click       - Click element
 *   POST /api/browser/type        - Type text
 *   POST /api/browser/fill        - Fill form field
 *   GET  /api/browser/elements    - Get interactive elements
 *   POST /api/browser/screenshot  - Take screenshot
 *   POST /api/browser/script      - Execute JavaScript
 *   POST /api/browser/scroll      - Scroll page
 *   POST /api/browser/wait        - Wait for element
 *   POST /api/browser/back        - Go back
 *   POST /api/browser/forward     - Go forward
 *   POST /api/browser/close       - Close browser
 */

import { RequestHandler } from "express";
import * as browser from "../lib/browser.js";

export const handleBrowserStatus: RequestHandler = (_req, res) => {
  const status = browser.getBrowserStatus();
  res.json({
    running: status.running,
    currentUrl: status.url,
    capabilities: [
      "navigate", "search", "extract", "click", "type", "fill",
      "screenshot", "script", "scroll", "elements", "download", "upload",
    ],
  });
};

export const handleBrowserNavigate: RequestHandler = async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) { res.status(400).json({ error: "url required" }); return; }
    const result = await browser.navigate(url);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const handleBrowserInfo: RequestHandler = async (_req, res) => {
  try {
    const info = await browser.getPageInfo();
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const handleBrowserExtract: RequestHandler = async (req, res) => {
  try {
    const maxLength = parseInt(req.query.maxLength as string) || 50000;
    const content = await browser.extractContent(maxLength);
    res.json(content);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const handleBrowserSearch: RequestHandler = async (req, res) => {
  try {
    const { query, engine, maxResults } = req.body;
    if (!query) { res.status(400).json({ error: "query required" }); return; }
    const results = await browser.searchWeb(query, engine || "google", maxResults || 10);
    res.json({ query, engine: engine || "google", results, total: results.length });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const handleBrowserClick: RequestHandler = async (req, res) => {
  try {
    const { selector, waitForNavigation } = req.body;
    if (!selector) { res.status(400).json({ error: "selector required" }); return; }
    await browser.clickElement(selector, { waitForNavigation });
    const page = await browser.getCurrentPage();
    res.json({ success: true, ...page });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const handleBrowserType: RequestHandler = async (req, res) => {
  try {
    const { selector, text, pressEnter, clear } = req.body;
    if (!selector || text === undefined) { res.status(400).json({ error: "selector and text required" }); return; }
    await browser.typeText(selector, text, { pressEnter, clear });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const handleBrowserFill: RequestHandler = async (req, res) => {
  try {
    const { selector, value } = req.body;
    if (!selector || value === undefined) { res.status(400).json({ error: "selector and value required" }); return; }
    await browser.fillField(selector, value);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const handleBrowserElements: RequestHandler = async (_req, res) => {
  try {
    const elements = await browser.getInteractiveElements();
    res.json({ elements, total: elements.length });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const handleBrowserScreenshot: RequestHandler = async (req, res) => {
  try {
    const { fullPage, selector } = req.body || {};
    const screenshot = await browser.takeScreenshot({ fullPage, selector });
    res.json({ width: screenshot.width, height: screenshot.height, base64: screenshot.base64 });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const handleBrowserScript: RequestHandler = async (req, res) => {
  try {
    const { script } = req.body;
    if (!script) { res.status(400).json({ error: "script required" }); return; }
    const result = await browser.executeScript(script);
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const handleBrowserScroll: RequestHandler = async (req, res) => {
  try {
    const { direction, amount } = req.body;
    await browser.scroll(direction || "down", amount);
    const page = await browser.getCurrentPage();
    res.json({ success: true, ...page });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const handleBrowserWait: RequestHandler = async (req, res) => {
  try {
    const { selector, timeout } = req.body;
    if (!selector) { res.status(400).json({ error: "selector required" }); return; }
    const found = await browser.waitForElement(selector, timeout || 10000);
    res.json({ found, selector });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const handleBrowserBack: RequestHandler = async (_req, res) => {
  try {
    await browser.goBack();
    const page = await browser.getCurrentPage();
    res.json({ success: true, ...page });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const handleBrowserForward: RequestHandler = async (_req, res) => {
  try {
    await browser.goForward();
    const page = await browser.getCurrentPage();
    res.json({ success: true, ...page });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const handleBrowserClose: RequestHandler = async (_req, res) => {
  try {
    await browser.closeBrowser();
    res.json({ success: true, message: "Browser closed" });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

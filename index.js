import express from "express";
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3051;

const IMAGES_DIR = path.join(__dirname, "images");
const TEMP_BASE = path.join(__dirname, "temp_downloads");

if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR);
if (!fs.existsSync(TEMP_BASE)) fs.mkdirSync(TEMP_BASE);

app.use("/public", express.static(path.join(__dirname, "public")));
app.get("/regenerate", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/card/:id", async (req, res) => {
  const discordId = req.params.id;
  const finalPath = path.join(IMAGES_DIR, `${discordId}.png`);

  if (fs.existsSync(finalPath)) {
    console.log(`[Cache Hit] Serving ${discordId}.png`);
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    return res.sendFile(finalPath);
  }

  const requestId = `${discordId}-${Date.now()}`;
  const requestDownloadPath = path.join(TEMP_BASE, requestId);
  fs.mkdirSync(requestDownloadPath);

  console.log(`[Cache Miss] Generating card for ${discordId}...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();

    const client = await page.target().createCDPSession();
    await client.send("Page.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: requestDownloadPath,
    });

    const targetUrl = `https://sekai.azaken.com/profile/${discordId}.png`;
    await page.goto(targetUrl, { waitUntil: "networkidle2" });

    let fileName = "";
    const timeout = 45000;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const files = fs.readdirSync(requestDownloadPath);
      const found = files.find((f) => f.endsWith(".png") && !f.endsWith(".crdownload"));

      if (found) {
        fileName = found;
        console.log(`[File Found] ${found} after ${Date.now() - start}ms`);
        break;
      }

      const elapsed = Date.now() - start;
      if (elapsed % 5000 === 0 && elapsed > 0) {
        console.log(`[Waiting] Still generating ${discordId}... (${elapsed}ms)`);
      }

      await new Promise((r) => setTimeout(r, 300));
    }

    if (fileName) {
      const tempFilePath = path.join(requestDownloadPath, fileName);

      await new Promise((r) => setTimeout(r, 500));
      const finalSize = fs.statSync(tempFilePath).size;

      fs.renameSync(tempFilePath, finalPath);
      console.log(`[Success] Card generated: ${discordId}.png (${finalSize} bytes)`);
      res.sendFile(finalPath);
    } else {
      console.error(`[Timeout] No file found for ${discordId} after ${timeout}ms`);
      res.status(504).send("Generation timed out.");
    }
  } catch (err) {
    console.error(`[Error] for ${discordId}:`, err.message);
    res.status(500).send("Server Error: " + err.message);
  } finally {
    try {
      await browser.close();
    } catch (e) {
      console.error("Error closing browser:", e.message);
    }
    if (fs.existsSync(requestDownloadPath)) {
      try {
        fs.rmSync(requestDownloadPath, { recursive: true, force: true });
      } catch (e) {
        console.error("Error cleaning temp folder:", e.message);
      }
    }
  }
});

app.get("/api/regenerate/:id", async (req, res) => {
  const discordId = req.params.id;
  const filePath = path.join(IMAGES_DIR, `${discordId}.png`);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`[Regenerate] Cleared cache for ${discordId}`);
  }

  const requestId = `${discordId}-${Date.now()}`;
  const requestDownloadPath = path.join(TEMP_BASE, requestId);
  fs.mkdirSync(requestDownloadPath);

  console.log(`[Regenerate] Generating fresh card for ${discordId}...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();

    const client = await page.target().createCDPSession();
    await client.send("Page.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: requestDownloadPath,
    });

    const targetUrl = `https://sekai.azaken.com/profile/${discordId}.png`;
    await page.goto(targetUrl, { waitUntil: "networkidle2" });

    let fileName = "";
    const timeout = 45000;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const files = fs.readdirSync(requestDownloadPath);
      const found = files.find((f) => f.endsWith(".png") && !f.endsWith(".crdownload"));

      if (found) {
        fileName = found;
        console.log(`[Regenerate] File found: ${found} after ${Date.now() - start}ms`);
        break;
      }

      await new Promise((r) => setTimeout(r, 300));
    }

    if (fileName) {
      const tempFilePath = path.join(requestDownloadPath, fileName);
      const finalPath = path.join(IMAGES_DIR, `${discordId}.png`);

      await new Promise((r) => setTimeout(r, 500));
      fs.renameSync(tempFilePath, finalPath);
      console.log(`[Regenerate] Success: ${discordId}.png regenerated`);
      res.json({ success: true, message: `Card for ${discordId} regenerated successfully` });
    } else {
      console.error(`[Regenerate] Timeout for ${discordId} after ${timeout}ms`);
      res.status(504).json({ success: false, message: "Generation timed out" });
    }
  } catch (err) {
    console.error(`[Regenerate] Error for ${discordId}:`, err.message);
    res.status(500).json({ success: false, message: "Server Error: " + err.message });
  } finally {
    try {
      await browser.close();
    } catch (e) {
      console.error("Error closing browser:", e.message);
    }
    if (fs.existsSync(requestDownloadPath)) {
      try {
        fs.rmSync(requestDownloadPath, { recursive: true, force: true });
      } catch (e) {
        console.error("Error cleaning temp folder:", e.message);
      }
    }
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/cache/status", (_req, res) => {
  const files = fs.readdirSync(IMAGES_DIR);
  const cached = files.filter((f) => f.endsWith(".png")).length;
  res.json({
    cached_images: cached,
    cache_dir: IMAGES_DIR,
    images: files.filter((f) => f.endsWith(".png")),
  });
});

app.delete("/api/cache/:id", (req, res) => {
  const discordId = req.params.id;
  const filePath = path.join(IMAGES_DIR, `${discordId}.png`);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`[Cache Cleared] ${discordId}.png`);
    res.json({ success: true, message: `Cleared cache for ${discordId}` });
  } else {
    res.status(404).json({ success: false, message: `No cache found for ${discordId}` });
  }
});

app.listen(PORT, () => console.log(`API running at http://localhost:${PORT}`));

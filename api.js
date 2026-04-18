const express = require("express");
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ─── Font Setup ───────────────────────────────────────────────────────────────
const FONT_PATH = path.join(process.cwd(), "TitilliumWeb-Black.ttf");
let fontRegistered = false;

function ensureFont() {
  if (fontRegistered) return;
  if (fs.existsSync(FONT_PATH)) {
    GlobalFonts.registerFromPath(FONT_PATH, "TitilliumWeb");
    fontRegistered = true;
    console.log("✅ Font TitilliumWeb-Black registered");
  } else {
    console.warn("⚠️  TitilliumWeb-Black.ttf not found, using fallback");
  }
}

// ─── HTTP Fetch Buffer ────────────────────────────────────────────────────────
function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, { timeout: 5000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error("HTTP " + res.statusCode + " for " + url));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

// ─── Emoji Helpers ────────────────────────────────────────────────────────────

// Regex emoji lengkap: ZWJ sequences, skin tones, flags, keycap
const EMOJI_RE = /(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*[\uFE0F\u20E3]?|\p{Regional_Indicator}{2}/gu;

function emojiToCodepoint(emoji) {
  const points = [];
  let i = 0;
  while (i < emoji.length) {
    const code = emoji.codePointAt(i);
    if (code !== 0xFE0F) points.push(code.toString(16)); // skip variation selector
    i += code > 0xFFFF ? 2 : 1;
  }
  return points.join("-");
}

function twemojiUrl(emoji) {
  const cp = emojiToCodepoint(emoji);
  return "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/" + cp + ".png";
}

const emojiCache = new Map();

async function getEmojiImage(emoji) {
  if (emojiCache.has(emoji)) return emojiCache.get(emoji);
  try {
    const buf = await fetchBuffer(twemojiUrl(emoji));
    const img = await loadImage(buf);
    emojiCache.set(emoji, img);
    return img;
  } catch (e) {
    console.warn("Emoji failed: " + emoji + " (" + emojiToCodepoint(emoji) + "): " + e.message);
    emojiCache.set(emoji, null);
    return null;
  }
}

// ─── Text Segmentation ────────────────────────────────────────────────────────

function segmentText(text) {
  const segments = [];
  let lastIndex = 0;
  const re = new RegExp(EMOJI_RE.source, "gu");
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const t = text.slice(lastIndex, match.index);
      if (t) segments.push({ type: "text", value: t });
    }
    segments.push({ type: "emoji", value: match[0] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    const t = text.slice(lastIndex);
    if (t) segments.push({ type: "text", value: t });
  }
  return segments;
}

// ─── Layout ───────────────────────────────────────────────────────────────────

function setFont(ctx, fontSize) {
  ctx.font = '900 ' + fontSize + 'px TitilliumWeb, Impact, "Arial Black", sans-serif';
}

function tokenWidth(ctx, seg, fontSize) {
  if (seg.type === "emoji") return fontSize * 1.1;
  setFont(ctx, fontSize);
  return ctx.measureText(seg.value).width;
}

function wrapSegments(ctx, segments, maxWidth, fontSize) {
  const lines = [[]];
  let curW = 0;

  for (const seg of segments) {
    if (seg.type === "text") {
      const words = seg.value.split(/(\s+)/);
      for (const word of words) {
        if (!word) continue;
        setFont(ctx, fontSize);
        const ww = ctx.measureText(word).width;
        if (word.trim() && curW + ww > maxWidth && curW > 0) {
          lines.push([]);
          curW = 0;
        }
        const last = lines[lines.length - 1];
        if (last.length > 0 && last[last.length - 1].type === "text") {
          last[last.length - 1].value += word;
        } else {
          last.push({ type: "text", value: word });
        }
        curW += ww;
      }
    } else {
      const ew = fontSize * 1.1;
      if (curW + ew > maxWidth && curW > 0) {
        lines.push([]);
        curW = 0;
      }
      lines[lines.length - 1].push(seg);
      curW += ew;
    }
  }
  return lines.filter((l) => l.length > 0);
}

function calcLineWidth(ctx, line, fontSize) {
  let w = 0;
  for (const seg of line) w += tokenWidth(ctx, seg, fontSize);
  return w;
}

function calcFontSize(ctx, segments, maxWidth, maxHeight, startSize, minSize) {
  let fs = startSize;
  while (fs >= minSize) {
    const lines = wrapSegments(ctx, segments, maxWidth, fs);
    const totalH = lines.length * fs * 1.35;
    let ok = totalH <= maxHeight;
    if (ok) {
      for (const line of lines) {
        if (calcLineWidth(ctx, line, fs) > maxWidth) { ok = false; break; }
      }
    }
    if (ok) return { fontSize: fs, lines };
    fs -= 2;
  }
  return { fontSize: minSize, lines: wrapSegments(ctx, segments, maxWidth, minSize) };
}

async function drawLine(ctx, line, startX, baselineY, fontSize, fillColor, strokeColor, strokeWidth) {
  let x = startX;
  setFont(ctx, fontSize);

  for (const seg of line) {
    if (seg.type === "emoji") {
      const img = await getEmojiImage(seg.value);
      const eSize = fontSize * 1.1;
      if (img) {
        // posisi: top of emoji sejajar cap-height teks
        const emojiTop = baselineY - fontSize * 0.88;
        ctx.drawImage(img, x, emojiTop, eSize, eSize);
      }
      x += eSize;
    } else {
      setFont(ctx, fontSize);
      if (strokeWidth > 0) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.lineJoin = "round";
        ctx.strokeText(seg.value, x, baselineY);
      }
      ctx.fillStyle = fillColor;
      ctx.fillText(seg.value, x, baselineY);
      setFont(ctx, fontSize);
      x += ctx.measureText(seg.value).width;
    }
  }
}

async function drawTextBlock(ctx, opts) {
  const {
    text, x, y, maxWidth, maxHeight,
    align = "center",
    fillColor = "#FFFFFF", strokeColor = "#000000", strokeWidth = 5,
    startFontSize = 60, minFontSize = 14,
    position = "bottom",
    canvasWidth, canvasHeight,
  } = opts;

  if (!text || !text.trim()) return;

  const segments = segmentText(text);

  // Pre-fetch emoji paralel
  await Promise.all(
    segments.filter((s) => s.type === "emoji").map((s) => getEmojiImage(s.value))
  );

  ctx.textBaseline = "alphabetic";
  const { fontSize, lines } = calcFontSize(ctx, segments, maxWidth, maxHeight, startFontSize, minFontSize);

  const lineH = fontSize * 1.35;
  const totalH = lines.length * lineH;

  // startY = baseline of first line
  let startY;
  if (position === "top") {
    startY = y + fontSize;
  } else if (position === "bottom") {
    startY = canvasHeight - y - totalH + fontSize;
  } else if (position === "center") {
    startY = (canvasHeight - totalH) / 2 + fontSize;
  } else {
    startY = y + fontSize;
  }

  for (let i = 0; i < lines.length; i++) {
    const lw = calcLineWidth(ctx, lines[i], fontSize);
    let lineX;
    if (align === "center") lineX = x + (maxWidth - lw) / 2;
    else if (align === "right") lineX = x + maxWidth - lw;
    else lineX = x;

    await drawLine(ctx, lines[i], lineX, startY + i * lineH, fontSize, fillColor, strokeColor, strokeWidth);
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.json({
    name: "Meme Maker API",
    version: "2.0.0",
    description: "TitilliumWeb-Black + Twemoji emoji (rendered as image) + auto-resize text",
    endpoints: { "GET /health": "Health", "POST /meme": "JSON body", "GET /meme": "Query params" },
    params: {
      imageUrl: "background image URL (optional)",
      topText: "teks atas — emoji support 😂🔥✅",
      bottomText: "teks bawah",
      width: 800, height: 600,
      bgColor: "#000000",
      textColor: "#FFFFFF", strokeColor: "#000000", strokeWidth: 5,
      fontSize: 60, format: "png|jpeg", quality: 90,
    },
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", font: fontRegistered ? "TitilliumWeb-Black" : "fallback", emojiCached: emojiCache.size });
});

async function generateMeme(params) {
  ensureFont();
  const {
    imageUrl = null, topText = "", bottomText = "",
    width = 800, height = 600, bgColor = "#000000",
    textColor = "#FFFFFF", strokeColor = "#000000",
    strokeWidth = 5, fontSize = 60, format = "png", quality = 90,
  } = params;

  const W = Math.min(Math.max(parseInt(width) || 800, 100), 2000);
  const H = Math.min(Math.max(parseInt(height) || 600, 100), 2000);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  if (imageUrl) {
    try {
      const buf = await fetchBuffer(imageUrl);
      const img = await loadImage(buf);
      const scale = Math.max(W / img.width, H / img.height);
      const sw = img.width * scale, sh = img.height * scale;
      ctx.drawImage(img, (W - sw) / 2, (H - sh) / 2, sw, sh);
    } catch (e) {
      console.warn("BG image failed:", e.message);
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, W, H);
    }
  } else {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, W, H);
  }

  const pad = Math.floor(W * 0.04);
  const maxTW = W - pad * 2;
  const maxTH = H * 0.38;
  const fs = parseInt(fontSize) || 60;
  const sw2 = parseInt(strokeWidth) ?? 5;
  const sharedOpts = { x: pad, maxWidth: maxTW, maxHeight: maxTH, align: "center", fillColor: textColor, strokeColor, strokeWidth: sw2, startFontSize: fs, minFontSize: 14, canvasWidth: W, canvasHeight: H };

  await drawTextBlock(ctx, { ...sharedOpts, text: topText, y: pad, position: "top" });
  await drawTextBlock(ctx, { ...sharedOpts, text: bottomText, y: pad, position: "bottom" });

  if (format === "jpeg" || format === "jpg") {
    const buf = await canvas.toBuffer("image/jpeg", Math.min(Math.max(parseInt(quality) || 90, 1), 100));
    return { buffer: buf, contentType: "image/jpeg" };
  }
  const buf = await canvas.toBuffer("image/png");
  return { buffer: buf, contentType: "image/png" };
}

app.post("/meme", async (req, res) => {
  try {
    const r = await generateMeme(req.body);
    res.set("Content-Type", r.contentType).set("Content-Length", r.buffer.length)
       .set("Cache-Control", "public, max-age=3600").send(r.buffer);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/meme", async (req, res) => {
  try {
    const r = await generateMeme(req.query);
    res.set("Content-Type", r.contentType).set("Content-Length", r.buffer.length)
       .set("Cache-Control", "public, max-age=3600").send(r.buffer);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => { console.log("🚀 http://localhost:" + PORT); ensureFont(); });
}

module.exports = app;

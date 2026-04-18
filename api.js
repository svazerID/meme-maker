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
    const req = client.get(url, { timeout: 6000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error("HTTP " + res.statusCode + " -> " + url));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout: " + url)); });
  });
}

// ─── Emoji CDN URLs ───────────────────────────────────────────────────────────
//
// Konversi emoji glyph → codepoint hex string
// "😂" → "1f602"   |   "❤️" → "2764-fe0f"   |   "👨‍💻" → "1f468-200d-1f4bb"
//
function emojiToCodepoint(emoji) {
  const points = [];
  let i = 0;
  while (i < emoji.length) {
    const code = emoji.codePointAt(i);
    points.push(code.toString(16));
    i += code > 0xFFFF ? 2 : 1;
  }
  return points.join("-");
}

// Versi tanpa variation selector FE0F (dipakai beberapa CDN)
function emojiToCodepointNoVS(emoji) {
  const points = [];
  let i = 0;
  while (i < emoji.length) {
    const code = emoji.codePointAt(i);
    if (code !== 0xFE0F) points.push(code.toString(16));
    i += code > 0xFFFF ? 2 : 1;
  }
  return points.join("-");
}

// Kandidat URL per emoji — dicoba urut dari atas, pertama yang berhasil dipakai
function emojiUrlCandidates(emoji) {
  const cp    = emojiToCodepoint(emoji);       // dengan FE0F
  const cpNvs = emojiToCodepointNoVS(emoji);   // tanpa FE0F

  return [
    // 1. Fluent CDN (Microsoft Fluent UI, mirip Apple, 100x100)
    `https://emoji.fluent-cdn.com/1.0.0/100x100/${cp}.png`,
    `https://emoji.fluent-cdn.com/1.0.0/100x100/${cpNvs}.png`,

    // 2. Fluent 3D via jsDelivr (Twemoji-compatible format, 3D style)
    `https://cdn.jsdelivr.net/gh/ehne/fluentui-twemoji-3d@main/export/3D_png/${cpNvs}.png`,
    `https://cdn.jsdelivr.net/gh/ehne/fluentui-twemoji-3d@main/export/3D_png/${cp}.png`,

    // 3. Twemoji (fallback terakhir)
    `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/${cpNvs}.png`,
    `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/${cp}.png`,
  ];
}

// Cache: emoji string → loadImage result (atau null jika gagal semua)
const emojiCache = new Map();

async function getEmojiImage(emoji) {
  if (emojiCache.has(emoji)) return emojiCache.get(emoji);

  const candidates = emojiUrlCandidates(emoji);
  for (const url of candidates) {
    try {
      const buf = await fetchBuffer(url);
      const img = await loadImage(buf);
      console.log("✅ Emoji loaded: " + emoji + " <- " + url);
      emojiCache.set(emoji, img);
      return img;
    } catch (e) {
      // coba kandidat berikutnya
    }
  }

  console.warn("❌ Emoji not found: " + emoji + " (" + emojiToCodepoint(emoji) + ")");
  emojiCache.set(emoji, null);
  return null;
}

// ─── Text Segmentation ────────────────────────────────────────────────────────
// Memisahkan teks biasa dan emoji menjadi array segment { type, value }

const EMOJI_RE = /(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*[\uFE0F\u20E3]?|\p{Regional_Indicator}{2}/gu;

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

// ─── Layout Helpers ───────────────────────────────────────────────────────────

function setFont(ctx, fontSize) {
  ctx.font = '900 ' + fontSize + 'px TitilliumWeb, Impact, "Arial Black", sans-serif';
}

function tokenWidth(ctx, seg, fontSize) {
  if (seg.type === "emoji") return fontSize * 1.15; // emoji sedikit lebih lebar
  setFont(ctx, fontSize);
  return ctx.measureText(seg.value).width;
}

// Word-wrap: kembalikan array of lines, tiap line = array of segments
function wrapSegments(ctx, segments, maxWidth, fontSize) {
  const lines = [[]];
  let curW = 0;

  for (const seg of segments) {
    if (seg.type === "text") {
      // pecah per kata (pertahankan spasi)
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
      const ew = fontSize * 1.15;
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

// Auto-resize: cari fontSize terbesar yang masih muat
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

// ─── Draw ─────────────────────────────────────────────────────────────────────

async function drawLine(ctx, line, startX, baselineY, fontSize, fillColor, strokeColor, strokeWidth) {
  let x = startX;
  for (const seg of line) {
    if (seg.type === "emoji") {
      const img = await getEmojiImage(seg.value);
      const eSize = fontSize * 1.15;
      if (img) {
        // sejajarkan vertically: top emoji = baseline - cap-height (~88%)
        const emojiTop = baselineY - fontSize * 0.9;
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
    fillColor = "#FFFFFF",
    strokeColor = "#000000",
    strokeWidth = 5,
    startFontSize = 60,
    minFontSize = 14,
    position = "bottom",
    canvasWidth,
    canvasHeight,
  } = opts;

  if (!text || !text.trim()) return;

  const segments = segmentText(text);

  // Pre-fetch semua emoji secara paralel sebelum render
  await Promise.all(
    segments.filter((s) => s.type === "emoji").map((s) => getEmojiImage(s.value))
  );

  ctx.textBaseline = "alphabetic";
  const { fontSize, lines } = calcFontSize(ctx, segments, maxWidth, maxHeight, startFontSize, minFontSize);

  const lineH   = fontSize * 1.35;
  const totalH  = lines.length * lineH;

  // Hitung Y awal (baseline baris pertama)
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
    if (align === "center")     lineX = x + (maxWidth - lw) / 2;
    else if (align === "right") lineX = x + maxWidth - lw;
    else                        lineX = x;

    await drawLine(ctx, lines[i], lineX, startY + i * lineH, fontSize, fillColor, strokeColor, strokeWidth);
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.json({
    name: "Meme Maker API",
    version: "3.0.0",
    description: "TitilliumWeb-Black + Microsoft FluentUI Emoji (3D, mirip Apple) + auto-resize",
    emoji_source: "Microsoft Fluent UI Emoji via fluent-cdn.com (fallback: Twemoji)",
    endpoints: {
      "GET /health": "Health check",
      "POST /meme":  "Generate meme via JSON body",
      "GET /meme":   "Generate meme via query params",
    },
    params: {
      imageUrl:    "string  — background image URL (optional)",
      topText:     "string  — teks atas, support emoji 😂🔥✅",
      bottomText:  "string  — teks bawah, support emoji",
      width:       "number  — default 800",
      height:      "number  — default 600",
      bgColor:     "string  — default #000000 (dipakai jika tidak ada imageUrl)",
      textColor:   "string  — default #FFFFFF",
      strokeColor: "string  — default #000000",
      strokeWidth: "number  — default 5",
      fontSize:    "number  — default 60 (auto-resize jika teks panjang)",
      format:      "png | jpeg  — default png",
      quality:     "number 1-100  — default 90 (khusus jpeg)",
    },
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    font: fontRegistered ? "TitilliumWeb-Black" : "fallback",
    emojiCached: emojiCache.size,
    emojiSource: "Microsoft FluentUI (fluent-cdn.com) + fallback Twemoji",
  });
});

// ─── Core Generator ───────────────────────────────────────────────────────────

async function generateMeme(params) {
  ensureFont();

  const {
    imageUrl    = null,
    topText     = "",
    bottomText  = "",
    width       = 800,
    height      = 600,
    bgColor     = "#000000",
    textColor   = "#FFFFFF",
    strokeColor = "#000000",
    strokeWidth = 5,
    fontSize    = 60,
    format      = "png",
    quality     = 90,
  } = params;

  const W = Math.min(Math.max(parseInt(width)  || 800, 100), 2000);
  const H = Math.min(Math.max(parseInt(height) || 600, 100), 2000);

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  // ── Background ──
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

  const pad    = Math.floor(W * 0.04);
  const maxTW  = W - pad * 2;
  const maxTH  = H * 0.38;
  const fs     = parseInt(fontSize)    || 60;
  const sw2    = parseInt(strokeWidth) ?? 5;

  const shared = {
    x: pad, maxWidth: maxTW, maxHeight: maxTH,
    align: "center",
    fillColor: textColor, strokeColor, strokeWidth: sw2,
    startFontSize: fs, minFontSize: 14,
    canvasWidth: W, canvasHeight: H,
  };

  await drawTextBlock(ctx, { ...shared, text: topText,    y: pad, position: "top"    });
  await drawTextBlock(ctx, { ...shared, text: bottomText, y: pad, position: "bottom" });

  if (format === "jpeg" || format === "jpg") {
    const buf = await canvas.toBuffer("image/jpeg", Math.min(Math.max(parseInt(quality) || 90, 1), 100));
    return { buffer: buf, contentType: "image/jpeg" };
  }
  const buf = await canvas.toBuffer("image/png");
  return { buffer: buf, contentType: "image/png" };
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

app.post("/meme", async (req, res) => {
  try {
    const r = await generateMeme(req.body);
    res.set("Content-Type",   r.contentType)
       .set("Content-Length", r.buffer.length)
       .set("Cache-Control",  "public, max-age=3600")
       .send(r.buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get("/meme", async (req, res) => {
  try {
    const r = await generateMeme(req.query);
    res.set("Content-Type",   r.contentType)
       .set("Content-Length", r.buffer.length)
       .set("Cache-Control",  "public, max-age=3600")
       .send(r.buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ─── Server ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log("🚀 Meme Maker API v3 — http://localhost:" + PORT);
    ensureFont();
  });
}

module.exports = app;

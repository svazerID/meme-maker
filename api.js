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

// ─── HTTP Fetch ───────────────────────────────────────────────────────────────
function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, { timeout: 6000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

// ─── Emoji CDN ────────────────────────────────────────────────────────────────

// Codepoint dengan dash separator, tanpa FE0F — untuk Twemoji & Fluent CDN
// "😂" → "1f602"  |  "❤️" → "2764"  |  "👨‍💻" → "1f468-200d-1f4bb"
function cpDash(emoji) {
  const pts = [];
  let i = 0;
  while (i < emoji.length) {
    const c = emoji.codePointAt(i);
    if (c !== 0xFE0F) pts.push(c.toString(16));
    i += c > 0xFFFF ? 2 : 1;
  }
  return pts.join("-");
}

// Codepoint dengan underscore separator, tanpa FE0F — untuk Noto Emoji
// "😂" → "1f602"  |  "👨‍💻" → "1f468_200d_1f4bb"
function cpUnder(emoji) {
  return cpDash(emoji).replace(/-/g, "_");
}

// Noto Emoji via jsDelivr dari GitHub googlefonts/noto-emoji
// Format: emoji_u{codepoint_underscore}.png (size 128px)
function notoUrl(emoji) {
  return "https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@main/png/128/emoji_u" + cpUnder(emoji) + ".png";
}

// Twemoji fallback
function twemojiUrl(emoji) {
  return "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/" + cpDash(emoji) + ".png";
}

// Kandidat URL diurutkan: Noto (Android) → Twemoji fallback
function emojiCandidates(emoji) {
  const dash  = cpDash(emoji);
  const under = cpUnder(emoji);

  // Beberapa emoji punya FE0F di codepoint — buat versi dengan FE0F juga
  const dashFull = (() => {
    const pts = [];
    let i = 0;
    while (i < emoji.length) {
      const c = emoji.codePointAt(i);
      pts.push(c.toString(16));
      i += c > 0xFFFF ? 2 : 1;
    }
    return pts.join("-");
  })();
  const underFull = dashFull.replace(/-/g, "_");

  return [
    // 1. Noto Color Emoji (Google / Android style) — tanpa FE0F
    "https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@main/png/128/emoji_u" + under + ".png",
    // 2. Noto — dengan FE0F (beberapa emoji butuh ini)
    "https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@main/png/128/emoji_u" + underFull + ".png",
    // 3. Twemoji fallback — tanpa FE0F
    "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/" + dash + ".png",
    // 4. Twemoji fallback — dengan FE0F
    "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/" + dashFull + ".png",
  ];
}

const emojiCache = new Map();

async function getEmojiImage(emoji) {
  if (emojiCache.has(emoji)) return emojiCache.get(emoji);

  for (const url of emojiCandidates(emoji)) {
    try {
      const buf = await fetchBuffer(url);
      const img = await loadImage(buf);
      console.log("✅ emoji " + emoji + " <- " + new URL(url).hostname);
      emojiCache.set(emoji, img);
      return img;
    } catch (_) { /* coba berikutnya */ }
  }

  console.warn("❌ emoji not found: " + emoji + " (" + cpDash(emoji) + ")");
  emojiCache.set(emoji, null);
  return null;
}

// ─── Text Segmentation ────────────────────────────────────────────────────────

const EMOJI_RE = /(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*[\uFE0F\u20E3]?|\p{Regional_Indicator}{2}/gu;

function segmentText(text) {
  const out = [];
  let last = 0;
  const re = new RegExp(EMOJI_RE.source, "gu");
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ type: "text", value: text.slice(last, m.index) });
    out.push({ type: "emoji", value: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out.filter((s) => s.value);
}

// ─── Layout ───────────────────────────────────────────────────────────────────

function setFont(ctx, fs) {
  ctx.font = '900 ' + fs + 'px TitilliumWeb, Impact, "Arial Black", sans-serif';
}

function segW(ctx, seg, fs) {
  if (seg.type === "emoji") return fs * 1.2;
  setFont(ctx, fs);
  return ctx.measureText(seg.value).width;
}

function wrapSegs(ctx, segs, maxW, fs) {
  const lines = [[]];
  let cur = 0;
  for (const seg of segs) {
    if (seg.type === "text") {
      for (const word of seg.value.split(/(\s+)/)) {
        if (!word) continue;
        setFont(ctx, fs);
        const ww = ctx.measureText(word).width;
        if (word.trim() && cur + ww > maxW && cur > 0) { lines.push([]); cur = 0; }
        const last = lines[lines.length - 1];
        if (last.length && last[last.length - 1].type === "text") last[last.length - 1].value += word;
        else last.push({ type: "text", value: word });
        cur += ww;
      }
    } else {
      const ew = fs * 1.2;
      if (cur + ew > maxW && cur > 0) { lines.push([]); cur = 0; }
      lines[lines.length - 1].push(seg);
      cur += ew;
    }
  }
  return lines.filter((l) => l.length);
}

function lineW(ctx, line, fs) {
  return line.reduce((s, seg) => s + segW(ctx, seg, fs), 0);
}

function fitFont(ctx, segs, maxW, maxH, start, min) {
  for (let fs = start; fs >= min; fs -= 2) {
    const lines = wrapSegs(ctx, segs, maxW, fs);
    if (lines.length * fs * 1.35 <= maxH && lines.every((l) => lineW(ctx, l, fs) <= maxW))
      return { fs, lines };
  }
  return { fs: min, lines: wrapSegs(ctx, segs, maxW, min) };
}

async function drawLine(ctx, line, x, y, fs, fill, stroke, sw) {
  for (const seg of line) {
    if (seg.type === "emoji") {
      const img = await getEmojiImage(seg.value);
      const sz = fs * 1.2;
      if (img) ctx.drawImage(img, x, y - fs * 0.92, sz, sz);
      x += sz;
    } else {
      setFont(ctx, fs);
      if (sw > 0) {
        ctx.strokeStyle = stroke; ctx.lineWidth = sw; ctx.lineJoin = "round";
        ctx.strokeText(seg.value, x, y);
      }
      ctx.fillStyle = fill;
      ctx.fillText(seg.value, x, y);
      setFont(ctx, fs);
      x += ctx.measureText(seg.value).width;
    }
  }
}

async function drawBlock(ctx, opts) {
  const { text, x, y, maxW, maxH, align = "center", fill = "#FFF", stroke = "#000", sw = 5,
          startFs = 60, minFs = 14, pos = "bottom", cW, cH } = opts;
  if (!text?.trim()) return;

  const segs = segmentText(text);
  await Promise.all(segs.filter((s) => s.type === "emoji").map((s) => getEmojiImage(s.value)));

  ctx.textBaseline = "alphabetic";
  const { fs, lines } = fitFont(ctx, segs, maxW, maxH, startFs, minFs);
  const lh = fs * 1.35;
  const totalH = lines.length * lh;

  const startY = pos === "top"    ? y + fs
               : pos === "bottom" ? cH - y - totalH + fs
               : pos === "center" ? (cH - totalH) / 2 + fs
               : y + fs;

  for (let i = 0; i < lines.length; i++) {
    const lw = lineW(ctx, lines[i], fs);
    const lx = align === "center" ? x + (maxW - lw) / 2
             : align === "right"  ? x + maxW - lw
             : x;
    await drawLine(ctx, lines[i], lx, startY + i * lh, fs, fill, stroke, sw);
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.json({
    name: "Meme Maker API",
    version: "4.0.0",
    description: "TitilliumWeb-Black font + Noto Color Emoji (Android/Google) + auto-resize",
    emoji: "Noto Color Emoji by Google (Apache 2.0) — same as Android & WhatsApp Android",
    fallback: "Twemoji jika Noto tidak tersedia",
    endpoints: { "GET /health": "health", "POST /meme": "JSON body", "GET /meme": "query params" },
    params: {
      imageUrl: "URL gambar background (optional)",
      topText: "teks atas — emoji 😂🔥✅🎉",
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

// ─── Generator ────────────────────────────────────────────────────────────────

async function generateMeme(p) {
  ensureFont();
  const {
    imageUrl = null, topText = "", bottomText = "",
    width = 800, height = 600, bgColor = "#000000",
    textColor = "#FFFFFF", strokeColor = "#000000",
    strokeWidth = 5, fontSize = 60, format = "png", quality = 90,
  } = p;

  const W = Math.min(Math.max(parseInt(width)  || 800, 100), 2000);
  const H = Math.min(Math.max(parseInt(height) || 600, 100), 2000);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  if (imageUrl) {
    try {
      const img = await loadImage(await fetchBuffer(imageUrl));
      const sc = Math.max(W / img.width, H / img.height);
      ctx.drawImage(img, (W - img.width * sc) / 2, (H - img.height * sc) / 2, img.width * sc, img.height * sc);
    } catch (e) {
      console.warn("BG failed:", e.message);
      ctx.fillStyle = bgColor; ctx.fillRect(0, 0, W, H);
    }
  } else {
    ctx.fillStyle = bgColor; ctx.fillRect(0, 0, W, H);
  }

  const pad = Math.floor(W * 0.04);
  const shared = {
    x: pad, maxW: W - pad * 2, maxH: H * 0.38,
    align: "center", fill: textColor, stroke: strokeColor,
    sw: parseInt(strokeWidth) ?? 5, startFs: parseInt(fontSize) || 60,
    minFs: 14, cW: W, cH: H,
  };

  await drawBlock(ctx, { ...shared, text: topText,    y: pad, pos: "top"    });
  await drawBlock(ctx, { ...shared, text: bottomText, y: pad, pos: "bottom" });

  if (format === "jpeg" || format === "jpg") {
    return { buffer: await canvas.toBuffer("image/jpeg", Math.min(Math.max(parseInt(quality) || 90, 1), 100)), contentType: "image/jpeg" };
  }
  return { buffer: await canvas.toBuffer("image/png"), contentType: "image/png" };
}

app.post("/meme", async (req, res) => {
  try {
    const r = await generateMeme(req.body);
    res.set("Content-Type", r.contentType).set("Content-Length", r.buffer.length)
       .set("Cache-Control", "public, max-age=3600").send(r.buffer);
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.get("/meme", async (req, res) => {
  try {
    const r = await generateMeme(req.query);
    res.set("Content-Type", r.contentType).set("Content-Length", r.buffer.length)
       .set("Cache-Control", "public, max-age=3600").send(r.buffer);
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => { console.log("🚀 http://localhost:" + PORT); ensureFont(); });
}
module.exports = app;

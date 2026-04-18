const express = require("express");
const { createCanvas, loadImage, registerFont } = require("canvas");
const { Resvg } = require("@resvg/resvg-js");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ─── Font Setup ───────────────────────────────────────────────────────────────
// Font TitilliumWeb-Black harus ada di root project sebagai TitilliumWeb-Black.ttf
// Download dari Google Fonts: https://fonts.google.com/specimen/Titillium+Web
const FONT_PATH = path.join(process.cwd(), "TitilliumWeb-Black.ttf");

let fontRegistered = false;
function ensureFont() {
  if (fontRegistered) return;
  if (fs.existsSync(FONT_PATH)) {
    registerFont(FONT_PATH, { family: "TitilliumWeb", weight: "900" });
    fontRegistered = true;
    console.log("✅ Font TitilliumWeb-Black registered");
  } else {
    console.warn("⚠️  TitilliumWeb-Black.ttf not found, using fallback font");
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fetchImage(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client
      .get(url, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          loadImage(buf).then(resolve).catch(reject);
        });
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

/**
 * Cek apakah karakter adalah emoji
 */
function isEmoji(char) {
  const emojiRegex =
    /(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\p{Emoji_Modifier_Base}|\u200D)/u;
  return emojiRegex.test(char);
}

/**
 * Split teks menjadi array segmen: { text, isEmoji }
 */
function segmentText(text) {
  const segments = [];
  const emojiRegex =
    /(\p{Emoji_Presentation}|\p{Emoji}\uFE0F[\u20E3]?|[\u2702-\u27B0]|\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|\p{Emoji}\uFE0F?(?:\u200D\p{Emoji}\uFE0F?)*)/gu;
  let lastIndex = 0;
  let match;

  while ((match = emojiRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), isEmoji: false });
    }
    segments.push({ text: match[0], isEmoji: true });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), isEmoji: false });
  }

  return segments;
}

/**
 * Ukur lebar teks campuran (emoji + normal) di canvas context
 */
function measureMixedText(ctx, text, fontSize) {
  const segments = segmentText(text);
  let totalWidth = 0;
  for (const seg of segments) {
    if (seg.isEmoji) {
      ctx.font = `${fontSize}px serif`;
    } else {
      ctx.font = `900 ${fontSize}px TitilliumWeb, Impact, Arial Black, sans-serif`;
    }
    totalWidth += ctx.measureText(seg.text).width;
  }
  return totalWidth;
}

/**
 * Gambar teks campuran (emoji + normal) di posisi x,y
 * Returns x akhir setelah semua segmen digambar
 */
function drawMixedText(ctx, text, x, y, fontSize, fillColor, strokeColor, strokeWidth) {
  const segments = segmentText(text);
  let currentX = x;

  for (const seg of segments) {
    if (seg.isEmoji) {
      ctx.font = `${fontSize}px serif`;
    } else {
      ctx.font = `900 ${fontSize}px TitilliumWeb, Impact, Arial Black, sans-serif`;
    }

    if (!seg.isEmoji && strokeWidth > 0) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.lineJoin = "round";
      ctx.strokeText(seg.text, currentX, y);
    }

    ctx.fillStyle = fillColor;
    ctx.fillText(seg.text, currentX, y);

    currentX += ctx.measureText(seg.text).width;
  }

  return currentX;
}

/**
 * Word wrap dengan support emoji
 * Returns array of lines
 */
function wrapText(ctx, text, maxWidth, fontSize) {
  const words = text.split(" ");
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = measureMixedText(ctx, testLine, fontSize);

    if (testWidth > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine) lines.push(currentLine);

  return lines;
}

/**
 * Auto-resize font agar semua teks muat dalam area
 */
function autoResizeFont(ctx, lines, maxWidth, maxHeight, startFontSize, minFontSize = 12) {
  let fontSize = startFontSize;

  while (fontSize >= minFontSize) {
    const lineHeight = fontSize * 1.3;
    const totalHeight = lines.length * lineHeight;
    let fits = totalHeight <= maxHeight;

    if (fits) {
      for (const line of lines) {
        if (measureMixedText(ctx, line, fontSize) > maxWidth) {
          fits = false;
          break;
        }
      }
    }

    if (fits) return fontSize;
    fontSize -= 2;
  }

  return minFontSize;
}

/**
 * Draw teks dengan outline (stroke) + word-wrap + auto-resize
 */
function drawTextBlock(ctx, options) {
  const {
    text,
    x,
    y,
    maxWidth,
    maxHeight,
    align = "center",
    fillColor = "#FFFFFF",
    strokeColor = "#000000",
    strokeWidth = 4,
    startFontSize = 48,
    minFontSize = 14,
    position = "bottom", // top | bottom | center | custom
    canvasWidth,
    canvasHeight,
  } = options;

  if (!text || !text.trim()) return;

  ctx.textBaseline = "top";

  // Wrap teks dengan font size awal untuk mendapatkan lines
  let fontSize = startFontSize;
  ctx.font = `900 ${fontSize}px TitilliumWeb, Impact, Arial Black, sans-serif`;
  let lines = wrapText(ctx, text, maxWidth, fontSize);

  // Auto resize
  fontSize = autoResizeFont(ctx, lines, maxWidth, maxHeight, fontSize, minFontSize);
  ctx.font = `900 ${fontSize}px TitilliumWeb, Impact, Arial Black, sans-serif`;
  lines = wrapText(ctx, text, maxWidth, fontSize);

  const lineHeight = fontSize * 1.3;
  const totalTextHeight = lines.length * lineHeight;

  // Hitung Y start berdasarkan posisi
  let startY;
  if (position === "top") {
    startY = y;
  } else if (position === "bottom") {
    startY = canvasHeight - y - totalTextHeight;
  } else if (position === "center") {
    startY = (canvasHeight - totalTextHeight) / 2;
  } else {
    startY = y; // custom: y adalah posisi absolut
  }

  // Gambar setiap baris
  for (let i = 0; i < lines.length; i++) {
    const lineY = startY + i * lineHeight;
    const lineWidth = measureMixedText(ctx, lines[i], fontSize);

    let lineX;
    if (align === "center") {
      lineX = x + (maxWidth - lineWidth) / 2;
    } else if (align === "right") {
      lineX = x + maxWidth - lineWidth;
    } else {
      lineX = x;
    }

    drawMixedText(ctx, lines[i], lineX, lineY, fontSize, fillColor, strokeColor, strokeWidth);
  }

  return { lines, fontSize, totalHeight: totalTextHeight };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.json({
    name: "Meme Maker API",
    version: "1.0.0",
    description: "Canvas-based meme generator with emoji support & auto-resize text",
    font: "TitilliumWeb-Black",
    endpoints: {
      "GET /health": "Health check",
      "POST /meme": "Generate meme image",
      "GET /meme": "Generate meme via query params",
    },
    usage: {
      method: "POST",
      url: "/meme",
      body: {
        imageUrl: "https://example.com/image.jpg (optional, jika tidak ada pakai background solid)",
        topText: "Teks bagian atas (support emoji 😂)",
        bottomText: "Teks bagian bawah (support emoji 🔥)",
        width: 800,
        height: 600,
        bgColor: "#000000 (jika tidak ada imageUrl)",
        textColor: "#FFFFFF",
        strokeColor: "#000000",
        strokeWidth: 4,
        fontSize: 60,
        format: "png | jpeg (default: png)",
        quality: "0-100 untuk jpeg (default: 90)",
      },
    },
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", font: fontRegistered ? "TitilliumWeb-Black" : "fallback" });
});

// ─── Core Meme Generator ──────────────────────────────────────────────────────

async function generateMeme(params) {
  ensureFont();

  const {
    imageUrl = null,
    topText = "",
    bottomText = "",
    width = 800,
    height = 600,
    bgColor = "#000000",
    textColor = "#FFFFFF",
    strokeColor = "#000000",
    strokeWidth = 5,
    fontSize = 60,
    format = "png",
    quality = 90,
  } = params;

  const W = Math.min(Math.max(parseInt(width) || 800, 100), 2000);
  const H = Math.min(Math.max(parseInt(height) || 600, 100), 2000);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // ── Background ──
  if (imageUrl) {
    try {
      const img = await fetchImage(imageUrl);
      // Cover fit: scale gambar agar mengisi canvas sepenuhnya
      const scale = Math.max(W / img.width, H / img.height);
      const sw = img.width * scale;
      const sh = img.height * scale;
      const sx = (W - sw) / 2;
      const sy = (H - sh) / 2;
      ctx.drawImage(img, sx, sy, sw, sh);
    } catch (e) {
      console.warn("Failed to load image, using bgColor:", e.message);
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, W, H);
    }
  } else {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, W, H);
  }

  const padding = Math.floor(W * 0.04);
  const maxTextWidth = W - padding * 2;
  const maxTextHeight = H * 0.35; // maks 35% tinggi canvas per blok teks

  // ── Top Text ──
  if (topText && topText.trim()) {
    drawTextBlock(ctx, {
      text: topText,
      x: padding,
      y: padding,
      maxWidth: maxTextWidth,
      maxHeight: maxTextHeight,
      align: "center",
      fillColor: textColor,
      strokeColor: strokeColor,
      strokeWidth: parseInt(strokeWidth) || 5,
      startFontSize: parseInt(fontSize) || 60,
      minFontSize: 14,
      position: "top",
      canvasWidth: W,
      canvasHeight: H,
    });
  }

  // ── Bottom Text ──
  if (bottomText && bottomText.trim()) {
    drawTextBlock(ctx, {
      text: bottomText,
      x: padding,
      y: padding,
      maxWidth: maxTextWidth,
      maxHeight: maxTextHeight,
      align: "center",
      fillColor: textColor,
      strokeColor: strokeColor,
      strokeWidth: parseInt(strokeWidth) || 5,
      startFontSize: parseInt(fontSize) || 60,
      minFontSize: 14,
      position: "bottom",
      canvasWidth: W,
      canvasHeight: H,
    });
  }

  // ── Output ──
  if (format === "jpeg" || format === "jpg") {
    const buf = canvas.toBuffer("image/jpeg", {
      quality: Math.min(Math.max(parseInt(quality) || 90, 1), 100) / 100,
    });
    return { buffer: buf, contentType: "image/jpeg" };
  }

  const buf = canvas.toBuffer("image/png");
  return { buffer: buf, contentType: "image/png" };
}

// ─── POST /meme ───────────────────────────────────────────────────────────────
app.post("/meme", async (req, res) => {
  try {
    const result = await generateMeme(req.body);
    res.set("Content-Type", result.contentType);
    res.set("Content-Length", result.buffer.length);
    res.set("Cache-Control", "public, max-age=3600");
    res.send(result.buffer);
  } catch (err) {
    console.error("Meme generation error:", err);
    res.status(500).json({ error: "Failed to generate meme", message: err.message });
  }
});

// ─── GET /meme ────────────────────────────────────────────────────────────────
app.get("/meme", async (req, res) => {
  try {
    const result = await generateMeme(req.query);
    res.set("Content-Type", result.contentType);
    res.set("Content-Length", result.buffer.length);
    res.set("Cache-Control", "public, max-age=3600");
    res.send(result.buffer);
  } catch (err) {
    console.error("Meme generation error:", err);
    res.status(500).json({ error: "Failed to generate meme", message: err.message });
  }
});

// ─── Server ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`🚀 Meme Maker API running at http://localhost:${PORT}`);
    ensureFont();
  });
}

module.exports = app;

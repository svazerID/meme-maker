const express = require('express');
const { createCanvas, loadImage, registerFont } = require('canvas');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

// Register Titillium Web Black font
// Anda perlu upload font file ke repo atau gunakan URL
const FONT_PATH = './TitilliumWeb-Black.ttf';

// Download font if not exists (fallback ke system font)
async function ensureFont() {
  if (!fs.existsSync(FONT_PATH)) {
    // Fallback: gunakan system font bold jika Titillium tidak tersedia
    return 'Arial Black';
  }
  try {
    registerFont(FONT_PATH, { family: 'Titillium Web' });
    return 'Titillium Web';
  } catch (e) {
    return 'Arial Black';
  }
}

// Fungsi untuk wrap text otomatis
function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const width = ctx.measureText(currentLine + " " + word).width;
    if (width < maxWidth) {
      currentLine += " " + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  lines.push(currentLine);
  return lines;
}

// Fungsi untuk mengukur dan menyesuaikan font size
function calculateFontSize(ctx, text, maxWidth, maxHeight, baseSize) {
  let fontSize = baseSize;
  ctx.font = `bold ${fontSize}px Titillium Web, Arial Black, sans-serif`;
  
  const lines = wrapText(ctx, text, maxWidth);
  const lineHeight = fontSize * 1.2;
  const totalHeight = lines.length * lineHeight;
  
  // Jika terlalu tinggi, kurangi font size
  if (totalHeight > maxHeight && fontSize > 20) {
    return calculateFontSize(ctx, text, maxWidth, maxHeight, fontSize - 5);
  }
  
  return { fontSize, lines, lineHeight };
}

// Endpoint utama untuk generate meme
app.get('/api/meme', async (req, res) => {
  try {
    const { 
      image, 
      top, 
      bottom, 
      width = 800,
      emoji = true 
    } = req.query;

    if (!image) {
      return res.status(400).json({ error: 'Parameter image (URL) diperlukan' });
    }

    // Load image
    const img = await loadImage(image);
    
    // Calculate aspect ratio
    const aspectRatio = img.width / img.height;
    const canvasWidth = parseInt(width);
    const canvasHeight = Math.round(canvasWidth / aspectRatio);

    // Create canvas
    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d');

    // Draw image
    ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);

    // Setup font
    const fontFamily = await ensureFont();
    const maxTextWidth = canvasWidth - 40; // padding 20px each side
    const maxTextHeight = canvasHeight * 0.4; // max 40% of image height

    // Helper function untuk draw text dengan stroke
    async function drawMemeText(text, isTop) {
      if (!text) return;

      // Decode emoji dan text
      const decodedText = decodeURIComponent(text);
      
      // Calculate optimal font size
      const baseSize = Math.floor(canvasWidth / 8);
      const { fontSize, lines, lineHeight } = calculateFontSize(
        ctx, 
        decodedText, 
        maxTextWidth, 
        maxTextHeight, 
        baseSize
      );

      ctx.font = `bold ${fontSize}px "${fontFamily}", Arial Black, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Position
      const startY = isTop 
        ? 30 + (fontSize / 2) 
        : canvasHeight - 30 - ((lines.length - 1) * lineHeight) - (fontSize / 2);

      lines.forEach((line, index) => {
        const x = canvasWidth / 2;
        const y = startY + (index * lineHeight);

        // Stroke (outline)
        ctx.strokeStyle = 'black';
        ctx.lineWidth = fontSize / 8;
        ctx.lineJoin = 'round';
        ctx.strokeText(line, x, y);

        // Fill
        ctx.fillStyle = 'white';
        ctx.fillText(line, x, y);
      });
    }

    // Draw top text
    if (top) await drawMemeText(top, true);
    
    // Draw bottom text
    if (bottom) await drawMemeText(bottom, false);

    // Send response
    const buffer = canvas.toBuffer('image/png');
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(buffer);

  } catch (error) {
    console.error('Error generating meme:', error);
    res.status(500).json({ 
      error: 'Gagal generate meme', 
      detail: error.message 
    });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', service: 'Meme Maker API' });
});

// Vercel serverless handler
const PORT = process.env.PORT || 3000;

// Local development
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;

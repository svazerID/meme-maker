const express = require('express');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const app = express();

// Daftarkan Font Titillium
// Sesuaikan path ini dengan letak file .ttf kamu
const fontPath = path.join(process.cwd(), 'fonts', 'TitilliumWeb-Black.ttf');
GlobalFonts.registerFromPath(fontPath, 'Titillium Web');

app.get('/api/meme', async (req, res) => {
    try {
        const { text, imageUrl } = req.query;

        if (!text || !imageUrl) {
            return res.status(400).send('Mana text sama imageUrl nya? Isi dulu!');
        }

        // Load Gambar
        const image = await loadImage(imageUrl);
        const canvas = createCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d');

        // Gambar Background
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

        // Styling Teks
        const fontSize = Math.floor(canvas.width * 0.1);
        
        // SUPPORT EMOJI: Pakai font fallback sistem agar emoji muncul
        ctx.font = `900 ${fontSize}px "Titillium Web", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
        ctx.fillStyle = 'white';
        ctx.strokeStyle = 'black';
        ctx.lineWidth = fontSize / 7;
        ctx.textAlign = 'center';
        ctx.lineJoin = 'round';

        const x = canvas.width / 2;
        const y = canvas.height - (fontSize * 0.8);
        const maxWidth = canvas.width * 0.9;
        const lineHeight = fontSize * 1.1;

        // Auto-Resize / Wrap Text (Turun ke bawah otomatis)
        const words = text.split(' ');
        let line = '';
        let lines = [];

        for (let n = 0; n < words.length; n++) {
            let testLine = line + words[n] + ' ';
            let metrics = ctx.measureText(testLine);
            if (metrics.width > maxWidth && n > 0) {
                lines.push(line);
                line = words[n] + ' ';
            } else {
                line = testLine;
            }
        }
        lines.push(line);

        // Gambar teks dari baris paling bawah ke atas
        lines.reverse().forEach((l, index) => {
            const currentY = y - (index * lineHeight);
            ctx.strokeText(l.trim(), x, currentY);
            ctx.fillText(l.trim(), x, currentY);
        });

        // Kirim hasil sebagai gambar PNG
        const buffer = await canvas.encode('png');
        res.setHeader('Content-Type', 'image/png');
        res.send(buffer);

    } catch (error) {
        console.error(error);
        res.status(500).send('Error: ' + error.message);
    }
});

// Jalankan lokal
if (process.env.NODE_ENV !== 'production') {
    app.listen(3000, () => console.log('Gas! Cek di http://localhost:3000/api/meme?text=Halo Dunia 🚀&imageUrl=LINK_GAMBAR'));
}

module.exports = app;

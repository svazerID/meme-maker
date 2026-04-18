const express = require('express');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const app = express();

// Daftarkan font menggunakan GlobalFonts (Metode @napi-rs/canvas)
const fontPath = path.join(process.cwd(), 'fonts', 'TitilliumWeb-Black.ttf');
GlobalFonts.registerFromPath(fontPath, 'Titillium Web');

app.get('/api/meme', async (req, res) => {
    try {
        const { text, imageUrl } = req.query;

        if (!text || !imageUrl) {
            return res.status(400).send('Parameter text dan imageUrl wajib diisi.');
        }

        // Load gambar tanpa membawa header bermasalah
        const image = await loadImage(imageUrl);
        const canvas = createCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d');

        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

        // Styling Teks & Fallback Emoji
        const fontSize = Math.floor(canvas.width * 0.1);
        ctx.font = `900 ${fontSize}px "Titillium Web", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
        ctx.fillStyle = 'white';
        ctx.strokeStyle = 'black';
        ctx.lineWidth = fontSize / 8;
        ctx.textAlign = 'center';
        ctx.lineJoin = 'round';

        const x = canvas.width / 2;
        const maxWidth = canvas.width * 0.9;
        const lineHeight = fontSize * 1.1;

        // Logika Wrap Text (Otomatis turun ke bawah)
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

        // Render Teks (Bottom-up agar tidak keluar canvas)
        const yBase = canvas.height - (fontSize * 0.8);
        lines.reverse().forEach((l, index) => {
            const currentY = yBase - (index * lineHeight);
            ctx.strokeText(l.trim(), x, currentY);
            ctx.fillText(l.trim(), x, currentY);
        });

        // Encode ke buffer (Menghindari Invalid Character di Header)
        const buffer = await canvas.encode('png');
        res.setHeader('Content-Type', 'image/png');
        res.send(buffer);

    } catch (error) {
        console.error(error);
        res.status(500).send('Gagal: ' + error.message);
    }
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
    app.listen(3000, () => console.log('Server lokal jalan di port 3000'));
}

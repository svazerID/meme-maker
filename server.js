const express = require('express');
const { createCanvas, loadImage, registerFont } = require('canvas');
const app = express();
const PORT = 3000;

// 1. Daftarkan font Titillium Web
// Pastikan file font ada di folder /fonts/
registerFont('./fonts/TitilliumWeb-Black.ttf', { family: 'Titillium Web', weight: '900' });

app.get('/api/meme', async (req, res) => {
    try {
        const { text, imageUrl } = req.query;

        if (!text || !imageUrl) {
            return res.status(400).send('Parameter text dan imageUrl wajib diisi.');
        }

        // 2. Load Gambar dari URL
        const image = await loadImage(imageUrl);
        const canvas = createCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d');

        // 3. Gambar Background
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

        // 4. Styling Teks (Support Emoji secara native di OS modern)
        const fontSize = Math.floor(canvas.width * 0.1); // Font responsif 10% dari lebar
        ctx.font = `900 ${fontSize}px "Titillium Web"`;
        ctx.fillStyle = 'white';
        ctx.strokeStyle = 'black';
        ctx.lineWidth = fontSize / 8;
        ctx.textAlign = 'center';

        const x = canvas.width / 2;
        const y = canvas.height - (fontSize * 0.5);
        const maxWidth = canvas.width * 0.9;
        const lineHeight = fontSize * 1.1;

        // 5. Logika Wrap Text
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

        // 6. Gambar Teks (Bottom-up)
        lines.reverse().forEach((l, index) => {
            const currentY = y - (index * lineHeight);
            ctx.strokeText(l.trim(), x, currentY);
            ctx.fillText(l.trim(), x, currentY);
        });

        // 7. Kirim sebagai Gambar
        res.setHeader('Content-Type', 'image/png');
        canvas.createPNGStream().pipe(res);

    } catch (error) {
        console.error(error);
        res.status(500).send('Gagal membuat meme.');
    }
});

app.listen(PORT, () => {
    console.log(`Meme API berjalan di http://localhost:${PORT}`);
});

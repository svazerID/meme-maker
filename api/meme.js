const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');

// 1. Daftarkan Font (Gunakan GlobalFonts untuk @napi-rs/canvas)
const fontPath = path.join(process.cwd(), 'fonts', 'TitilliumWeb-Black.ttf');
GlobalFonts.registerFromPath(fontPath, 'Titillium Web');

module.exports = async (req, res) => {
    try {
        const { text, imageUrl } = req.query;

        if (!text || !imageUrl) {
            return res.status(400).json({ error: 'Berikan parameter text dan imageUrl' });
        }

        // 2. Load Gambar
        const image = await loadImage(imageUrl);
        const canvas = createCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d');

        // Gambar Background
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

        // 3. Konfigurasi Teks
        const fontSize = Math.floor(canvas.width * 0.1);
        // Penting: Masukkan fallback font sistem agar Emoji muncul (misal: Apple Color Emoji atau Noto Color Emoji)
        ctx.font = `900 ${fontSize}px "Titillium Web", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"`;
        ctx.fillStyle = 'white';
        ctx.strokeStyle = 'black';
        ctx.lineWidth = fontSize / 7;
        ctx.textAlign = 'center';
        ctx.lineJoin = 'round';

        const x = canvas.width / 2;
        const y = canvas.height - (fontSize * 0.8);
        const maxWidth = canvas.width * 0.9;
        const lineHeight = fontSize * 1.1;

        // 4. Logika Wrap Text (Auto-Resize kebawah)
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

        // 5. Gambar Teks (Urutan terbalik agar tumpukan baris ke atas)
        lines.reverse().forEach((l, index) => {
            const currentY = y - (index * lineHeight);
            ctx.strokeText(l.trim(), x, currentY);
            ctx.fillText(l.trim(), x, currentY);
        });

        // 6. Output Gambar
        const buffer = await canvas.encode('png');
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, imuttable, no-transform, s-maxage=31536000, max-age=31536000');
        res.send(buffer);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Gagal memproses meme', details: error.message });
    }
};

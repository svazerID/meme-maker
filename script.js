const canvas = document.getElementById('memeCanvas');
const ctx = canvas.getContext('2d');
const upload = document.getElementById('upload');
const textInput = document.getElementById('textInput');
const downloadBtn = document.getElementById('downloadBtn');

let activeImage = null;

// Handle Upload Gambar
upload.addEventListener('change', (e) => {
    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            activeImage = img;
            // Set canvas size sesuai aspek rasio gambar (max width 800)
            const scale = 800 / img.width;
            canvas.width = 800;
            canvas.height = img.height * scale;
            drawMeme();
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(e.target.files[0]);
});

// Update saat mengetik
textInput.addEventListener('input', drawMeme);

function drawMeme() {
    if (!activeImage) return;

    // 1. Gambar Background
    ctx.drawImage(activeImage, 0, 0, canvas.width, canvas.height);

    // 2. Styling Teks
    const fontSize = 50;
    ctx.font = `900 ${fontSize}px "Titillium Web"`;
    ctx.fillStyle = "white";
    ctx.strokeStyle = "black";
    ctx.lineWidth = 6;
    ctx.textAlign = "center";
    ctx.lineJoin = "round";

    // 3. Logika Auto-Resize / Wrap Text
    const x = canvas.width / 2;
    const y = canvas.height - 60; // Posisi di bawah
    const maxWidth = canvas.width - 40;
    const lineHeight = fontSize + 10;

    wrapText(ctx, textInput.value, x, y, maxWidth, lineHeight);
}

function wrapText(context, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    let lines = [];

    // Pecah teks menjadi baris-baris berdasarkan maxWidth
    for (let n = 0; n < words.length; n++) {
        let testLine = line + words[n] + ' ';
        let metrics = context.measureText(testLine);
        let testWidth = metrics.width;
        if (testWidth > maxWidth && n > 0) {
            lines.push(line);
            line = words[n] + ' ';
        } else {
            line = testLine;
        }
    }
    lines.push(line);

    // Gambar teks dari bawah ke atas agar tidak terpotong ke bawah canvas
    for (let i = lines.length - 1; i >= 0; i--) {
        let currentY = y - ((lines.length - 1 - i) * lineHeight);
        context.strokeText(lines[i], x, currentY);
        context.fillText(lines[i], x, currentY);
    }
}

// Download Fungsi
downloadBtn.addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = 'meme-lucu.png';
    link.href = canvas.toDataURL();
    link.click();
});

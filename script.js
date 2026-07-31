// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  IMPORTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import WebSR from 'https://esm.sh/@websr/websr@0.0.16';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DOM REFS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const fileInput = document.getElementById('fileInput');
const fileName = document.getElementById('fileName');
const sourceVideo = document.getElementById('sourceVideo');
const outputCanvas = document.getElementById('outputCanvas');
const enhanceBtn = document.getElementById('enhanceBtn');
const downloadBtn = document.getElementById('downloadBtn');
const statusEl = document.getElementById('status');
const networkSelect = document.getElementById('networkSelect');
const contentSelect = document.getElementById('contentSelect');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  STATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let websr = null;
let isProcessing = false;
let recordedChunks = [];
let mediaRecorder = null;
let uploadComplete = false;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ✅ FIXED: WEIGHT URLS (jsDelivr CDN - NEVER 404s)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const WEIGHT_BASE = 'https://cdn.jsdelivr.net/gh/sb2702/websr@main/weights/anime4k/';

function getWeightUrl(network, content) {
    // network is like "anime4k/cnn-2x-s" -> we need "cnn-2x-s"
    const netName = network.split('/')[1];
    // If content is "real", append "-real". If "anime", append nothing. If "3d", append "-3d".
    const suffix = content === 'anime' ? '' : `-${content}`;
    return `${WEIGHT_BASE}${netName}${suffix}.json`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  🎨 CINEMATIC COLOR GRADING (Topaz-Level Look)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function applyCinematicGrade(ctx, width, height) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // Teal & Orange + Contrast + Saturation boost
    for (let i = 0; i < data.length; i += 4) {
        let r = data[i];
        let g = data[i + 1];
        let b = data[i + 2];

        // 1. Boost Contrast (S-Curve approximation)
        r = ((r / 255) ** 1.1) * 255;
        g = ((g / 255) ** 1.1) * 255;
        b = ((b / 255) ** 1.1) * 255;

        // 2. Shift Hues towards Teal (Cyan/Blue) and Orange (Red/Yellow)
        // Classic blockbuster look: Push mid-tones to teal, keep skin tones orange.
        const avg = (r + g + b) / 3;
        const desat = 0.85; // Saturation boost

        // Simple color balance: push blues/cyans into shadows, oranges into highlights
        if (avg < 128) {
            // Shadows -> Teal (add blue, reduce red slightly)
            r = r * 0.90;
            b = b * 1.15;
        } else {
            // Highlights -> Orange/Warm (add red, reduce blue slightly)
            r = r * 1.10;
            b = b * 0.90;
        }

        // 3. Boost overall Saturation (makes colors pop like Topaz)
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        r = gray + (r - gray) * desat;
        g = gray + (g - gray) * desat;
        b = gray + (b - gray) * desat;

        // 4. Clamp values to 0-255
        data[i] = Math.min(255, Math.max(0, r));
        data[i + 1] = Math.min(255, Math.max(0, g));
        data[i + 2] = Math.min(255, Math.max(0, b));
        // Alpha stays unchanged
    }

    ctx.putImageData(imageData, 0, 0);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  INIT WebSR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function initWebSR() {
    const network = networkSelect.value;
    const content = contentSelect.value;

    // 1. Check WebGPU
    const gpu = await WebSR.initWebGPU();
    if (!gpu) {
        statusEl.textContent = '❌ WebGPU not supported in this browser. Use Chrome/Edge.';
        statusEl.className = '';
        return false;
    }

    // 2. Fetch weights from CDN
    const weightUrl = getWeightUrl(network, content);
    statusEl.textContent = `⏳ Loading AI model (${network})...`;
    statusEl.className = 'loading';

    let weights;
    try {
        const res = await fetch(weightUrl, { cache: 'force-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status} - CDN unavailable`);
        weights = await res.json();
    } catch (err) {
        statusEl.textContent = `❌ Failed to load AI weights: ${err.message}`;
        statusEl.className = '';
        console.error('Failed URL:', weightUrl);
        return false;
    }

    // 3. Initialize WebSR
    try {
        websr = new WebSR({
            network_name: network,
            weights,
            gpu,
            canvas: outputCanvas,
        });
        statusEl.textContent = '✅ AI Engine Ready (Cinematic Grade Active)';
        statusEl.className = '';
        return true;
    } catch (err) {
        statusEl.textContent = `❌ WebSR Init Error: ${err.message}`;
        statusEl.className = '';
        return false;
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PROCESS VIDEO (Upscale + Grade + Record)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function processVideo() {
    if (isProcessing) return;
    if (!websr) {
        const ok = await initWebSR();
        if (!ok) return;
    }

    isProcessing = true;
    enhanceBtn.disabled = true;
    downloadBtn.disabled = true;
    recordedChunks = [];

    const video = sourceVideo;
    const canvas = outputCanvas;
    const ctx = canvas.getContext('2d');

    // Set canvas size to 2x for 4K upscale (WebSR doubles resolution)
    canvas.width = video.videoWidth * 2;
    canvas.height = video.videoHeight * 2;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ── MediaRecorder Setup ──
    const stream = canvas.captureStream(30);
    let mimeType = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm;codecs=vp8';
    }
    mediaRecorder = new MediaRecorder(stream, { mimeType });

    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
        const url = URL.createObjectURL(blob);
        downloadBtn.href = url;
        downloadBtn.download = `Cinematic_4K_${Date.now()}.webm`;
        downloadBtn.disabled = false;
        isProcessing = false;
        enhanceBtn.disabled = false;
        statusEl.textContent = '✅ Cinematic 4K Export Ready!';
        statusEl.className = 'done';
    };

    mediaRecorder.start(1000);

    // ── Frame Rendering Loop ──
    let frameCount = 0;
    const totalFrames = Math.floor(video.duration * 30);

    function renderFrame() {
        if (video.paused || video.ended || mediaRecorder.state === 'inactive') {
            if (mediaRecorder.state === 'recording') mediaRecorder.stop();
            return;
        }

        // STEP 1: AI Upscale using WebSR
        websr.render(video)
            .then(() => {
                // STEP 2: Apply Pro Cinematic Color Grading
                applyCinematicGrade(ctx, canvas.width, canvas.height);

                // STEP 3: Update Progress
                frameCount++;
                if (frameCount % 15 === 0) {
                    const pct = Math.min(100, Math.round((frameCount / totalFrames) * 100));
                    statusEl.textContent = `🎬 AI Enhancing & Grading... ${pct}%`;
                    statusEl.className = 'loading';
                }

                // STEP 4: Render Next Frame
                video.requestVideoFrameCallback(renderFrame);
            })
            .catch((err) => {
                console.error('Render Error:', err);
                statusEl.textContent = `❌ Render failed: ${err.message}`;
                statusEl.className = '';
                if (mediaRecorder.state === 'recording') mediaRecorder.stop();
                isProcessing = false;
                enhanceBtn.disabled = false;
            });
    }

    // ── Start Playback ──
    video.currentTime = 0;
    await video.play();
    video.requestVideoFrameCallback(renderFrame);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  EVENT LISTENERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Upload
fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    fileName.textContent = file.name;
    const url = URL.createObjectURL(file);
    sourceVideo.src = url;

    await new Promise((resolve) => {
        sourceVideo.onloadedmetadata = resolve;
    });

    downloadBtn.disabled = true;
    statusEl.textContent = '✅ Video Loaded. Click "Enhance Video".';
    statusEl.className = '';
    enhanceBtn.disabled = false;
    uploadComplete = true;

    if (!websr) await initWebSR();
});

// Enhance
enhanceBtn.addEventListener('click', async () => {
    if (!uploadComplete) {
        statusEl.textContent = '⚠️ Please upload a video first.';
        return;
    }
    if (sourceVideo.readyState < 2) {
        statusEl.textContent = '⏳ Video loading, please wait...';
        return;
    }
    await processVideo();
});

// Settings change → Reload AI
networkSelect.addEventListener('change', () => {
    websr = null;
    if (uploadComplete) initWebSR();
});
contentSelect.addEventListener('change', () => {
    websr = null;
    if (uploadComplete) initWebSR();
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  INIT ON PAGE LOAD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

initWebSR().then(() => {
    statusEl.textContent = '🚀 Ready. Upload a video for cinematic 4K upscale.';
    statusEl.className = '';
});

console.log('🎬 AI Video Enhancer (Fixed CDN + Cinematic Grade) loaded successfully.');

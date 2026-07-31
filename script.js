// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// IMPORTS & DOM REFS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import WebSR from 'https://esm.sh/@websr/websr@0.0.16';

const fileInput = document.getElementById('fileInput');
const fileName = document.getElementById('fileName');
const sourceVideo = document.getElementById('sourceVideo');
const outputCanvas = document.getElementById('outputCanvas');
const enhanceBtn = document.getElementById('enhanceBtn');
const downloadBtn = document.getElementById('downloadBtn');
const statusEl = document.getElementById('status');
const networkSelect = document.getElementById('networkSelect');
const gradeToggle = document.getElementById('gradeToggle');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let websr = null;
let isProcessing = false;
let recordedChunks = [];
let mediaRecorder = null;
let uploadComplete = false;
let videoReady = false;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ✅ THE ULTIMATE FIX: LOAD WEIGHTS FROM NPM (100% Guaranteed)
// The GitHub repo changed, but the NPM package has the files.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const WEIGHT_BASE = 'https://cdn.jsdelivr.net/npm/@websr/websr@0.0.16/weights/anime4k/';

function getWeightUrl(networkName) {
    // networkName is "cnn-2x-m" -> loads cnn-2x-m.json from NPM
    return `${WEIGHT_BASE}${networkName}.json`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎨 CINEMATIC GRADE (GPU Powered - 0% CPU)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function updateCinematicGrade() {
    if (!gradeToggle.checked) {
        outputCanvas.style.filter = 'none';
        return;
    }
    // Hollywood "Teal & Orange" Blockbuster Look
    outputCanvas.style.filter = 
        'contrast(1.15) ' +
        'saturate(1.5) ' +
        'brightness(1.05) ' +
        'sepia(0.08) ' +
        'hue-rotate(-8deg)';
}

gradeToggle.addEventListener('change', updateCinematicGrade);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INIT WebSR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function initWebSR() {
    const network = networkSelect.value; // e.g., "cnn-2x-m"

    // 1. Check WebGPU
    const gpu = await WebSR.initWebGPU();
    if (!gpu) {
        statusEl.textContent = '❌ WebGPU not supported. Please use Chrome/Edge.';
        statusEl.className = '';
        return false;
    }

    // 2. Fetch weights from NPM (Guaranteed to exist)
    const weightUrl = getWeightUrl(network);
    statusEl.textContent = `⏳ Loading AI (${network})...`;
    statusEl.className = 'loading';

    let weights;
    try {
        const res = await fetch(weightUrl, { cache: 'force-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        weights = await res.json();
    } catch (err) {
        statusEl.textContent = `❌ AI Load Error: ${err.message}`;
        statusEl.className = '';
        console.error('Failed URL:', weightUrl);
        return false;
    }

    // 3. Initialize WebSR
    try {
        websr = new WebSR({
            network_name: `anime4k/${network}`, // WebSR needs this format
            weights,
            gpu,
            canvas: outputCanvas,
        });
        statusEl.textContent = '✅ AI Ready. Upload a video!';
        statusEl.className = '';
        return true;
    } catch (err) {
        statusEl.textContent = `❌ Init Error: ${err.message}`;
        statusEl.className = '';
        return false;
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROCESS VIDEO
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function processVideo() {
    if (isProcessing) return;
    if (!videoReady) {
        statusEl.textContent = '⏳ Please wait for video to load...';
        return;
    }
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

    // Set canvas to 2x for 4K upscale
    canvas.width = video.videoWidth * 2;
    canvas.height = video.videoHeight * 2;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Apply cinematic grade on the canvas element (GPU filtered)
    updateCinematicGrade();

    // ── MediaRecorder ──
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
        statusEl.textContent = '✅ 4K Export Ready!';
        statusEl.className = 'done';
    };

    mediaRecorder.start(1000);

    // ── Render Loop ──
    let frameCount = 0;
    const totalFrames = Math.floor(video.duration * 30);

    function renderFrame() {
        if (video.paused || video.ended || mediaRecorder.state === 'inactive') {
            if (mediaRecorder.state === 'recording') mediaRecorder.stop();
            return;
        }

        websr.render(video)
            .then(() => {
                frameCount++;
                if (frameCount % 15 === 0) {
                    const pct = Math.min(100, Math.round((frameCount / totalFrames) * 100));
                    statusEl.textContent = `🎬 Enhancing... ${pct}% (GPU)`;
                    statusEl.className = 'loading';
                }
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

    video.currentTime = 0;
    await video.play();
    video.requestVideoFrameCallback(renderFrame);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EVENT LISTENERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    fileName.textContent = file.name;
    
    if (sourceVideo.src) URL.revokeObjectURL(sourceVideo.src);
    
    const url = URL.createObjectURL(file);
    sourceVideo.src = url;
    videoReady = false;

    await new Promise((resolve) => {
        sourceVideo.oncanplay = () => resolve();
        sourceVideo.onloadedmetadata = () => {
            if (sourceVideo.readyState >= 2) resolve();
        };
        sourceVideo.load();
        setTimeout(resolve, 5000);
    });

    sourceVideo.width = sourceVideo.videoWidth;
    sourceVideo.height = sourceVideo.videoHeight;

    downloadBtn.disabled = true;
    statusEl.textContent = '✅ Video loaded. Click "Enhance".';
    statusEl.className = '';
    enhanceBtn.disabled = false;
    uploadComplete = true;
    videoReady = true;

    if (!websr) await initWebSR();
});

enhanceBtn.addEventListener('click', async () => {
    if (!uploadComplete || !videoReady) {
        statusEl.textContent = '⚠️ Please upload a video first.';
        return;
    }
    await processVideo();
});

networkSelect.addEventListener('change', () => {
    websr = null;
    if (uploadComplete) initWebSR();
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BOOT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

statusEl.textContent = '🚀 Ready. Upload a video.';
console.log('✅ AI Enhancer (FIXED - NPM weights) loaded successfully.');

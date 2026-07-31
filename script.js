// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  IMPORTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import WebSR from 'https://esm.sh/@websr/websr@0.0.16';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DOM REFS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const fileInput    = document.getElementById('fileInput');
const fileName     = document.getElementById('fileName');
const sourceVideo  = document.getElementById('sourceVideo');
const outputCanvas = document.getElementById('outputCanvas');
const enhanceBtn   = document.getElementById('enhanceBtn');
const downloadBtn  = document.getElementById('downloadBtn');
const statusEl     = document.getElementById('status');
const networkSelect = document.getElementById('networkSelect');
const contentSelect = document.getElementById('contentSelect');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  STATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let websr = null;                 // WebSR instance
let isProcessing = false;
let recordedChunks = [];
let mediaRecorder = null;
let uploadComplete = false;

// Content-type → network name mapping
const CONTENT_MAP = {
    anime: 'anime4k/cnn-2x-',
    real:  'anime4k/cnn-2x-',
    '3d':  'anime4k/cnn-2x-',
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  WEIGHT URLS (hosted on GitHub)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const WEIGHT_BASE = 'https://raw.githubusercontent.com/sb2702/websr/main/weights/anime4k/';

function getWeightUrl(network, content) {
    // network: 'anime4k/cnn-2x-s' → we need 'cnn-2x-s'
    const netName = network.split('/')[1]; // 'cnn-2x-s'
    const suffix = content === 'anime' ? '' : `-${content}`;
    return `${WEIGHT_BASE}${netName}${suffix}.json`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  INIT WebSR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function initWebSR() {
    const network = networkSelect.value;
    const content = contentSelect.value;

    // 1. Check WebGPU support
    const gpu = await WebSR.initWebGPU();
    if (!gpu) {
        statusEl.textContent = '❌ WebGPU not supported in this browser.';
        statusEl.className = '';
        return false;
    }

    // 2. Fetch weights
    const weightUrl = getWeightUrl(network, content);
    statusEl.textContent = '⏳ Loading AI model...';
    statusEl.className = 'loading';

    let weights;
    try {
        const res = await fetch(weightUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        weights = await res.json();
    } catch (err) {
        statusEl.textContent = `❌ Failed to load weights: ${err.message}`;
        statusEl.className = '';
        return false;
    }

    // 3. Create WebSR instance
    try {
        websr = new WebSR({
            network_name: network,
            weights,
            gpu,
            canvas: outputCanvas,
        });
    } catch (err) {
        statusEl.textContent = `❌ WebSR init error: ${err.message}`;
        statusEl.className = '';
        return false;
    }

    statusEl.textContent = '✅ AI model ready';
    statusEl.className = '';
    return true;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PROCESS VIDEO
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

    // Reset canvas
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ── Set up MediaRecorder on the canvas stream ──
    // We capture at 30 fps; the canvas will be updated by WebSR
    const stream = canvas.captureStream(30);
    const mimeType = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
        statusEl.textContent = '⚠️ VP9 not supported, falling back to VP8.';
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    } else {
        mediaRecorder = new MediaRecorder(stream, { mimeType });
    }

    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
        const url = URL.createObjectURL(blob);
        downloadBtn.href = url;
        downloadBtn.download = `enhanced_${Date.now()}.webm`;
        downloadBtn.disabled = false;
        isProcessing = false;
        enhanceBtn.disabled = false;
        statusEl.textContent = '✅ Done! Download your video.';
        statusEl.className = 'done';
    };

    // ── Start recording ──
    mediaRecorder.start(1000); // collect chunks every second

    // ── Render loop ──
    let frameCount = 0;
    const totalFrames = Math.floor(video.duration * 30); // estimate

    function renderFrame() {
        if (video.paused || video.ended || mediaRecorder.state === 'inactive') {
            if (mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
            }
            return;
        }

        // Render the current video frame through WebSR
        websr.render(video).then(() => {
            frameCount++;
            // Update status every 30 frames
            if (frameCount % 30 === 0) {
                const pct = Math.min(100, Math.round((frameCount / totalFrames) * 100));
                statusEl.textContent = `⏳ Processing... ${pct}%`;
                statusEl.className = 'loading';
            }
            // Schedule next frame
            video.requestVideoFrameCallback(renderFrame);
        }).catch((err) => {
            console.error('Render error:', err);
            statusEl.textContent = `❌ Render error: ${err.message}`;
            statusEl.className = '';
            if (mediaRecorder.state === 'recording') mediaRecorder.stop();
            isProcessing = false;
            enhanceBtn.disabled = false;
        });
    }

    // ── Start playback & rendering ──
    video.currentTime = 0;
    await video.play();
    video.requestVideoFrameCallback(renderFrame);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  FILE UPLOAD HANDLER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    fileName.textContent = file.name;
    const url = URL.createObjectURL(file);
    sourceVideo.src = url;

    // Wait for metadata to load
    await new Promise((resolve) => {
        sourceVideo.onloadedmetadata = resolve;
    });

    // Reset UI
    downloadBtn.disabled = true;
    downloadBtn.href = '';
    recordedChunks = [];
    statusEl.textContent = '✅ Video loaded. Click "Enhance".';
    statusEl.className = '';

    // Enable enhance button
    enhanceBtn.disabled = false;
    uploadComplete = true;

    // Auto-init WebSR in background
    if (!websr) {
        await initWebSR();
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ENHANCE BUTTON
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

enhanceBtn.addEventListener('click', async () => {
    if (!uploadComplete) {
        statusEl.textContent = '⚠️ Please upload a video first.';
        return;
    }
    if (sourceVideo.readyState < 2) {
        statusEl.textContent = '⏳ Video not ready, please wait.';
        return;
    }
    await processVideo();
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SETTINGS CHANGE → re-init WebSR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

networkSelect.addEventListener('change', () => {
    websr = null;
    if (uploadComplete) initWebSR();
});

contentSelect.addEventListener('change', () => {
    websr = null;
    if (uploadComplete) initWebSR();
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  INIT ON LOAD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Pre-warm WebSR so it's ready when the user uploads
initWebSR().then(() => {
    statusEl.textContent = '✅ Ready – upload a video to start.';
    statusEl.className = '';
});

console.log('🚀 AI Video Enhancer loaded.');
console.log('ℹ️  All processing runs locally in your browser.');

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

let websr = null;
let isProcessing = false;
let recordedChunks = [];
let mediaRecorder = null;
let uploadComplete = false;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  WEIGHT URLS – using jsDelivr (more reliable)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ✅ FIXED: using jsDelivr CDN instead of raw.githubusercontent.com
const WEIGHT_BASE = 'https://cdn.jsdelivr.net/gh/sb2702/websr@main/weights/anime4k/';

function getWeightUrl(network, content) {
    const netName = network.split('/')[1]; // e.g., "cnn-2x-s"
    const suffix = content === 'anime' ? '' : `-${content}`;
    return `${WEIGHT_BASE}${netName}${suffix}.json`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  INIT WebSR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function initWebSR() {
    const network = networkSelect.value;
    const content = contentSelect.value;

    const gpu = await WebSR.initWebGPU();
    if (!gpu) {
        statusEl.textContent = '❌ WebGPU not supported in this browser.';
        statusEl.className = '';
        return false;
    }

    const weightUrl = getWeightUrl(network, content);
    statusEl.textContent = `⏳ Loading AI model from CDN...`;
    statusEl.className = 'loading';

    let weights;
    try {
        const res = await fetch(weightUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status} – try refreshing`);
        weights = await res.json();
    } catch (err) {
        statusEl.textContent = `❌ Failed to load weights: ${err.message}`;
        statusEl.className = '';
        console.error('Weight URL attempted:', weightUrl);
        return false;
    }

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

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const stream = canvas.captureStream(30);
    const mimeType = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
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

    mediaRecorder.start(1000);

    let frameCount = 0;
    const totalFrames = Math.floor(video.duration * 30);

    function renderFrame() {
        if (video.paused || video.ended || mediaRecorder.state === 'inactive') {
            if (mediaRecorder.state === 'recording') mediaRecorder.stop();
            return;
        }

        websr.render(video).then(() => {
            frameCount++;
            if (frameCount % 30 === 0) {
                const pct = Math.min(100, Math.round((frameCount / totalFrames) * 100));
                statusEl.textContent = `⏳ Processing... ${pct}%`;
                statusEl.className = 'loading';
            }
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

    video.currentTime = 0;
    await video.play();
    video.requestVideoFrameCallback(renderFrame);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  FILE UPLOAD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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
    downloadBtn.href = '';
    recordedChunks = [];
    statusEl.textContent = '✅ Video loaded. Click "Enhance".';
    statusEl.className = '';

    enhanceBtn.disabled = false;
    uploadComplete = true;

    if (!websr) {
        await initWebSR();
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  BUTTONS
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

initWebSR().then(() => {
    statusEl.textContent = '✅ Ready – upload a video to start.';
    statusEl.className = '';
});

console.log('🚀 AI Video Enhancer loaded (jsDelivr CDN).');

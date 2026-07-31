// 4K AI Video Enhancer — client-side engine
// Uses WebSR (WebGPU) for AI upscaling and a GPU-accelerated CSS filter for
// the "Teal & Orange" cinematic color grade.

import WebSR from "https://esm.sh/@websr/websr@0.0.16?v=1";

// ✅ FIXED: Use the GitHub-hosted weights via jsDelivr (they actually exist)
// The npm package does NOT contain the weight files – this is the correct path.
const WEIGHTS_BASE =
  "https://cdn.jsdelivr.net/gh/sb2702/websr@main/weights/anime4k/";

const CINEMATIC_FILTER =
  "contrast(1.15) saturate(1.5) brightness(1.05) sepia(0.08) hue-rotate(-8deg)";

const els = {
  fileInput: document.getElementById("fileInput"),
  fileName: document.getElementById("fileName"),
  modelSelect: document.getElementById("modelSelect"),
  gradeToggle: document.getElementById("gradeToggle"),
  enhanceBtn: document.getElementById("enhanceBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  status: document.getElementById("status"),
  originalVideo: document.getElementById("originalVideo"),
  outputCanvas: document.getElementById("outputCanvas"),
};

let gpuDevice = null;
let websr = null;
let currentModelKey = null;

let mediaRecorder = null;
let recordedChunks = [];
let outputBlobUrl = null;
let renderLoopActive = false;

function setStatus(message) {
  els.status.textContent = message;
}

function applyCinematicGrade() {
  els.outputCanvas.style.filter = els.gradeToggle.checked
    ? CINEMATIC_FILTER
    : "none";
}

els.gradeToggle.addEventListener("change", applyCinematicGrade);
applyCinematicGrade();

// ---------------------------------------------------------------------
// WebGPU capability check
// ---------------------------------------------------------------------
if (!("gpu" in navigator)) {
  setStatus(
    "WebGPU is not available in this browser. Try a recent Chrome/Edge on desktop."
  );
  els.enhanceBtn.disabled = true;
}

// ---------------------------------------------------------------------
// File loading — uses `canplay`, not readyState polling, to avoid the
// "stuck on loading" bug some browsers trigger with readyState checks.
// ---------------------------------------------------------------------
els.fileInput.addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  els.fileName.textContent = file.name;
  els.enhanceBtn.disabled = true;
  els.downloadBtn.disabled = true;

  if (outputBlobUrl) {
    URL.revokeObjectURL(outputBlobUrl);
    outputBlobUrl = null;
  }

  const objectUrl = URL.createObjectURL(file);
  els.originalVideo.src = objectUrl;
  els.originalVideo.load();
  setStatus("Loading video...");
});

els.originalVideo.addEventListener("canplay", () => {
  if (navigator.gpu) {
    els.enhanceBtn.disabled = false;
  }
  setStatus("Video ready. Choose a model and click Enhance.");
});

els.originalVideo.addEventListener("error", () => {
  setStatus("Could not load this video file.");
  els.enhanceBtn.disabled = true;
});

// ---------------------------------------------------------------------
// WebSR initialization — loads AI weights from the CORRECT CDN.
// Includes a fallback to raw.githubusercontent.com in case jsDelivr fails.
// ---------------------------------------------------------------------
async function fetchWeightsWithFallback(modelKey) {
  const urls = [
    `${WEIGHTS_BASE}${modelKey}.json`,
    `https://raw.githubusercontent.com/sb2702/websr/main/weights/anime4k/${modelKey}.json`
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'force-cache' });
      if (res.ok) {
        const data = await res.json();
        console.log(`[WebSR] ✅ Loaded weights from: ${url}`);
        return data;
      }
    } catch (e) {
      console.warn(`[WebSR] Failed to load from ${url}`, e);
    }
  }
  throw new Error("All weight URLs failed.");
}

async function initWebSR(modelKey) {
  if (websr && currentModelKey === modelKey) {
    return websr;
  }

  setStatus("Loading AI model...");

  if (!gpuDevice) {
    gpuDevice = await WebSR.initWebGPU();
    if (!gpuDevice) {
      throw new Error("This browser/device doesn't support WebGPU.");
    }
  }

  const weights = await fetchWeightsWithFallback(modelKey);

  websr = new WebSR({
    network_name: `anime4k/${modelKey}`,
    weights,
    gpu: gpuDevice,
    canvas: els.outputCanvas,
  });

  currentModelKey = modelKey;
  setStatus("AI model loaded.");
  return websr;
}

// ---------------------------------------------------------------------
// Processing pipeline: upscale via WebSR, grade via CSS filter (GPU),
// capture the canvas as a stream, and record it with MediaRecorder.
// ---------------------------------------------------------------------
async function processVideo() {
  const video = els.originalVideo;
  const canvas = els.outputCanvas;
  const modelKey = els.modelSelect.value;

  els.enhanceBtn.disabled = true;
  els.downloadBtn.disabled = true;

  try {
    await initWebSR(modelKey);
  } catch (err) {
    setStatus(`Error loading AI model: ${err.message}`);
    els.enhanceBtn.disabled = false;
    return;
  }

  canvas.width = video.videoWidth * 2;
  canvas.height = video.videoHeight * 2;
  applyCinematicGrade();

  recordedChunks = [];
  const stream = canvas.captureStream(30);

  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : "video/webm";

  mediaRecorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 20_000_000,
  });

  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: "video/webm" });
    if (outputBlobUrl) URL.revokeObjectURL(outputBlobUrl);
    outputBlobUrl = URL.createObjectURL(blob);
    els.downloadBtn.disabled = false;
    els.enhanceBtn.disabled = false;
    setStatus("Done — your 4K video is ready to download.");
  };

  function finishRecording() {
    renderLoopActive = false;
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
  }

  video.addEventListener("ended", finishRecording, { once: true });

  function renderLoop() {
    if (!renderLoopActive) return;

    websr
      .render(video)
      .then(() => {
        if (!renderLoopActive) return;

        const progress = video.duration
          ? Math.min(100, Math.round((video.currentTime / video.duration) * 100))
          : 0;
        setStatus(`Processing: ${progress}%`);

        if (video.ended) {
          finishRecording();
          return;
        }

        video.requestVideoFrameCallback(renderLoop);
      })
      .catch((err) => {
        renderLoopActive = false;
        setStatus(`Rendering error: ${err.message}`);
      });
  }

  try {
    setStatus("Processing: 0%");
    renderLoopActive = true;
    mediaRecorder.start();
    video.currentTime = 0;
    video.muted = true;
    await video.play();
    video.requestVideoFrameCallback(renderLoop);
  } catch (err) {
    renderLoopActive = false;
    setStatus(`Could not start processing: ${err.message}`);
    els.enhanceBtn.disabled = false;
  }
}

els.enhanceBtn.addEventListener("click", () => {
  processVideo().catch((err) => {
    setStatus(`Unexpected error: ${err.message}`);
    els.enhanceBtn.disabled = false;
  });
});

els.downloadBtn.addEventListener("click", () => {
  if (!outputBlobUrl) return;
  const link = document.createElement("a");
  link.href = outputBlobUrl;
  link.download = "enhanced-4k.webm";
  document.body.appendChild(link);
  link.click();
  link.remove();
});

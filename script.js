// 4K AI Video Enhancer — Hybrid Version (NPM CDN + Content Type)

import WebSR from "https://esm.sh/@websr/websr@0.0.16?v=1";

const WEIGHTS_BASE =
  "https://cdn.jsdelivr.net/npm/@websr/websr@0.0.16/weights/anime4k/";

const SUFFIX_MAP = {
  anime: "an",
  real: "rl",
  "3d": "3d"
};

const CINEMATIC_FILTER =
  "contrast(1.15) saturate(1.5) brightness(1.05) sepia(0.08) hue-rotate(-8deg)";

const els = {
  fileInput: document.getElementById("fileInput"),
  fileName: document.getElementById("fileName"),
  modelSelect: document.getElementById("modelSelect"),
  contentTypeSelect: document.getElementById("contentTypeSelect"),
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
let currentContentType = null;

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

// ─── WebGPU check ───
if (!("gpu" in navigator)) {
  setStatus("WebGPU unavailable. Use recent Chrome/Edge on desktop.");
  els.enhanceBtn.disabled = true;
}

// ─── File loading ───
els.fileInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
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
  setStatus("Video ready. Select model/content and click Enhance.");
});

els.originalVideo.addEventListener("error", () => {
  setStatus("Could not load this video file.");
  els.enhanceBtn.disabled = true;
});

// ─── Build weight URL with content suffix ───
function getWeightUrl(modelKey, contentType) {
  const suffix = SUFFIX_MAP[contentType] || "rl";
  return `${WEIGHTS_BASE}${modelKey}-${suffix}.json`;
}

// ─── Init WebSR ───
async function initWebSR(modelKey, contentType) {
  if (websr && currentModelKey === modelKey && currentContentType === contentType) {
    return websr;
  }

  setStatus("Loading AI model...");

  if (!gpuDevice) {
    gpuDevice = await WebSR.initWebGPU();
    if (!gpuDevice) {
      throw new Error("This browser/device doesn't support WebGPU.");
    }
  }

  const weightsUrl = getWeightUrl(modelKey, contentType);
  const weightsResponse = await fetch(weightsUrl);
  if (!weightsResponse.ok) {
    throw new Error(
      `Failed to fetch model weights (${weightsResponse.status}) from ${weightsUrl}`
    );
  }
  const weights = await weightsResponse.json();

  websr = new WebSR({
    network_name: `anime4k/${modelKey}`,
    weights,
    gpu: gpuDevice,
    canvas: els.outputCanvas,
  });

  currentModelKey = modelKey;
  currentContentType = contentType;
  setStatus("AI model loaded.");
  return websr;
}

// ─── Process Video ───
async function processVideo() {
  const video = els.originalVideo;
  const canvas = els.outputCanvas;
  const modelKey = els.modelSelect.value;
  const contentType = els.contentTypeSelect ? els.contentTypeSelect.value : "real";

  els.enhanceBtn.disabled = true;
  els.downloadBtn.disabled = true;

  try {
    await initWebSR(modelKey, contentType);
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

// ─── Event listeners ───
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

// ─── Re-init when model/content changes ───
els.modelSelect.addEventListener("change", () => {
  websr = null;
  if (els.originalVideo.src) {
    initWebSR(els.modelSelect.value, els.contentTypeSelect?.value || "real");
  }
});

if (els.contentTypeSelect) {
  els.contentTypeSelect.addEventListener("change", () => {
    websr = null;
    if (els.originalVideo.src) {
      initWebSR(els.modelSelect.value, els.contentTypeSelect.value);
    }
  });
}

// ─── Initial status ───
setStatus("Waiting for a video...");

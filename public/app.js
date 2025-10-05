const video = document.getElementById('camera');
const canvas = document.getElementById('outputCanvas');
const ctx = canvas.getContext('2d', { alpha: false });
const sourceCanvas = document.createElement('canvas');
const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });

const dogFaceToggle = document.getElementById('dogFaceToggle');
const whitenInput = document.getElementById('whiten');
const slimFaceInput = document.getElementById('slimFace');
const bigEyesInput = document.getElementById('bigEyes');
const autoMakeupInput = document.getElementById('autoMakeup');
const zoomInButton = document.getElementById('zoomIn');
const zoomOutButton = document.getElementById('zoomOut');
const zoomValue = document.getElementById('zoomValue');
const switchCameraButton = document.getElementById('switchCamera');
const toggleFlashButton = document.getElementById('toggleFlash');
const statusOverlay = document.getElementById('statusOverlay');
const statusMessage = document.getElementById('statusMessage');
const offlineMessage = document.getElementById('offlineMessage');
const updateModelsButton = document.getElementById('updateModels');
const downloadStatus = document.querySelector('.download-status');
const progressText = downloadStatus?.querySelector('.progress-text');
const progressBar = downloadStatus?.querySelector('.progress');
const faceDetectorMessage = document.getElementById('faceDetectorMessage');

class CameraController {
  constructor(videoElement) {
    this.video = videoElement;
    this.currentStream = null;
    this.devices = [];
    this.currentDeviceIndex = 0;
    this.zoom = 1;
    this.minZoom = 0.25;
    this.maxZoom = 10;
    this.zoomStep = 0.1;
    this.usingCssZoom = false;
    this.flashOn = false;
    this.lastConstraints = null;
  }

  async init() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前浏览器不支持摄像头访问');
    }

    await this.enumerateDevices();
    await this.startStream();
  }

  async enumerateDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.devices = devices.filter((d) => d.kind === 'videoinput');
    } catch (error) {
      console.warn('无法列举摄像头设备', error);
      this.devices = [];
    }
  }

  getNextDeviceId() {
    if (!this.devices.length) return undefined;
    this.currentDeviceIndex = (this.currentDeviceIndex + 1) % this.devices.length;
    return this.devices[this.currentDeviceIndex]?.deviceId;
  }

  async startStream(deviceId) {
    if (this.currentStream) {
      this.currentStream.getTracks().forEach((track) => track.stop());
      this.currentStream = null;
    }

    const baseConstraints = {
      audio: false,
      video: {
        facingMode: deviceId ? undefined : { ideal: 'environment' },
        deviceId: deviceId ? { exact: deviceId } : undefined,
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    };

    this.lastConstraints = baseConstraints;

    const stream = await navigator.mediaDevices.getUserMedia(baseConstraints);
    this.currentStream = stream;
    video.srcObject = stream;
    await this.enumerateDevices();

    const [videoTrack] = stream.getVideoTracks();
    const capabilities = videoTrack?.getCapabilities?.() ?? {};
    const settings = videoTrack?.getSettings?.() ?? {};

    if (capabilities.zoom) {
      this.minZoom = capabilities.zoom.min ?? 1;
      this.maxZoom = capabilities.zoom.max ?? 1;
      this.zoomStep = capabilities.zoom.step ?? 0.1;
      this.zoom = settings.zoom ?? 1;
      this.usingCssZoom = false;
    } else {
      this.minZoom = 0.25;
      this.maxZoom = 10;
      this.zoomStep = 0.1;
      this.zoom = 1;
      this.usingCssZoom = true;
    }

    this.updateZoomDisplay();
    await this.applyZoom();
    await this.updateTorchState();
  }

  async switchCamera() {
    const nextDeviceId = this.getNextDeviceId();
    try {
      await this.startStream(nextDeviceId);
    } catch (error) {
      console.error('切换摄像头失败', error);
      throw error;
    }
  }

  async toggleFlash() {
    this.flashOn = !this.flashOn;
    await this.updateTorchState();
    return this.flashOn;
  }

  async updateTorchState() {
    const track = this.currentStream?.getVideoTracks?.()[0];
    if (!track?.applyConstraints) return false;

    const capabilities = track.getCapabilities?.() ?? {};
    if (!capabilities.torch) {
      toggleFlashButton.disabled = true;
      return false;
    }

    toggleFlashButton.disabled = false;
    try {
      await track.applyConstraints({ advanced: [{ torch: this.flashOn }] });
      return true;
    } catch (error) {
      console.warn('设置闪光灯失败', error);
      return false;
    }
  }

  async adjustZoom(delta) {
    const newZoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom + delta));
    this.zoom = Math.round(newZoom * 100) / 100;
    await this.applyZoom();
    this.updateZoomDisplay();
  }

  async applyZoom() {
    const track = this.currentStream?.getVideoTracks?.()[0];
    if (!track) return;

    if (!this.usingCssZoom && track.applyConstraints) {
      try {
        await track.applyConstraints({ advanced: [{ zoom: this.zoom }] });
        video.style.transform = 'none';
        canvas.style.transform = 'none';
        return;
      } catch (error) {
        console.warn('硬件缩放失败，使用CSS缩放', error);
        this.usingCssZoom = true;
      }
    }

    const scale = this.zoom;
    const transform = `scale(${scale})`;
    video.style.transform = transform;
    canvas.style.transform = transform;
  }

  updateZoomDisplay() {
    const percentage = Math.round(this.zoom * 100);
    zoomValue.textContent = `${percentage}%`;
    zoomOutButton.disabled = this.zoom <= this.minZoom;
    zoomInButton.disabled = this.zoom >= this.maxZoom;
  }
}

class FaceProcessor {
  constructor() {
    this.detector = null;
    this.available = 'FaceDetector' in window;
    this.faces = [];
    this.lastDetection = 0;
    this.cooldown = 120;
    if (this.available) {
      try {
        this.detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 5 });
      } catch (error) {
        console.warn('初始化 FaceDetector 失败', error);
        this.available = false;
      }
    }
  }

  async detect(videoElement) {
    if (!this.available || !videoElement?.videoWidth) return this.faces;
    const now = performance.now();
    if (now - this.lastDetection < this.cooldown) {
      return this.faces;
    }

    try {
      this.faces = await this.detector.detect(videoElement);
      this.lastDetection = now;
    } catch (error) {
      console.warn('人脸检测失败', error);
      this.faces = [];
      this.available = false;
    }
    return this.faces;
  }

  drawDogFace(ctx, face) {
    if (!face?.boundingBox) return;
    const { width, height, top, left } = face.boundingBox;
    const centerX = left + width / 2;
    const centerY = top + height / 2;

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Draw ears
    const earHeight = height * 0.6;
    const earWidth = width * 0.45;
    const earYOffset = height * 0.1;

    ctx.fillStyle = 'rgba(139, 79, 44, 0.9)';
    ctx.beginPath();
    ctx.moveTo(centerX - earWidth, top - earYOffset);
    ctx.quadraticCurveTo(centerX - earWidth * 0.2, top - earHeight, centerX - width * 0.1, top - earYOffset * 0.5);
    ctx.quadraticCurveTo(centerX - earWidth * 0.4, top - earHeight * 0.2, centerX - earWidth, top - earYOffset);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(centerX + earWidth, top - earYOffset);
    ctx.quadraticCurveTo(centerX + earWidth * 0.2, top - earHeight, centerX + width * 0.1, top - earYOffset * 0.5);
    ctx.quadraticCurveTo(centerX + earWidth * 0.4, top - earHeight * 0.2, centerX + earWidth, top - earYOffset);
    ctx.fill();

    // Inner ears
    ctx.fillStyle = 'rgba(255, 179, 189, 0.8)';
    ctx.beginPath();
    ctx.ellipse(centerX - earWidth * 0.45, top - earYOffset * 0.7, earWidth * 0.25, earHeight * 0.35, Math.PI / 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(centerX + earWidth * 0.45, top - earYOffset * 0.7, earWidth * 0.25, earHeight * 0.35, -Math.PI / 6, 0, Math.PI * 2);
    ctx.fill();

    // Draw muzzle
    const muzzleWidth = width * 0.65;
    const muzzleHeight = height * 0.45;
    const muzzleTop = centerY + height * 0.05;

    const gradient = ctx.createRadialGradient(centerX, muzzleTop + muzzleHeight * 0.4, muzzleHeight * 0.1, centerX, muzzleTop + muzzleHeight * 0.4, muzzleHeight);
    gradient.addColorStop(0, 'rgba(255, 248, 240, 0.95)');
    gradient.addColorStop(1, 'rgba(230, 210, 185, 0.9)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(centerX, muzzleTop, muzzleWidth / 2, muzzleHeight / 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Nose
    ctx.fillStyle = 'rgba(74, 49, 38, 0.95)';
    ctx.beginPath();
    ctx.moveTo(centerX, muzzleTop - muzzleHeight * 0.1);
    ctx.quadraticCurveTo(centerX - muzzleWidth * 0.18, muzzleTop + muzzleHeight * 0.15, centerX, muzzleTop + muzzleHeight * 0.18);
    ctx.quadraticCurveTo(centerX + muzzleWidth * 0.18, muzzleTop + muzzleHeight * 0.15, centerX, muzzleTop - muzzleHeight * 0.1);
    ctx.fill();

    // Nose shine
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.beginPath();
    ctx.ellipse(centerX - muzzleWidth * 0.08, muzzleTop + muzzleHeight * 0.01, muzzleWidth * 0.08, muzzleHeight * 0.05, -Math.PI / 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

class BeautyController {
  constructor() {
    this.settings = {
      whiten: 0.2,
      slimFace: 0.3,
      bigEyes: 0.4,
      autoMakeup: 0.25,
    };
  }

  updateSetting(key, value) {
    this.settings[key] = value;
  }

  applyGlobalFilters(canvas) {
    const { whiten, autoMakeup } = this.settings;
    const brightness = 1 + whiten * 0.5;
    const saturation = 1 + autoMakeup * 0.6;
    const contrast = 1 + autoMakeup * 0.2;
    const softening = whiten > 0 ? ` blur(${(whiten * 2).toFixed(2)}px)` : '';
    canvas.style.filter = `brightness(${brightness.toFixed(2)}) saturate(${saturation.toFixed(2)}) contrast(${contrast.toFixed(2)})${softening}`;
  }

  applySlimFace(ctx, width, height) {
    const { slimFace } = this.settings;
    if (slimFace <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.min(0.45, slimFace * 0.45);
    const gradientLeft = ctx.createLinearGradient(0, 0, width * 0.3, 0);
    gradientLeft.addColorStop(0, 'rgba(0,0,0,0.8)');
    gradientLeft.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradientLeft;
    ctx.fillRect(0, 0, width * 0.35, height);

    const gradientRight = ctx.createLinearGradient(width, 0, width * 0.7, 0);
    gradientRight.addColorStop(0, 'rgba(0,0,0,0.8)');
    gradientRight.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradientRight;
    ctx.fillRect(width * 0.65, 0, width * 0.35, height);
    ctx.restore();
  }

  applyBigEyes(ctx, sourceCtx, face) {
    const { bigEyes } = this.settings;
    if (bigEyes <= 0 || !face?.landmarks) return;
    const eyePoints = face.landmarks.filter((point) => point.type === 'leftEye' || point.type === 'rightEye');
    if (!eyePoints.length) return;

    ctx.save();
    const strength = Math.min(0.45, bigEyes * 0.45);
    eyePoints.forEach((landmark) => {
      const size = face.boundingBox.width * 0.25;
      const radius = size * 0.4;
      const gradient = ctx.createRadialGradient(landmark.x, landmark.y, radius * 0.3, landmark.x, landmark.y, radius);
      gradient.addColorStop(0, `rgba(255, 255, 255, ${0.35 * strength})`);
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(landmark.x, landmark.y, radius, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  applyMakeup(ctx, face) {
    const { autoMakeup } = this.settings;
    if (autoMakeup <= 0 || !face?.boundingBox) return;
    const { width, height, top, left } = face.boundingBox;
    const cheekRadius = (Math.min(width, height) / 2) * 0.45;
    const cheekXOffset = width * 0.25;
    const intensity = Math.min(0.35, autoMakeup * 0.35);

    ctx.save();
    ctx.globalAlpha = intensity;
    ctx.fillStyle = 'rgba(255, 99, 132, 0.7)';

    ctx.beginPath();
    ctx.ellipse(left + width / 2 - cheekXOffset, top + height * 0.6, cheekRadius, cheekRadius * 0.65, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(left + width / 2 + cheekXOffset, top + height * 0.6, cheekRadius, cheekRadius * 0.65, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

class ModelManager {
  constructor() {
    this.dbPromise = this.openDatabase();
  }

  openDatabase() {
    if (!('indexedDB' in window)) {
      console.warn('浏览器不支持 IndexedDB，模型将存储在内存中');
      return Promise.resolve(null);
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open('beauty-face-models', 1);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('models')) {
          db.createObjectStore('models');
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta');
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async getStore(storeName, mode = 'readonly') {
    const db = await this.dbPromise;
    if (!db) return null;
    const tx = db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  }

  async saveModel(name, data) {
    const store = await this.getStore('models', 'readwrite');
    if (!store) return;
    store.put(data, name);
  }

  async saveMetadata(meta) {
    const store = await this.getStore('meta', 'readwrite');
    if (!store) return;
    store.put(meta, 'manifest');
  }

  async getMetadata() {
    const store = await this.getStore('meta');
    if (!store) return null;
    return new Promise((resolve) => {
      const req = store.get('manifest');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }

  async checkForUpdates(onProgress) {
    const manifestResponse = await fetch('models/manifest.json', { cache: 'no-cache' });
    const manifest = await manifestResponse.json();
    const meta = await this.getMetadata();

    if (meta?.version === manifest.version) {
      onProgress?.({ completed: manifest.models.length, total: manifest.models.length, message: '模型已是最新版本' });
      return manifest;
    }

    let completed = 0;
    const total = manifest.models.length;

    for (const model of manifest.models) {
      onProgress?.({ completed, total, message: `下载 ${model.name}...` });
      const response = await fetch(model.url, { cache: 'no-cache' });
      const buffer = await response.arrayBuffer();
      await this.saveModel(model.name, buffer);
      completed += 1;
      onProgress?.({ completed, total, message: `${model.name} 下载完成` });
    }

    await this.saveMetadata({ version: manifest.version, timestamp: Date.now() });
    return manifest;
  }
}

const cameraController = new CameraController(video);
const faceProcessor = new FaceProcessor();
const beautyController = new BeautyController();
const modelManager = new ModelManager();

let animationFrameId = null;

function resizeCanvas() {
  if (!video.videoWidth || !video.videoHeight) return;
  if (canvas.width === video.videoWidth && canvas.height === video.videoHeight) return;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  sourceCanvas.width = video.videoWidth;
  sourceCanvas.height = video.videoHeight;
}

async function renderFrame() {
  resizeCanvas();
  if (!video.videoWidth || !video.videoHeight) {
    animationFrameId = requestAnimationFrame(renderFrame);
    return;
  }

  sourceCtx.drawImage(video, 0, 0, sourceCanvas.width, sourceCanvas.height);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);

  const faces = await faceProcessor.detect(video);
  reflectFaceDetectorSupport();
  beautyController.applyGlobalFilters(canvas);

  beautyController.applySlimFace(ctx, canvas.width, canvas.height);
  faces.forEach((face) => {
    beautyController.applyBigEyes(ctx, sourceCtx, face);
    beautyController.applyMakeup(ctx, face);
    if (dogFaceToggle.checked) {
      faceProcessor.drawDogFace(ctx, face);
    }
  });

  animationFrameId = requestAnimationFrame(renderFrame);
}

function showStatus(message) {
  statusMessage.textContent = message;
  statusOverlay.hidden = false;
}

function hideStatus() {
  statusOverlay.hidden = true;
}

function updateOfflineBanner() {
  if (navigator.onLine) {
    offlineMessage.textContent = '准备就绪，可离线使用。';
  } else {
    offlineMessage.textContent = '当前为离线模式，功能受缓存支持。';
  }
}

function reflectFaceDetectorSupport() {
  if (!faceDetectorMessage) return;
  if (faceProcessor.available) {
    faceDetectorMessage.textContent = '已启用设备端人脸识别，滤镜可智能贴合。';
    faceDetectorMessage.dataset.state = 'supported';
  } else {
    faceDetectorMessage.textContent = '浏览器暂不支持 FaceDetector API，滤镜将以全局效果呈现。';
    faceDetectorMessage.dataset.state = 'unsupported';
  }
}

async function startApp() {
  try {
    showStatus('正在启动摄像头...');
    await cameraController.init();
    hideStatus();
    renderFrame();
  } catch (error) {
    console.error(error);
    showStatus(error.message || '摄像头初始化失败');
  }
}

function setupControls() {
  zoomInButton.addEventListener('click', () => cameraController.adjustZoom(cameraController.zoomStep));
  zoomOutButton.addEventListener('click', () => cameraController.adjustZoom(-cameraController.zoomStep));
  switchCameraButton.addEventListener('click', async () => {
    showStatus('切换摄像头中...');
    try {
      await cameraController.switchCamera();
    } catch (error) {
      console.error(error);
    } finally {
      hideStatus();
    }
  });

  toggleFlashButton.addEventListener('click', async () => {
    const enabled = await cameraController.toggleFlash();
    toggleFlashButton.classList.toggle('active', enabled);
  });

  const updateSetting = (key) => (event) => {
    const value = Number(event.target.value) / 100;
    beautyController.updateSetting(key, value);
  };

  whitenInput.addEventListener('input', updateSetting('whiten'));
  slimFaceInput.addEventListener('input', updateSetting('slimFace'));
  bigEyesInput.addEventListener('input', updateSetting('bigEyes'));
  autoMakeupInput.addEventListener('input', updateSetting('autoMakeup'));

  updateModelsButton.addEventListener('click', async () => {
    if (!downloadStatus || !progressText || !progressBar) return;
    downloadStatus.hidden = false;
    progressText.textContent = '正在检查更新...';
    progressBar.style.width = '0%';
    try {
      await modelManager.checkForUpdates(({ completed, total, message }) => {
        progressText.textContent = message;
        const percent = total === 0 ? 100 : Math.round((completed / total) * 100);
        progressBar.style.width = `${percent}%`;
      });
      progressText.textContent = '模型库已更新，可以离线使用最新效果。';
      progressBar.style.width = '100%';
    } catch (error) {
      console.error('模型更新失败', error);
      progressText.textContent = '模型更新失败，请稍后重试。';
    }
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('service-worker.js')
      .then(() => console.log('Service worker 注册成功'))
      .catch((error) => console.error('Service worker 注册失败', error));
  });
}

function setupOfflineHandlers() {
  window.addEventListener('online', updateOfflineBanner);
  window.addEventListener('offline', updateOfflineBanner);
  updateOfflineBanner();
}

registerServiceWorker();
setupOfflineHandlers();
setupControls();
reflectFaceDetectorSupport();
startApp();

window.addEventListener('beforeunload', () => {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
});

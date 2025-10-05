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
const faceStatusBadge = document.getElementById('faceStatusBadge');

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

class SimpleFaceDetector {
  constructor() {
    this.ready = false;
    this.sampleCanvas = document.createElement('canvas');
    this.sampleCtx = this.sampleCanvas.getContext('2d', { willReadFrequently: true });
    this.targetSize = 160;
    this.minimumCoverage = 0.015;
    this.lastBounding = null;
    this.lastLandmarks = null;
    this.missedFrames = 0;
    this.smoothing = 0.65;
  }

  async load() {
    this.ready = true;
    return this;
  }

  isSkinPixel(r, g, b) {
    if (r < 50 || g < 40 || b < 20) return false;
    const maxValue = Math.max(r, g, b);
    const minValue = Math.min(r, g, b);
    if (maxValue - minValue < 15) return false;
    if (r <= g || r <= b) return false;

    const sum = r + g + b + 1;
    const rRatio = r / sum;
    const gRatio = g / sum;
    const normalizedSkin = rRatio > 0.36 && rRatio < 0.465 && gRatio > 0.28 && gRatio < 0.363;
    const brightSkin = r > 200 && g > 210 && b > 170;

    return normalizedSkin || brightSkin;
  }

  clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  createLandmarks(bounding, centerX, centerY, frameWidth, frameHeight) {
    const { left, top, width, height } = bounding;
    const eyeOffsetX = width * 0.22;
    const eyeOffsetY = height * 0.32;
    const noseOffsetY = height * 0.5;
    const mouthOffsetY = height * 0.72;

    return [
      {
        x: this.clamp(centerX - eyeOffsetX, 0, frameWidth),
        y: this.clamp(top + eyeOffsetY, 0, frameHeight),
        type: 'leftEye',
      },
      {
        x: this.clamp(centerX + eyeOffsetX, 0, frameWidth),
        y: this.clamp(top + eyeOffsetY, 0, frameHeight),
        type: 'rightEye',
      },
      {
        x: this.clamp(centerX, 0, frameWidth),
        y: this.clamp(top + noseOffsetY, 0, frameHeight),
        type: 'nose',
      },
      {
        x: this.clamp(centerX, 0, frameWidth),
        y: this.clamp(top + mouthOffsetY, 0, frameHeight),
        type: 'mouth',
      },
    ];
  }

  smoothBounding(current) {
    if (!this.lastBounding) {
      this.lastBounding = { ...current };
      return current;
    }

    const blend = this.smoothing;
    const previous = this.lastBounding;
    const smoothed = {
      left: previous.left * blend + current.left * (1 - blend),
      top: previous.top * blend + current.top * (1 - blend),
      width: previous.width * blend + current.width * (1 - blend),
      height: previous.height * blend + current.height * (1 - blend),
    };

    this.lastBounding = { ...smoothed };
    return smoothed;
  }

  async detect(videoElement) {
    if (!this.ready || !videoElement?.videoWidth || !videoElement?.videoHeight) {
      return [];
    }

    const frameWidth = videoElement.videoWidth;
    const frameHeight = videoElement.videoHeight;
    const maxDim = Math.max(frameWidth, frameHeight);
    const scale = Math.min(1, this.targetSize / maxDim);
    const sampleWidth = Math.max(32, Math.round(frameWidth * scale));
    const sampleHeight = Math.max(32, Math.round(frameHeight * scale));

    this.sampleCanvas.width = sampleWidth;
    this.sampleCanvas.height = sampleHeight;
    this.sampleCtx.drawImage(videoElement, 0, 0, sampleWidth, sampleHeight);
    const { data } = this.sampleCtx.getImageData(0, 0, sampleWidth, sampleHeight);

    let minX = sampleWidth;
    let minY = sampleHeight;
    let maxX = -1;
    let maxY = -1;
    let count = 0;
    let sumX = 0;
    let sumY = 0;

    for (let y = 0; y < sampleHeight; y += 1) {
      for (let x = 0; x < sampleWidth; x += 1) {
        const index = (y * sampleWidth + x) * 4;
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        if (!this.isSkinPixel(r, g, b)) continue;

        count += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        sumX += x;
        sumY += y;
      }
    }

    if (count === 0) {
      this.missedFrames += 1;
      if (this.missedFrames <= 4 && this.lastBounding && this.lastLandmarks) {
        return [
          {
            boundingBox: { ...this.lastBounding },
            landmarks: this.lastLandmarks.map((point) => ({ ...point })),
          },
        ];
      }
      this.lastBounding = null;
      this.lastLandmarks = null;
      return [];
    }

    const coverage = count / (sampleWidth * sampleHeight);
    if (coverage < this.minimumCoverage || coverage > 0.6) {
      this.missedFrames += 1;
      if (this.missedFrames <= 4 && this.lastBounding && this.lastLandmarks) {
        return [
          {
            boundingBox: { ...this.lastBounding },
            landmarks: this.lastLandmarks.map((point) => ({ ...point })),
          },
        ];
      }
      this.lastBounding = null;
      this.lastLandmarks = null;
      return [];
    }

    this.missedFrames = 0;

    const widthRatio = frameWidth / sampleWidth;
    const heightRatio = frameHeight / sampleHeight;

    const rawLeft = Math.max(0, (minX / sampleWidth) * frameWidth);
    const rawTop = Math.max(0, (minY / sampleHeight) * frameHeight);
    const rawWidth = Math.min(frameWidth, ((maxX - minX + 1) / sampleWidth) * frameWidth);
    const rawHeight = Math.min(frameHeight, ((maxY - minY + 1) / sampleHeight) * frameHeight);

    const paddingX = rawWidth * 0.2;
    const paddingY = rawHeight * 0.25;

    const bounding = {
      left: this.clamp(rawLeft - paddingX, 0, frameWidth),
      top: this.clamp(rawTop - paddingY, 0, frameHeight),
      width: 0,
      height: 0,
    };

    bounding.width = this.clamp(rawWidth + paddingX * 2, 0, frameWidth - bounding.left);
    bounding.height = this.clamp(rawHeight + paddingY * 2, 0, frameHeight - bounding.top);

    const centerX = (sumX / count) * widthRatio;
    const centerY = (sumY / count) * heightRatio;

    const smoothedBounding = this.smoothBounding(bounding);
    const landmarks = this.createLandmarks(smoothedBounding, centerX, centerY, frameWidth, frameHeight);

    this.lastBounding = { ...smoothedBounding };
    this.lastLandmarks = landmarks.map((point) => ({ ...point }));

    return [
      {
        boundingBox: { ...smoothedBounding },
        landmarks: landmarks.map((point) => ({ ...point })),
      },
    ];
  }
}

class FaceProcessor {
    constructor() {
      this.nativeDetector = null;
      this.available = false;
      this.supportsNative = 'FaceDetector' in window;
      this.loadingFallback = false;
      this.loadingFallbackPromise = null;
      this.usingFallback = false;
      this.faces = [];
      this.lastDetection = 0;
      this.cooldown = 120;
      this.fallbackDetector = null;
      this.fallbackReady = false;

      if (this.supportsNative) {
        try {
          this.nativeDetector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 5 });
          this.available = true;
        } catch (error) {
          console.warn('初始化 FaceDetector 失败', error);
          this.nativeDetector = null;
          this.supportsNative = false;
        }
      }
    }

    hasNativeSupport() {
      return !!this.nativeDetector;
    }

    isFallbackLoading() {
      return this.loadingFallback;
    }

    isUsingFallback() {
      return this.usingFallback;
    }

    async prepareFallback() {
      if (this.supportsNative) return;
      try {
        await this.getFallbackDetector();
      } catch (error) {
        console.warn('离线人脸检测器预加载失败', error);
      }
    }

    async getFallbackDetector() {
      if (this.fallbackDetector && this.fallbackReady) {
        return this.fallbackDetector;
      }
      if (this.loadingFallbackPromise) {
        await this.loadingFallbackPromise;
        return this.fallbackDetector;
      }

      this.loadingFallback = true;
      const loadPromise = (async () => {
        try {
          if (!this.fallbackDetector) {
            this.fallbackDetector = new SimpleFaceDetector();
          }

          await this.fallbackDetector.load();
          this.fallbackReady = true;
          this.available = true;
          this.usingFallback = true;
          return this.fallbackDetector;
        } catch (error) {
          console.warn('加载离线人脸检测器失败', error);
          this.fallbackDetector = null;
          this.fallbackReady = false;
          if (!this.nativeDetector) {
            this.available = false;
          }
          this.usingFallback = false;
          return null;
        } finally {
          this.loadingFallback = false;
          this.loadingFallbackPromise = null;
          if (typeof reflectFaceDetectorSupport === 'function') {
            requestAnimationFrame(() => reflectFaceDetectorSupport(this.faces));
          }
        }
      })();

      this.loadingFallbackPromise = loadPromise;
      return loadPromise;
    }

    normalizeDetection(result, videoElement) {
      const videoWidth = videoElement.videoWidth || 0;
      const videoHeight = videoElement.videoHeight || 0;
      const clamp = (value, min, max) => Math.min(Math.max(value ?? 0, min), max);

      const boundingSource = result?.boundingBox ?? result?.bounding ?? null;
      const detectionBox = result?.detection?.box ?? result?.detection?._box ?? null;

      const sourceBox = boundingSource ||
        (detectionBox
          ? {
              left: detectionBox.x ?? detectionBox.left,
              top: detectionBox.y ?? detectionBox.top,
              width: detectionBox.width,
              height: detectionBox.height,
            }
          : null);

      if (!sourceBox) {
        return null;
      }

      const width = clamp(sourceBox.width, 0, videoWidth);
      const height = clamp(sourceBox.height, 0, videoHeight);
      const bounding = {
        left: clamp(sourceBox.left ?? sourceBox.x, 0, Math.max(0, videoWidth - width)),
        top: clamp(sourceBox.top ?? sourceBox.y, 0, Math.max(0, videoHeight - height)),
        width,
        height,
      };

      const typedLandmarks = [];
      if (Array.isArray(result?.landmarks)) {
        result.landmarks.forEach((point) => {
          if (!point) return;
          typedLandmarks.push({
            x: clamp(point.x, 0, videoWidth),
            y: clamp(point.y, 0, videoHeight),
            type: point.type,
          });
        });
      } else if (result?.landmarks) {
        const mapLandmarks = (getter, type) => {
          const points = typeof getter === 'function' ? getter.call(result.landmarks) : [];
          if (!Array.isArray(points)) return;
          points.forEach((point) => {
            if (!point) return;
            typedLandmarks.push({
              x: clamp(point.x ?? point._x ?? 0, 0, videoWidth),
              y: clamp(point.y ?? point._y ?? 0, 0, videoHeight),
              type,
            });
          });
        };

        mapLandmarks(result.landmarks.getLeftEye, 'leftEye');
        mapLandmarks(result.landmarks.getRightEye, 'rightEye');

        const nose = result.landmarks.getNose?.() ?? [];
        if (nose.length) {
          const nosePoint = nose[Math.floor(nose.length / 2)];
          if (nosePoint) {
            typedLandmarks.push({
              x: clamp(nosePoint.x ?? nosePoint._x ?? 0, 0, videoWidth),
              y: clamp(nosePoint.y ?? nosePoint._y ?? 0, 0, videoHeight),
              type: 'nose',
            });
          }
        }

        const mouth = result.landmarks.getMouth?.() ?? [];
        if (mouth.length) {
          const mouthPoint = mouth[Math.floor(mouth.length / 2)];
          if (mouthPoint) {
            typedLandmarks.push({
              x: clamp(mouthPoint.x ?? mouthPoint._x ?? 0, 0, videoWidth),
              y: clamp(mouthPoint.y ?? mouthPoint._y ?? 0, 0, videoHeight),
              type: 'mouth',
            });
          }
        }
      }

      return { boundingBox: bounding, landmarks: typedLandmarks };
    }

    async detect(videoElement) {
      if (!videoElement?.videoWidth) return this.faces;
      const now = performance.now();
      if (now - this.lastDetection < this.cooldown) {
        return this.faces;
      }

      if (this.nativeDetector) {
        try {
          this.faces = await this.nativeDetector.detect(videoElement);
          this.lastDetection = now;
          return this.faces;
        } catch (error) {
          console.warn('人脸检测失败，尝试启用离线检测器', error);
          this.faces = [];
          this.nativeDetector = null;
          this.available = false;
          this.supportsNative = false;
          this.prepareFallback();
        }
      }

      const fallbackDetector = await this.getFallbackDetector();
      if (!fallbackDetector) {
        return this.faces;
      }

      try {
        const detections = await fallbackDetector.detect(videoElement);
        const normalized = Array.isArray(detections)
          ? detections
              .map((result) => this.normalizeDetection(result, videoElement))
              .filter(Boolean)
          : [];

        this.faces = normalized;
        this.lastDetection = now;
        this.available = true;
        this.usingFallback = true;
      } catch (error) {
        console.warn('离线人脸检测失败', error);
        this.faces = [];
        if (!this.nativeDetector) {
          this.available = false;
        }
      }
      return this.faces;
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
let cameraStartTimeout = null;
let awaitingUserInteraction = false;
const userActivationEvents = ['click', 'touchstart'];

function updateFaceStatusBadge(state, text) {
  if (!faceStatusBadge) return;
  if (typeof text === 'string') {
    faceStatusBadge.textContent = text;
  }
  if (state) {
    faceStatusBadge.dataset.state = state;
  }
}

function disableUserInteractionPrompt() {
  if (!awaitingUserInteraction) return;
  awaitingUserInteraction = false;
  userActivationEvents.forEach((eventName) => {
    const options = eventName === 'touchstart' ? { passive: true } : undefined;
    document.removeEventListener(eventName, handleUserActivation, options);
  });
}

function handleUserActivation() {
  if (!awaitingUserInteraction) return;
  showStatus('正在尝试启动摄像头...');
  if (!cameraStartTimeout) {
    cameraStartTimeout = setTimeout(() => {
      statusMessage.textContent = '摄像头启动耗时较长，请确认浏览器已授权访问。';
    }, 6000);
  }
  video
    .play()
    .then(() => {
      disableUserInteractionPrompt();
      updateFaceStatusBadge('pending', '检测中...');
    })
    .catch((error) => {
      console.warn('用户触发的摄像头播放失败', error);
    });
}

function enableUserInteractionPrompt() {
  if (awaitingUserInteraction) return;
  awaitingUserInteraction = true;
  userActivationEvents.forEach((eventName) => {
    const options = eventName === 'touchstart' ? { passive: true } : undefined;
    document.addEventListener(eventName, handleUserActivation, options);
  });
}

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
  reflectFaceDetectorSupport(faces);
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
  disableUserInteractionPrompt();
  if (cameraStartTimeout) {
    clearTimeout(cameraStartTimeout);
    cameraStartTimeout = null;
  }
}

function handleVideoReady() {
  hideStatus();
  updateFaceStatusBadge('pending', '检测中...');
}

function updateOfflineBanner() {
  if (navigator.onLine) {
    offlineMessage.textContent = '准备就绪，可离线使用。';
  } else {
    offlineMessage.textContent = '当前为离线模式，功能受缓存支持。';
  }
}

function reflectFaceDetectorSupport(faces = []) {
  if (!faceDetectorMessage) return;

  const fallbackLoading = typeof faceProcessor.isFallbackLoading === 'function' && faceProcessor.isFallbackLoading();

  if (!faceProcessor.available) {
    if (fallbackLoading) {
      faceDetectorMessage.textContent = '正在加载离线人脸检测器，小狗脸滤镜稍后可用。';
      faceDetectorMessage.dataset.state = 'pending';
      updateFaceStatusBadge('pending', '检测准备中...');
      if (dogFaceToggle && !dogFaceToggle.disabled) {
        dogFaceToggle.disabled = true;
      }
    } else {
      faceDetectorMessage.textContent = '浏览器暂不支持人脸检测，滤镜将以全局效果呈现。';
      faceDetectorMessage.dataset.state = 'unsupported';
      if (dogFaceToggle) {
        dogFaceToggle.checked = false;
        dogFaceToggle.disabled = true;
      }
      updateFaceStatusBadge('error', '检测不可用');
    }
    return;
  }

  if (dogFaceToggle?.disabled) {
    dogFaceToggle.disabled = false;
  }

  const usingFallback = typeof faceProcessor.isUsingFallback === 'function' && faceProcessor.isUsingFallback();
  const detectorSourceText = usingFallback ? '离线人脸检测器' : '系统内置人脸检测器';
  const badgeSuffix = usingFallback ? '（离线检测器）' : '（系统检测器）';

  if (!video?.srcObject) {
    faceDetectorMessage.textContent = usingFallback
      ? '摄像头准备中，已启用离线人脸检测器，小狗脸滤镜将自动启用。'
      : '摄像头准备中，小狗脸滤镜将自动启用。';
    faceDetectorMessage.dataset.state = 'pending';
    updateFaceStatusBadge('pending', '检测中...');
    return;
  }

  const hasFaces = Array.isArray(faces) && faces.length > 0;

  if (!dogFaceToggle?.checked) {
    faceDetectorMessage.textContent = usingFallback
      ? '已关闭小狗脸滤镜，但离线人脸检测器仍在后台运行。'
      : '已关闭小狗脸滤镜。';
    faceDetectorMessage.dataset.state = 'inactive';
    updateFaceStatusBadge(hasFaces ? 'ready' : 'warning', hasFaces ? `已检测到人脸 ${badgeSuffix}` : `未检测到人脸 ${badgeSuffix}`);
    return;
  }

  if (hasFaces) {
    const faceCountText = faces.length === 1 ? '1 张人脸' : `${faces.length} 张人脸`;
    faceDetectorMessage.textContent = `已通过${detectorSourceText}识别到 ${faceCountText} 并应用小狗脸滤镜。`;
    faceDetectorMessage.dataset.state = 'active';
    updateFaceStatusBadge('ready', `已检测到人脸 ${badgeSuffix}`);
  } else {
    faceDetectorMessage.textContent = `使用${detectorSourceText}未检测到人脸，小狗脸滤镜暂不会显示。`;
    faceDetectorMessage.dataset.state = 'warning';
    updateFaceStatusBadge('warning', `未检测到人脸 ${badgeSuffix}`);
  }
}

async function startApp() {
  try {
    showStatus('正在启动摄像头...');
    if (cameraStartTimeout) {
      clearTimeout(cameraStartTimeout);
      cameraStartTimeout = null;
    }
    cameraStartTimeout = setTimeout(() => {
      statusMessage.textContent = '摄像头启动耗时较长，请确认浏览器已授权访问。';
    }, 6000);

    if (typeof faceProcessor.hasNativeSupport === 'function' && !faceProcessor.hasNativeSupport()) {
      faceProcessor.prepareFallback();
      reflectFaceDetectorSupport(faceProcessor.faces);
    }

    await cameraController.init();
    hideStatus();
    updateFaceStatusBadge('pending', '检测中...');
    reflectFaceDetectorSupport(faceProcessor.faces);

    try {
      await video.play();
    } catch (error) {
      console.warn('视频自动播放失败', error);
      showStatus('需要您的操作以启动摄像头，请点击页面允许播放。');
      if (cameraStartTimeout) {
        clearTimeout(cameraStartTimeout);
        cameraStartTimeout = null;
      }
      enableUserInteractionPrompt();
      reflectFaceDetectorSupport(faceProcessor.faces);
    }

    renderFrame();
  } catch (error) {
    console.error(error);
    showStatus(error.message || '摄像头初始化失败');
    if (cameraStartTimeout) {
      clearTimeout(cameraStartTimeout);
      cameraStartTimeout = null;
    }
    if (faceDetectorMessage) {
      faceDetectorMessage.textContent = '摄像头未能启动，小狗脸滤镜不可用。';
      faceDetectorMessage.dataset.state = 'warning';
    }
    updateFaceStatusBadge('error', '检测不可用');
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

  dogFaceToggle.addEventListener('change', () => {
    reflectFaceDetectorSupport(faceProcessor.faces);
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

    if (!window.isSecureContext) {
      console.warn('当前环境不是安全上下文，跳过 Service worker 注册');
      return;
    }

    window.addEventListener('load', async () => {
      try {
        const workerUrl = new URL('service-worker.js', window.location.href);
        await navigator.serviceWorker.register(workerUrl);
        console.log('Service worker 注册成功');
      } catch (error) {
        if (error?.name === 'SecurityError') {
          console.warn('由于证书问题，Service worker 注册已被跳过。');
          return;
        }
        console.error('Service worker 注册失败', error);
      }
    });
  }

function setupOfflineHandlers() {
  window.addEventListener('online', updateOfflineBanner);
  window.addEventListener('offline', updateOfflineBanner);
  updateOfflineBanner();
}

video.addEventListener('loadeddata', handleVideoReady, { once: true });
video.addEventListener('playing', handleVideoReady, { once: true });

registerServiceWorker();
setupOfflineHandlers();
setupControls();
reflectFaceDetectorSupport();
startApp();

window.addEventListener('beforeunload', () => {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
});

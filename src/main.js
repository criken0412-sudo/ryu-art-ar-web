import * as THREE from 'three';
import { MindARThree } from 'mind-ar/dist/mindar-image-three.prod.js';
import './style.css';

const artworks = [
  { id: 'work-0', title: '最初の作品', image: 'media/work-0.jpg', video: 'media/work-0.mp4', loop: false, intro: 0.35 },
  { id: 'work-1', title: '作品 1', image: 'media/work-1.jpg', video: 'media/work-1.mp4', loop: false, intro: 0.35 },
  { id: 'work-2', title: '作品 2', image: 'media/work-2.jpg', video: 'media/work-2.mp4', loop: true, intro: 0.35 },
  { id: 'work-3', title: '作品 3', image: 'media/work-3.jpg', video: 'media/work-3.mp4', loop: true, intro: 0.35 },
  { id: 'work-4', title: '作品 4', image: 'media/work-4.jpg', video: 'media/work-4.mp4', loop: true, intro: 2 },
  { id: 'work-5', title: '作品 5', image: 'media/work-5.png', video: 'media/work-5.mp4', loop: true, intro: 2 },
];

const baseUrl = import.meta.env.BASE_URL;
for (const artwork of artworks) {
  artwork.image = `${baseUrl}${artwork.image}`;
  artwork.video = `${baseUrl}${artwork.video}`;
}
const $ = (selector) => document.querySelector(selector);
const screens = ['home', 'gallery', 'detail', 'help', 'camera-screen'];
const toast = $('#toast');
let toastTimer;
let mindar = null;
let activeIndex = -1;
let videoStates = [];
let anchors = [];
let operation = 0;
let cameraRunning = false;

function showScreen(id) {
  for (const screen of screens) $(`#${screen}`).classList.toggle('hidden', screen !== id);
}

function notify(message, duration = 3200) {
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), duration);
}

function buildGallery() {
  const grid = $('#artwork-grid');
  grid.replaceChildren();
  artworks.forEach((art, index) => {
    const card = document.createElement('button');
    card.className = 'artwork-card';
    card.innerHTML = `<img src="${art.image}" alt="${art.title}" loading="lazy"><span>${art.title}</span>`;
    card.addEventListener('click', () => {
      $('#detail-title').textContent = art.title;
      $('#detail-image').src = art.image;
      showScreen('detail');
    });
    grid.append(card);
  });
}

function createState(art, index, mind) {
  const image = new THREE.TextureLoader().load(art.image);
  image.colorSpace = THREE.SRGBColorSpace;
  image.anisotropy = mind.renderer.capabilities.getMaxAnisotropy();

  const baseMaterial = new THREE.MeshBasicMaterial({ map: image, side: THREE.DoubleSide });
  const base = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), baseMaterial);
  base.position.z = 0;

  const video = document.createElement('video');
  video.src = art.video;
  video.preload = 'none';
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.crossOrigin = 'anonymous';
  video.loop = art.loop;
  video.muted = true;
  video.controls = false;
  videoStates[index] = { art, video, texture: null, overlay: null, base, material: null, visible: false, generation: 0, introTimer: null, pending: false };

  const state = videoStates[index];
  state.overlay = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  state.overlay.position.z = 0.002;
  const anchor = mind.addAnchor(index);
  anchor.group.add(base, state.overlay);
  anchor.onTargetFound = () => onTargetFound(index);
  anchor.onTargetLost = () => onTargetLost(index);
  return anchor;
}

function setAspect(state) {
  const video = state.video;
  const width = state.base.material.map.image.naturalWidth || state.base.material.map.image.width;
  const height = state.base.material.map.image.naturalHeight || state.base.material.map.image.height;
  if (!width || !height) return;
  const targetRatio = width / height;
  state.base.scale.set(1, 1 / targetRatio, 1);
  state.overlay.scale.set(1, 1 / targetRatio, 1);
  if (!video.videoWidth || !video.videoHeight || !state.texture) return;
  const videoRatio = video.videoWidth / video.videoHeight;
  if (videoRatio > targetRatio) {
    state.texture.repeat.set(targetRatio / videoRatio, 1);
    state.texture.offset.set((1 - targetRatio / videoRatio) / 2, 0);
  } else {
    state.texture.repeat.set(1, videoRatio / targetRatio);
    state.texture.offset.set(0, (1 - videoRatio / targetRatio) / 2);
  }
}

function ensureVideoTexture(state) {
  if (state.texture) return;
  state.texture = new THREE.VideoTexture(state.video);
  state.texture.colorSpace = THREE.SRGBColorSpace;
  state.texture.minFilter = THREE.LinearFilter;
  state.texture.magFilter = THREE.LinearFilter;
  state.texture.generateMipmaps = false;
  state.overlay.material.map = state.texture;
  state.overlay.material.needsUpdate = true;
  state.video.addEventListener('loadedmetadata', () => setAspect(state), { once: true });
  setAspect(state);
}

function waitForData(video) {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('動画を読み込めませんでした。')); };
    const cleanup = () => { video.removeEventListener('loadeddata', done); video.removeEventListener('error', fail); };
    video.addEventListener('loadeddata', done, { once: true });
    video.addEventListener('error', fail, { once: true });
    video.load();
  });
}

function waitForSeek(video) {
  if (video.currentTime === 0 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
  return new Promise((resolve) => {
    video.addEventListener('seeked', resolve, { once: true });
    video.currentTime = 0;
  });
}

async function prepareVideo(state, generation) {
  ensureVideoTexture(state);
  await waitForData(state.video);
  if (generation !== state.generation) return false;
  state.video.pause();
  if (state.video.currentTime > 0) await waitForSeek(state.video);
  state.texture.needsUpdate = true;
  return generation === state.generation;
}

function fadeToVideo(state, generation, duration) {
  return new Promise((resolve) => {
    const started = performance.now();
    const frame = () => {
      if (generation !== state.generation) { resolve(false); return; }
      const progress = Math.min(1, (performance.now() - started) / duration);
      state.overlay.material.opacity = progress;
      if (progress < 1) requestAnimationFrame(frame);
      else resolve(true);
    };
    requestAnimationFrame(frame);
  });
}

async function playState(state, { replay = false } = {}) {
  if (state.pending) return;
  state.pending = true;
  state.generation += 1;
  const generation = state.generation;
  clearTimeout(state.introTimer);
  state.video.loop = state.art.loop;
  try {
    if (replay || state.video.ended || state.video.currentTime > 0) {
      state.video.pause();
      await prepareVideo(state, generation);
    } else {
      await prepareVideo(state, generation);
    }
    if (generation !== state.generation) return;
    if (state.art.intro >= 2) {
      state.overlay.material.opacity = 0;
      state.overlay.visible = true;
      if (!await fadeToVideo(state, generation, state.art.intro * 1000)) return;
    } else {
      state.overlay.material.opacity = 0;
      state.overlay.visible = true;
    }
    state.video.muted = false;
    try {
      await state.video.play();
    } catch {
      state.video.muted = true;
      await state.video.play();
      $('#enable-sound').classList.remove('hidden');
    }
    if (generation !== state.generation) { state.video.pause(); return; }
    if (state.art.intro < 2) await fadeToVideo(state, generation, state.art.intro * 1000);
    $('#replay-button').classList.remove('hidden');
    $('#camera-status').classList.add('hidden');
  } catch (error) {
    notify(error.message || '動画を再生できませんでした。');
  } finally {
    state.pending = false;
  }
}

function onTargetFound(index) {
  const state = videoStates[index];
  if (!state) return;
  $('#camera-status').classList.add('hidden');
  if (activeIndex !== index) {
    if (activeIndex >= 0) stopState(videoStates[activeIndex]);
    activeIndex = index;
    state.visible = true;
    playState(state);
  } else if (!state.art.loop && state.video.paused && !state.video.ended && !state.pending) {
    state.video.play().catch(() => {});
  }
}

function onTargetLost(index) {
  const state = videoStates[index];
  if (!state) return;
  if (!state.art.loop && !state.video.ended) state.video.pause();
  if (index === activeIndex) {
    $('#camera-status').textContent = '絵の全体を映してください';
    $('#camera-status').classList.remove('hidden');
  }
}

function stopState(state) {
  if (!state) return;
  state.generation += 1;
  state.pending = false;
  clearTimeout(state.introTimer);
  state.video.pause();
  state.video.currentTime = 0;
  state.overlay.material.opacity = 0;
  state.overlay.visible = true;
}

async function startCamera() {
  if (cameraRunning) return;
  const startButton = $('#camera-start');
  startButton.disabled = true;
  startButton.textContent = '準備しています';
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('このブラウザではカメラを使えません。HTTPSのSafariまたはChromeで開いてください。');
    showScreen('camera-screen');
    $('#camera-status').classList.remove('hidden');
    $('#camera-status').textContent = 'カメラを準備しています';
    if (!mindar) {
      mindar = new MindARThree({
        container: $('#ar-container'), imageTargetSrc: `${baseUrl}targets.mind`, maxTrack: 1,
        uiLoading: 'no', uiScanning: 'no', uiError: 'no',
        filterMinCF: 0.0005, filterBeta: 1000, warmupTolerance: 4, missTolerance: 6,
        environmentDeviceId: undefined,
      });
      videoStates = [];
      anchors = artworks.map((art, i) => createState(art, i, mindar));
    }
    await mindar.start();
    cameraRunning = true;
    $('#camera-start').classList.add('hidden');
    $('#camera-status').textContent = '絵の全体を映してください';
  } catch (error) {
    await stopCamera();
    showScreen('camera-screen');
    startButton.classList.remove('hidden');
    startButton.disabled = false;
    startButton.textContent = 'もう一度試す';
    $('#camera-status').textContent = error.message || 'カメラを開始できませんでした。';
    $('#camera-status').classList.remove('hidden');
  }
}

async function stopCamera() {
  if (mindar) {
    try { mindar.stop(); } catch { /* Already stopped. */ }
    mindar.renderer.setAnimationLoop(null);
    mindar = null;
  }
  videoStates.forEach(stopState);
  videoStates = [];
  anchors = [];
  activeIndex = -1;
  cameraRunning = false;
  $('#replay-button').classList.add('hidden');
  $('#enable-sound').classList.add('hidden');
  $('#camera-start').classList.remove('hidden');
  $('#camera-start').disabled = false;
  $('#camera-start').textContent = 'カメラをはじめる';
}

$('#camera-open').addEventListener('click', () => { showScreen('camera-screen'); startCamera(); });
$('#camera-start').addEventListener('click', startCamera);
$('#camera-close').addEventListener('click', async () => { await stopCamera(); showScreen('home'); });
$('#gallery-open').addEventListener('click', () => showScreen('gallery'));
$('#help-open').addEventListener('click', () => showScreen('help'));
document.querySelectorAll('[data-go-home]').forEach((button) => button.addEventListener('click', () => showScreen('home')));
document.querySelector('[data-go-gallery]').addEventListener('click', () => showScreen('gallery'));
$('#replay-button').addEventListener('click', () => { if (activeIndex >= 0) playState(videoStates[activeIndex], { replay: true }); });
$('#enable-sound').addEventListener('click', async () => {
  if (activeIndex < 0) return;
  const video = videoStates[activeIndex].video;
  video.muted = false;
  try { await video.play(); $('#enable-sound').classList.add('hidden'); }
  catch { notify('音声を有効にできませんでした。動画は無音で再生します。'); }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) videoStates.forEach((state) => { if (!state.art.loop) state.video.pause(); });
});

buildGallery();

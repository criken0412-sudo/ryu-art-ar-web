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
  const previous = screens.find((screen) => !$(`#${screen}`).classList.contains('hidden'));
  if (id === 'camera-screen' && previous === 'home') {
    $('#camera-screen').classList.remove('hidden');
    const home = $('#home');
    home.classList.remove('hidden');
    revealCameraFromHome();
    return;
  }
  for (const screen of screens) $(`#${screen}`).classList.toggle('hidden', screen !== id);
  if (id === 'home') {
    const home = $('#home');
    home.classList.remove('camera-transitioning', 'camera-transitioned');
    home.style.removeProperty('transform-origin');
  }
}

let cameraRevealToken = 0;
function revealCameraFromHome() {
  const home = $('#home');
  const art = $('.home-art');
  if (!home || !art) return;
  const token = ++cameraRevealToken;
  const box = art.getBoundingClientRect();
  const homeBox = home.getBoundingClientRect();
  home.style.transformOrigin = `${box.left + box.width / 2 - homeBox.left}px ${box.top + box.height / 2 - homeBox.top}px`;
  home.classList.add('camera-transitioning');
  requestAnimationFrame(() => {
    if (token === cameraRevealToken) home.classList.add('camera-transitioned');
  });
  setTimeout(() => {
    if (token === cameraRevealToken) home.classList.add('hidden');
  }, 1180);
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
    card.innerHTML = `<img src="${art.image}" alt="${art.title}" loading="lazy">`;
    card.addEventListener('click', () => {
      $('#detail-image').src = art.image;
      showScreen('detail');
    });
    grid.append(card);
  });
}

// 認識結果の細かな揺れを抑えるフィルター（One Euro Filter を位置・回転・大きさに分けて適用）。
// 小さな揺れは強くならし、スマホを大きく動かしたときは素早く追従します。
const SMOOTH = {
  minCutoff: 0.8, // 静止時のなめらかさ（Hz）。小さいほど揺れが減り、遅れが増えます。
  beta: 6, // 動いたときの追従の速さ。大きいほど速く動きに追いつきます。
  dCutoff: 1.5,
};
const smoothAlpha = (dt, cutoff) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));

class PoseSmoother {
  constructor() {
    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.scale = new THREE.Vector3(1, 1, 1);
    this.rawPosition = new THREE.Vector3();
    this.rawQuaternion = new THREE.Quaternion();
    this.rawScale = new THREE.Vector3();
    this.previousRawPosition = new THREE.Vector3();
    this.previousRawQuaternion = new THREE.Quaternion();
    this.previousRawScale = new THREE.Vector3(1, 1, 1);
    this.reset();
  }

  reset() {
    this.time = null;
    this.moveSpeed = 0;
    this.turnSpeed = 0;
  }

  update(matrix, target, now = performance.now()) {
    matrix.decompose(this.rawPosition, this.rawQuaternion, this.rawScale);
    if (this.time === null) {
      this.position.copy(this.rawPosition);
      this.quaternion.copy(this.rawQuaternion);
      this.scale.copy(this.rawScale);
    } else {
      const dt = Math.min(0.25, Math.max(0.001, (now - this.time) / 1000));
      const size = Math.max(1e-6, Math.abs(this.scale.x));
      // 移動の速さは「絵の幅に対する割合／秒」で測るため、絵の大きさや距離に左右されません。
      // 速度は連続する未処理の認識結果から計算します。平滑化後の表示位置との差を使うと、
      // フィルターの遅れまで速度として数えてしまい、静止中の小さな揺れにも過剰反応します。
      const move = (this.rawPosition.distanceTo(this.previousRawPosition) + this.rawScale.distanceTo(this.previousRawScale)) / size / dt;
      const turn = this.previousRawQuaternion.angleTo(this.rawQuaternion) / dt;
      const ad = smoothAlpha(dt, SMOOTH.dCutoff);
      this.moveSpeed += ad * (move - this.moveSpeed);
      this.turnSpeed += ad * (turn - this.turnSpeed);
      const moveAlpha = smoothAlpha(dt, SMOOTH.minCutoff + SMOOTH.beta * this.moveSpeed);
      const turnAlpha = smoothAlpha(dt, SMOOTH.minCutoff + SMOOTH.beta * this.turnSpeed);
      this.position.lerp(this.rawPosition, moveAlpha);
      this.scale.lerp(this.rawScale, moveAlpha);
      this.quaternion.slerp(this.rawQuaternion, turnAlpha);
    }
    this.previousRawPosition.copy(this.rawPosition);
    this.previousRawQuaternion.copy(this.rawQuaternion);
    this.previousRawScale.copy(this.rawScale);
    this.time = now;
    target.compose(this.position, this.quaternion, this.scale);
  }
}

function createState(art, index, mind) {
  // 画像の読み込み後に縦横比を合わせます（読み込み前は正方形のままになるため）。
  const image = new THREE.TextureLoader().load(art.image, () => { if (videoStates[index]) setAspect(videoStates[index]); });
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
  // MindARのアンカーは認識結果（生の位置）として使い、表示はならした位置の別グループで行います。
  const display = new THREE.Group();
  display.matrixAutoUpdate = false;
  display.visible = false;
  display.add(base, state.overlay);
  mind.scene.add(display);
  state.display = display;
  state.smoother = new PoseSmoother();
  const anchor = mind.addAnchor(index);
  anchor.onTargetFound = () => onTargetFound(index);
  anchor.onTargetLost = () => onTargetLost(index);
  state.anchor = anchor;
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
    let kickTimer;
    let failTimer;
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('動画を読み込めませんでした。通信状況を確認してください。')); };
    const cleanup = () => {
      clearTimeout(kickTimer);
      clearTimeout(failTimer);
      video.removeEventListener('loadeddata', done);
      video.removeEventListener('canplay', done);
      video.removeEventListener('error', fail);
    };
    video.addEventListener('loadeddata', done);
    video.addEventListener('canplay', done);
    video.addEventListener('error', fail);
    video.preload = 'auto';
    video.load();
    // iOSは読み込みだけでは最初のフレームを用意しないことがあるため、無音再生で読み込みを促します。
    kickTimer = setTimeout(() => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) { done(); return; }
      const wasMuted = video.muted;
      video.muted = true;
      video.play().then(() => { video.pause(); video.muted = wasMuted; }).catch(() => { video.muted = wasMuted; });
    }, 1500);
    failTimer = setTimeout(fail, 30000);
  });
}

function waitForSeek(video) {
  if (video.currentTime === 0 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 1500);
    video.addEventListener('seeked', () => { clearTimeout(timer); resolve(); }, { once: true });
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

// 毎フレーム、表示用グループを認識位置へなめらかに近づけます。
function updateDisplays() {
  for (const state of videoStates) {
    if (!state.anchor.group.visible) {
      if (state.display.visible) {
        state.display.visible = false;
        state.smoother.reset();
      }
      continue;
    }
    state.smoother.update(state.anchor.group.matrix, state.display.matrix);
    state.display.matrixWorldNeedsUpdate = true;
    state.display.visible = true;
  }
}

function ensureMindAR() {
  if (mindar) return mindar;
  mindar = new MindARThree({
    container: $('#ar-container'), imageTargetSrc: `${baseUrl}targets.mind`, maxTrack: 1,
    uiLoading: 'no', uiScanning: 'no', uiError: 'no',
    // MindAR側の平滑化は使わず（ほぼ素通し）、PoseSmootherでならします。
    filterMinCF: 1, filterBeta: 0, warmupTolerance: 4, missTolerance: 6,
  });
  // CSS3DRendererは使わないため、透明な全面レイヤーがタップを奪わないようにします。
  mindar.cssRenderer.domElement.style.pointerEvents = 'none';
  videoStates = [];
  anchors = artworks.map((art, i) => createState(art, i, mindar));
  return mindar;
}

function cameraTrack() {
  return mindar?.video?.srcObject?.getVideoTracks?.()[0] ?? null;
}

// MindARが作るカメラ映像・キャンバスの位置を、現在の画面サイズに合わせ直します。
// iOSではアドレスバーの伸縮やカメラ起動直後に画面サイズが変わるため、少し遅らせて再計算します。
let layoutTimer;
function relayout() {
  if (!cameraRunning || !mindar?.video) return;
  const container = $('#ar-container');
  if (!container.clientWidth || !container.clientHeight || !mindar.video.videoWidth) return;
  try { mindar.resize(); } catch { /* Not ready yet. */ }
}
function scheduleRelayout() {
  relayout();
  requestAnimationFrame(relayout);
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(relayout, 350);
}

function shutdownMindAR() {
  if (!mindar) return;
  try { mindar.controller?.stopProcessVideo(); } catch { /* Not started. */ }
  try { mindar.controller?.worker?.terminate(); } catch { /* Already terminated. */ }
  mindar.controller = null;
  const video = mindar.video;
  if (video) {
    video.srcObject?.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
    video.remove();
  }
  // videoをnullにするとMindAR内部のresizeが何もしなくなります。
  mindar.video = null;
  mindar.renderer.setAnimationLoop(null);
  mindar.renderer.clear();
  for (const anchor of mindar.anchors) {
    anchor.visible = false;
    anchor.group.visible = false;
  }
  for (const state of videoStates) {
    state.display.visible = false;
    state.smoother.reset();
  }
}

let pendingOperation = -1;
let startTask = null;

async function startCamera() {
  if (cameraRunning || pendingOperation === operation) return;
  const op = ++operation;
  pendingOperation = op;
  const startButton = $('#camera-start');
  startButton.disabled = true;
  startButton.textContent = '準備しています';
  showScreen('camera-screen');
  $('#camera-status').classList.remove('hidden');
  $('#camera-status').textContent = 'カメラを準備しています';
  let task = null;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('このブラウザではカメラを使えません。HTTPSのSafariまたはChromeで開いてください。');
    // 閉じる直前の起動処理が残っていれば、その後片付けを待ってから始めます。
    if (startTask) await startTask.catch(() => {});
    if (op !== operation) return;
    ensureMindAR();
    task = mindar.start();
    startTask = task;
    await task;
    if (op !== operation) { shutdownMindAR(); return; }
    const { renderer, scene, camera } = mindar;
    renderer.setAnimationLoop(() => { updateDisplays(); renderer.render(scene, camera); });
    cameraRunning = true;
    mindar.video.addEventListener('resize', scheduleRelayout);
    cameraTrack()?.addEventListener('ended', () => { if (op === operation) restartCamera(); });
    scheduleRelayout();
    startButton.classList.add('hidden');
    $('#camera-status').textContent = '絵の全体を映してください';
  } catch (error) {
    shutdownMindAR();
    if (op !== operation) return;
    startButton.classList.remove('hidden');
    startButton.disabled = false;
    startButton.textContent = 'もう一度試す';
    $('#camera-status').textContent = error?.message || 'カメラを開始できませんでした。カメラの許可を確認してください。';
    $('#camera-status').classList.remove('hidden');
  } finally {
    if (startTask === task) startTask = null;
    if (pendingOperation === op) pendingOperation = -1;
  }
}

function stopCamera() {
  operation += 1;
  pendingOperation = -1;
  // 起動中の場合は、起動処理が終わった時点でstartCamera側が片付けます。
  if (!startTask) shutdownMindAR();
  videoStates.forEach(stopState);
  activeIndex = -1;
  cameraRunning = false;
  $('#replay-button').classList.add('hidden');
  $('#enable-sound').classList.add('hidden');
  $('#camera-start').classList.remove('hidden');
  $('#camera-start').disabled = false;
  $('#camera-start').textContent = 'カメラをはじめる';
}

function restartCamera() {
  if ($('#camera-screen').classList.contains('hidden')) return;
  stopCamera();
  startCamera();
}

$('#camera-open').addEventListener('click', startCamera);
$('#camera-start').addEventListener('click', startCamera);
$('#camera-close').addEventListener('click', () => { ++cameraRevealToken; stopCamera(); showScreen('home'); });
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
  if (document.hidden) {
    videoStates.forEach((state) => { if (!state.art.loop) state.video.pause(); });
    return;
  }
  // 別アプリから戻るとiOSがカメラを止めていることがあるため、その場合は再起動します。
  if (cameraRunning && cameraTrack()?.readyState === 'ended') restartCamera();
  else scheduleRelayout();
});

window.addEventListener('resize', scheduleRelayout);
window.visualViewport?.addEventListener('resize', scheduleRelayout);
// 端末を回転するとカメラ映像の縦横が入れ替わり認識がずれるため、カメラを開き直します。
let lastPortrait = window.innerHeight >= window.innerWidth;
window.addEventListener('orientationchange', () => {
  setTimeout(() => {
    const portrait = window.innerHeight >= window.innerWidth;
    if (portrait !== lastPortrait && cameraRunning) restartCamera();
    lastPortrait = portrait;
  }, 400);
});

buildGallery();

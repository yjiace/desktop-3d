import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';

// --- 全局状态 ---
let partResponses = {
    head: "不要摸我的头！(>_<)",
    neck: "脖子好痒呀...",
    chest: "不...不可以色色！",
    hips: "呀！",
    leg: "腿...腿要断了！"
};
let defaultGreetings = ["你好！"];
let isFixed = false;

// --- 场景设置 ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.getElementById('viewer').appendChild(renderer.domElement);
const canvas = renderer.domElement;

// --- 鼠标控制 ---
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.screenSpacePanning = false;
controls.enablePan = false;

// --- 光源 ---
const light = new THREE.DirectionalLight(0xffffff);
light.position.set(1, 1, 1).normalize();
scene.add(light);
const ambientLight = new THREE.AmbientLight(0x404040);
scene.add(ambientLight);

// --- 视线跟随的目标 ---
const lookAtTarget = new THREE.Object3D();
camera.add(lookAtTarget);

// --- 加载VRM模型 ---
const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

let vrm = null;
let mixer = null;

// --- 加载配置 ---
async function getConfig() {
  if (window.electronAPI && window.electronAPI.getConfig) {
    return await window.electronAPI.getConfig();
  }
  return null;
}

let currentModelPath = null;

async function loadModelFromConfig() {
  const config = await getConfig();
  if (!config) return;
  if (config.modelPath && config.modelPath !== currentModelPath) {
    currentModelPath = config.modelPath;
    loadVRMModel(currentModelPath);
  }
}

// --- VRM模型加载函数，支持切换 ---
function loadVRMModel(modelPath) {
  if (vrm) {
    scene.remove(vrm.scene);
    vrm = null;
    mixer = null;
  }
  loader.load(
    modelPath,
    (gltf) => {
      vrm = gltf.userData.vrm;
      scene.add(vrm.scene);
      vrm.lookAt.target = lookAtTarget;
      const box = new THREE.Box3().setFromObject(vrm.scene);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      vrm.scene.position.sub(center);
      const maxSize = Math.max(size.x, size.y, size.z);
      const fitHeightDistance = maxSize / (2 * Math.tan(camera.fov * Math.PI / 360));
      const fitWidthDistance = fitHeightDistance / camera.aspect;
      const distance = 1.3 * Math.max(fitHeightDistance, fitWidthDistance);
      camera.position.set(0, 0, distance);
      controls.target.set(0, 0, 0);
      controls.update();
      if (gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(vrm.scene);
        const action = mixer.clipAction(gltf.animations[0]);
        action.play();
      }
      console.log('VRM 模型加载成功');
    },
    (progress) => console.log('加载进度:', 100.0 * (progress.loaded / progress.total), '%'),
    (error) => {
      alert('模型加载失败！');
      console.error('加载失败:', error);
    }
  );
}

// --- 启动时加载配置模型 ---
loadModelFromConfig();

// --- 监听配置变更，实时切换模型 ---
if (window.electronAPI && window.electronAPI.onConfigUpdated) {
  window.electronAPI.onConfigUpdated((config) => {
    if (config.modelPath && config.modelPath !== currentModelPath) {
      currentModelPath = config.modelPath;
      loadVRMModel(currentModelPath);
    }
  });
}

// --- 动画循环 ---
const clock = new THREE.Clock();

// --- 鼠标移动事件 ---
let mouseX = 0;
let mouseY = 0;
window.addEventListener('mousemove', (event) => {
    mouseX = (event.clientX / window.innerWidth) * 2 - 1;
    mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
});

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  
  // 根据鼠标位置更新视线目标
  const euler = new THREE.Euler(-mouseY * 0.1, mouseX * 0.1, 0, 'YXZ');
  lookAtTarget.position.set(0, 1.2, -1).applyEuler(euler);
  
  controls.update(); // 更新控制器

  if (vrm) {
    vrm.update(delta);
  }
  if (mixer) {
    mixer.update(delta);
  }
  renderer.render(scene, camera);
}

animate();

// --- UI 功能 ---
const pinButton = document.getElementById('pin-button');
const lockSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-lock"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;
const unlockSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-unlock"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`;

// NOTE: The drag button functionality is now handled entirely by CSS with `-webkit-app-region: drag`.
// No JS event needed for dragButton.

pinButton.addEventListener('click', () => {
    isFixed = !isFixed;
    const characterContainer = document.getElementById('character-container');
    const iconContainer = pinButton.querySelector('.icon-svg');

    if (isFixed) {
        characterContainer.classList.add('fixed');
        pinButton.classList.add('locked');
        iconContainer.innerHTML = unlockSvg;
        controls.enabled = false;
    } else {
        characterContainer.classList.remove('fixed');
        pinButton.classList.remove('locked');
        iconContainer.innerHTML = lockSvg;
        controls.enabled = true;
    }
});

// --- 窗口大小调整 ---
window.addEventListener('resize', onWindowResize, false);
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// 右键菜单：右键canvas或viewer区域时弹出菜单
const viewer = document.getElementById('viewer');
viewer.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (window.electronAPI && window.electronAPI.showContextMenu) {
        window.electronAPI.showContextMenu();
    }
});
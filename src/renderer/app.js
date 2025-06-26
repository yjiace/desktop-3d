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

// --- 状态保存相关 ---
let modelState = {
    scale: 1.0,
    cameraPosition: [0, 0, 3],
    cameraTarget: [0, 0, 0],
    cameraFov: 30,
    isFixed: false
};

// 防抖保存函数
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// 保存模型状态
const saveModelState = debounce(async (state) => {
    if (window.electronAPI && window.electronAPI.saveModelState) {
        await window.electronAPI.saveModelState(state);
    }
}, 500);

// 获取模型状态
async function getModelState() {
    if (window.electronAPI && window.electronAPI.getModelState) {
        return await window.electronAPI.getModelState();
    }
    return modelState;
}

// --- UI 功能 ---
const pinButton = document.getElementById('pin-button');
const lockSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-lock"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;
const unlockSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-unlock"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`;

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

// 监听控制器变化，保存状态
controls.addEventListener('change', () => {
    if (vrm && vrm.scene) {
        const newState = {
            // 不保存模型位置和旋转，保持原有的缩放中心逻辑
            scale: vrm.scene.scale.x,
            cameraPosition: camera.position.toArray(),
            cameraTarget: controls.target.toArray(),
            cameraFov: camera.fov,
            isFixed: isFixed
        };
        saveModelState(newState);
    }
});

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
    async (gltf) => {
      vrm = gltf.userData.vrm;
      scene.add(vrm.scene);
      vrm.lookAt.target = lookAtTarget;
      
      // 首先进行模型居中，保持原有的缩放中心逻辑
      const box = new THREE.Box3().setFromObject(vrm.scene);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      vrm.scene.position.sub(center);
      
      // 加载保存的状态
      const savedState = await getModelState();
      
      // 如果有保存的状态，应用相机和控制器状态
      if (savedState && savedState.cameraPosition) {
        // 应用相机状态
        camera.position.set(...savedState.cameraPosition);
        camera.fov = savedState.cameraFov;
        camera.updateProjectionMatrix();
        
        // 应用控制器状态
        controls.target.set(...savedState.cameraTarget);
        controls.update();
        
        // 应用缩放
        if (savedState.scale) {
          vrm.scene.scale.setScalar(savedState.scale);
        }
        
        // 应用固定状态
        isFixed = savedState.isFixed;
        if (isFixed) {
          const characterContainer = document.getElementById('character-container');
          const pinButton = document.getElementById('pin-button');
          
          if (characterContainer && pinButton) {
            const iconContainer = pinButton.querySelector('.icon-svg');
            if (iconContainer) {
              characterContainer.classList.add('fixed');
              pinButton.classList.add('locked');
              iconContainer.innerHTML = unlockSvg;
              controls.enabled = false;
            }
          }
        }
      } else {
        // 如果没有保存的状态，使用默认布局
        const maxSize = Math.max(size.x, size.y, size.z);
        const fitHeightDistance = maxSize / (2 * Math.tan(camera.fov * Math.PI / 360));
        const fitWidthDistance = fitHeightDistance / camera.aspect;
        const distance = 1.3 * Math.max(fitHeightDistance, fitWidthDistance);
        camera.position.set(0, 0, distance);
        controls.target.set(0, 0, 0);
        controls.update();
      }
      
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
    
    // 保存状态变化
    if (vrm && vrm.scene) {
        const newState = {
            // 不保存模型位置和旋转，保持原有的缩放中心逻辑
            scale: vrm.scene.scale.x,
            cameraPosition: camera.position.toArray(),
            cameraTarget: controls.target.toArray(),
            cameraFov: camera.fov,
            isFixed: isFixed
        };
        saveModelState(newState);
    }
});

// --- 窗口大小调整 ---
window.addEventListener('resize', onWindowResize, false);
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    
    // 保存窗口大小变化后的状态
    if (vrm && vrm.scene) {
        const newState = {
            // 不保存模型位置和旋转，保持原有的缩放中心逻辑
            scale: vrm.scene.scale.x,
            cameraPosition: camera.position.toArray(),
            cameraTarget: controls.target.toArray(),
            cameraFov: camera.fov,
            isFixed: isFixed
        };
        saveModelState(newState);
    }
}

// 右键菜单：右键canvas或viewer区域时弹出菜单
const viewer = document.getElementById('viewer');
viewer.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (window.electronAPI && window.electronAPI.showContextMenu) {
        window.electronAPI.showContextMenu();
    }
});

// 页面卸载前保存状态
window.addEventListener('beforeunload', () => {
    if (vrm && vrm.scene) {
        const finalState = {
            // 不保存模型位置和旋转，保持原有的缩放中心逻辑
            scale: vrm.scene.scale.x,
            cameraPosition: camera.position.toArray(),
            cameraTarget: controls.target.toArray(),
            cameraFov: camera.fov,
            isFixed: isFixed
        };
        // 立即保存，不使用防抖
        if (window.electronAPI && window.electronAPI.saveModelState) {
            window.electronAPI.saveModelState(finalState);
        }
    }
});
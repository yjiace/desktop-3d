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
let currentAction = 'idle';
let randomAnimationInterval = null;
let animationClips = [];

// --- 部位提示配置 ---
let partTips = {
    head: "头部",
    arms: "手臂",
    legs: "腿部",
    chest: "胸部",
    belly: "腹部",
    hips: "臀部",
    isFixed: false
};

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

function playAnimation(name) {
    if (!mixer || !animationClips.length) return;

    mixer.stopAllAction();

    const clip = THREE.AnimationClip.findByName(animationClips, name);
    if (clip) {
        const action = mixer.clipAction(clip);
        action.play();
    } else if (animationClips.length > 0) {
        const fallbackAction = mixer.clipAction(animationClips[0]);
        fallbackAction.play();
        console.warn('未找到动画：' + name + '，已回退到第一个动画：' + animationClips[0].name);
    } else {
        console.warn('当前模型没有任何动画，无法播放。');
    }
}

function setAppAction(actionName) {
    currentAction = actionName;

    if (randomAnimationInterval) {
        clearInterval(randomAnimationInterval);
        randomAnimationInterval = null;
    }

    if (actionName === 'random_cycle') {
        if (animationClips.length > 0) {
            const playRandom = () => {
                const randomIndex = Math.floor(Math.random() * animationClips.length);
                playAnimation(animationClips[randomIndex].name);
            };
            playRandom();
            randomAnimationInterval = setInterval(playRandom, 10000); // 每10秒切换一次
        } else {
             if(mixer) mixer.stopAllAction();
        }
    } else {
        playAnimation(actionName);
    }
}

function applySceneSettings(config) {
    // 背景
    if (config.appearance?.background) {
        const bgColor = config.appearance.background;
        if (bgColor === 'transparent') {
            renderer.setClearAlpha(0);
            scene.background = null;
        } else {
            renderer.setClearAlpha(1);
            scene.background = new THREE.Color(bgColor);
        }
    }

    // 灯光
    if (config.scene?.lightIntensity !== undefined) {
        light.intensity = config.scene.lightIntensity;
    }
}

// --- 气泡显示功能 ---
let speechBubble = null;
let bubbleTimeout = null;

function showSpeechBubble(text, clickedObject) {
    if (!speechBubble) {
        speechBubble = document.getElementById('speech-bubble');
    }
    
    if (bubbleTimeout) {
        clearTimeout(bubbleTimeout);
    }
    
    // 设置气泡文本
    speechBubble.textContent = text;
    
    let x = window.innerWidth / 2;
    let y = 50;
    let preferAbove = true;
    if (vrm && vrm.scene) {
        // 获取模型的头部位置
        const headPosition = getHeadPosition();
        // 将头部3D世界坐标转换为屏幕坐标
        const vector = new THREE.Vector3();
        vector.copy(headPosition);
        vector.project(camera);
        x = (vector.x * 0.5 + 0.5) * window.innerWidth;
        y = (-vector.y * 0.5 + 0.5) * window.innerHeight - 90; // 更贴近头部
        preferAbove = true;
    }
    // 先设置到理想位置
    speechBubble.style.left = x + 'px';
    speechBubble.style.top = y + 'px';
    speechBubble.style.transform = 'translateX(-50%)';
    speechBubble.style.maxWidth = '250px';
    speechBubble.style.whiteSpace = 'normal';
    speechBubble.style.visibility = 'hidden';
    speechBubble.style.opacity = '0';
    // 让DOM渲染后再判断实际尺寸
    setTimeout(() => {
        const rect = speechBubble.getBoundingClientRect();
        let newY = y;
        let triangleBelow = false; // true=三角在上，false=三角在下
        // 如果气泡顶部超出窗口，则下移到头部下方
        if (rect.top < 0) {
            if (vrm && vrm.scene) {
                // 头部下方
                const headPosition = getHeadPosition();
                const vector = new THREE.Vector3();
                vector.copy(headPosition);
                vector.project(camera);
                newY = (-vector.y * 0.5 + 0.5) * window.innerHeight + 10; // 更贴近下方
                triangleBelow = true;
            } else {
                newY = 20;
                triangleBelow = true;
            }
        }
        // 如果气泡底部超出窗口，则上移
        if (rect.bottom > window.innerHeight) {
            newY = window.innerHeight - rect.height - 10;
            triangleBelow = false;
        }
        // 如果气泡左侧超出
        let newX = x;
        if (rect.left < 0) {
            newX = rect.width / 2 + 10;
        }
        // 如果气泡右侧超出
        if (rect.right > window.innerWidth) {
            newX = window.innerWidth - rect.width / 2 - 10;
        }
        speechBubble.style.left = newX + 'px';
        speechBubble.style.top = newY + 'px';
        speechBubble.style.visibility = 'visible';
        speechBubble.style.opacity = '1';
        // 三角方向调整
        if (triangleBelow) {
            speechBubble.classList.add('bubble-below');
        } else {
            speechBubble.classList.remove('bubble-below');
        }
    }, 10);
    // 显示气泡
    speechBubble.classList.add('visible');
    // 3秒后自动隐藏
    bubbleTimeout = setTimeout(() => {
        speechBubble.classList.remove('visible');
    }, 3000);
}

// 获取模型头部位置 - 改进版本
function getHeadPosition() {
    if (!vrm || !vrm.scene) {
        // 如果没有VRM，返回模型中心位置
        return new THREE.Vector3(0, 0, 0);
    }
    
    // 尝试获取VRM的头部骨骼
    if (vrm.humanoid && vrm.humanoid.getBoneNode('head')) {
        const headBone = vrm.humanoid.getBoneNode('head');
        const headPosition = new THREE.Vector3();
        headBone.getWorldPosition(headPosition);
        console.log('使用VRM头部骨骼位置:', headPosition.toArray());
        return headPosition;
    }
    
    // 如果没有头部骨骼，计算模型顶部位置
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    
    // 返回模型顶部位置（头部位置）
    const headPosition = new THREE.Vector3(center.x, center.y + size.y * 0.5, center.z);
    console.log('使用计算头部位置:', headPosition.toArray(), '模型尺寸:', size.toArray());
    return headPosition;
}

// --- 点击检测功能 ---
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();

function setupClickEvents() {
    // 移除之前的事件监听器（如果存在）
    if (canvas) {
        canvas.removeEventListener('click', onMouseClick);
        canvas.removeEventListener('pointerdown', onMouseClick);
    }
    
    // 添加新的事件监听器
    canvas.addEventListener('pointerdown', onMouseClick);
    
    console.log('点击事件已设置，canvas元素:', canvas);
}

// 修改点击事件处理函数
async function onMouseClick(event) {
    // 只响应左键
    if (event.button !== 0) return;
    console.log('点击事件触发:', event.type, '目标:', event.target);
    
    // 新增：判断是否允许弹出气泡
    const config = await getConfig();
    if (!config?.model?.allowBubble) {
        console.log('未开启气泡弹出，忽略点击');
        return;
    }
    
    if (isFixed) {
        console.log('模型已固定，忽略点击');
        return;
    }
    
    if (!vrm || !vrm.scene) {
        console.log('VRM模型未加载，忽略点击');
        return;
    }
    
    // 阻止事件冒泡，避免与OrbitControls冲突
    event.preventDefault();
    event.stopPropagation();
    
    // 计算鼠标位置
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    console.log('鼠标位置:', { x: mouse.x, y: mouse.y, clientX: event.clientX, clientY: event.clientY });
    
    // 射线检测
    raycaster.setFromCamera(mouse, camera);
    
    // 获取所有可点击的对象
    const objects = [];
    vrm.scene.traverse((child) => {
        if (child.isMesh) {
            objects.push(child);
        }
    });
    
    console.log('可点击对象数量:', objects.length);
    
    const intersects = raycaster.intersectObjects(objects, true);
    
    console.log('射线检测结果:', intersects.length, '个交点');
    
    if (intersects.length > 0) {
        const intersect = intersects[0];
        const clickedObject = intersect.object;
        
        console.log('点击的对象:', clickedObject.name || '未命名对象');
        console.log('交点位置:', intersect.point.toArray());
        
        // 获取点击位置的世界坐标
        const worldPosition = intersect.point;
        
        // 尝试识别点击的部位
        const partName = identifyClickedPart(clickedObject, worldPosition);
        
        if (partName) {
            // 获取对应的提示文本
            const tipText = getPartTip(partName);
            console.log('显示部位提示:', partName, tipText);
            showSpeechBubble(tipText, clickedObject);
        } else {
            // 随机显示问候语
            const randomGreeting = defaultGreetings[Math.floor(Math.random() * defaultGreetings.length)];
            console.log('显示随机问候语:', randomGreeting);
            showSpeechBubble(randomGreeting, clickedObject);
        }
    } else {
        console.log('未检测到点击的对象');
    }
}

// 识别点击的部位 - 只分为六个区域
function identifyClickedPart(object, worldPosition) {
    if (!vrm || !vrm.scene) return null;
    
    // 获取模型的边界框
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    
    // 计算点击位置相对于模型中心的位置
    const relativePosition = worldPosition.clone().sub(center);
    
    // 根据点击位置的高度来判断部位
    const height = relativePosition.y;
    const modelHeight = size.y;
    const normalizedHeight = height / modelHeight;
    
    // 区间划分（假设模型中心为0，整体高度为1）
    // 头部: >0.35
    // 胸部: 0.18~0.35
    // 腹部: 0~0.18
    // 臀部: -0.13~0
    // 手臂: 0.05~0.35（左右x方向偏移大于0.12）
    // 腿部: <-0.13
    
    // 判断手臂（左右x方向偏移大于0.12且高度在胸部/腹部区间）
    if (Math.abs(relativePosition.x) > 0.12 * size.x && normalizedHeight > 0.05 && normalizedHeight < 0.35) {
        return 'arms';
    }
    if (normalizedHeight > 0.35) {
        return 'head';
    } else if (normalizedHeight > 0.18) {
        return 'chest';
    } else if (normalizedHeight > 0) {
        return 'belly';
    } else if (normalizedHeight > -0.13) {
        return 'hips';
    } else {
        return 'legs';
    }
}

// 获取模型高度
function getModelHeight() {
    if (!vrm || !vrm.scene) return 1;
    
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const size = box.getSize(new THREE.Vector3());
    return size.y;
}

// 获取部位提示文本
function getPartTip(partName) {
    // 首先检查自定义部位提示
    if (partTips[partName]) {
        return partTips[partName];
    }
    
    // 然后检查内置的响应文本
    if (partResponses[partName]) {
        return partResponses[partName];
    }
    
    // 默认返回问候语
    return defaultGreetings[Math.floor(Math.random() * defaultGreetings.length)];
}

// 加载部位提示配置
async function loadPartTips() {
    try {
        const config = await getConfig();
        if (config && config.model && config.model.partTips) {
            // 合并自定义部位提示
            config.model.partTips.forEach(part => {
                if (part.name && part.tip) {
                    partTips[part.name] = part.tip;
                }
            });
        }
    } catch (error) {
        console.error('加载部位提示失败:', error);
    }
}

// --- UI 功能 ---
const pinButton = document.getElementById('pin-button');
const unlockSvg = `<svg t="1750923210499" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="3678" width="200" height="200"><path d="M785.066667 416H381.866667v-121.6c0-74.666667 61.866667-134.4 138.666666-134.4 59.733333 0 113.066667 36.266667 132.266667 91.733333 6.4 17.066667 23.466667 25.6 40.533333 19.2 17.066667-6.4 25.6-23.466667 19.2-40.533333-27.733333-81.066667-104.533333-134.4-192-134.4-110.933333 0-202.666667 89.6-202.666666 198.4v121.6h-78.933334c-55.466667 0-100.266667 44.8-100.266666 100.266667v311.466666c0 55.466667 44.8 100.266667 100.266666 100.266667h546.133334c55.466667 0 100.266667-44.8 100.266666-100.266667V516.266667c0-55.466667-44.8-100.266667-100.266666-100.266667z m36.266666 411.733333c0 19.2-17.066667 36.266667-36.266666 36.266667H238.933333c-19.2 0-36.266667-17.066667-36.266666-36.266667V516.266667c0-19.2 17.066667-36.266667 36.266666-36.266667h546.133334c19.2 0 36.266667 17.066667 36.266666 36.266667v311.466666z" fill="#d81e06" p-id="3679"></path><path d="M512 544c-17.066667 0-32 14.933333-32 32v106.666667c0 17.066667 14.933333 32 32 32s32-14.933333 32-32v-106.666667c0-17.066667-14.933333-32-32-32z" fill="#d81e06" p-id="3680"></path></svg>`;
const lockSvg = `<svg t="1750923186572" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="3463" width="200" height="200"><path d="M785.066667 416h-61.866667v-121.6c0-108.8-91.733333-198.4-202.666667-198.4s-202.666667 89.6-202.666666 198.4v121.6h-78.933334c-55.466667 0-100.266667 44.8-100.266666 100.266667v311.466666c0 55.466667 44.8 100.266667 100.266666 100.266667h546.133334c55.466667 0 100.266667-44.8 100.266666-100.266667V516.266667c0-55.466667-44.8-100.266667-100.266666-100.266667z m-403.2-121.6c0-74.666667 61.866667-134.4 138.666666-134.4s138.666667 59.733333 138.666667 134.4v121.6h-277.333333v-121.6z m439.466666 533.333333c0 19.2-17.066667 36.266667-36.266666 36.266667H238.933333c-19.2 0-36.266667-17.066667-36.266666-36.266667V516.266667c0-19.2 17.066667-36.266667 36.266666-36.266667h546.133334c19.2 0 36.266667 17.066667 36.266666 36.266667v311.466666z" fill="#515151" p-id="3464"></path><path d="M512 544c-17.066667 0-32 14.933333-32 32v106.666667c0 17.066667 14.933333 32 32 32s32-14.933333 32-32v-106.666667c0-17.066667-14.933333-32-32-32z" fill="#515151" p-id="3465"></path></svg>`;

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
// 禁用右键旋转，避免与点击事件冲突
controls.enableRotate = true;
controls.enableZoom = true;

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

  applySceneSettings(config);
  
  if (config.modelPath && config.modelPath !== currentModelPath) {
    currentModelPath = config.modelPath;
    loadVRMModel(currentModelPath, () => {
        setAppAction(config.action || 'idle');
    });
  } else {
    setAppAction(config.action || 'idle');
  }
  
  // 加载部位提示配置
  await loadPartTips();
}

// --- VRM模型加载函数，支持切换 ---
function loadVRMModel(modelPath, onLoadCallback) {
  if (vrm) {
    scene.remove(vrm.scene);
    vrm = null;
    if(mixer) mixer.stopAllAction();
    mixer = null;
    animationClips = [];
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
      
      animationClips = gltf.animations;
      if (animationClips.length > 0) {
        mixer = new THREE.AnimationMixer(vrm.scene);
      }
      
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
      
      // 模型加载完成后，重新设置点击事件
      setupClickEvents();
      
      // 运行测试
      setTimeout(() => {
        testClickDetection();
      }, 1000);
      
      console.log('VRM 模型加载成功，点击事件已重新设置');

      if (onLoadCallback) {
        onLoadCallback();
      }

      // 将动画名写入config，供设置页面显示
      if(window.electronAPI && window.electronAPI.getConfig && window.electronAPI.setConfig){
          let cfg = await window.electronAPI.getConfig();
          cfg._animationNames = animationClips.map(a=>a.name);
          window.electronAPI.setConfig(cfg);
      }
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
    applySceneSettings(config);

    if (config.modelPath && config.modelPath !== currentModelPath) {
      currentModelPath = config.modelPath;
      loadVRMModel(currentModelPath, () => {
        setAppAction(config.action);
      });
    } else if (config.action && config.action !== currentAction) {
      setAppAction(config.action);
    }
    
    // 重新加载部位提示配置
    loadPartTips();
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

// --- 鼠标点击事件 ---
setupClickEvents();

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

// 测试函数：验证事件绑定和射线检测
function testClickDetection() {
    console.log('=== 开始测试点击检测 ===');
    console.log('Canvas元素:', canvas);
    console.log('VRM模型:', vrm);
    console.log('场景:', scene);
    console.log('相机:', camera);
    console.log('射线检测器:', raycaster);
    
    if (vrm && vrm.scene) {
        const objects = [];
        vrm.scene.traverse((child) => {
            if (child.isMesh) {
                objects.push(child);
                console.log('发现可点击对象:', child.name || '未命名', child);
            }
        });
        console.log('总共发现', objects.length, '个可点击对象');
    }
    
    // 测试鼠标位置计算
    const testMouse = new THREE.Vector2(0, 0);
    raycaster.setFromCamera(testMouse, camera);
    console.log('测试射线方向:', raycaster.ray.direction.toArray());
    
    console.log('=== 测试完成 ===');
}

const topmostButton = document.getElementById('topmost-button');
let isTopMost = false;
const topSvgActive = `<svg t="1750923108852" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="12557" width="200" height="200"><path d="M393.846154 64.174932l117.454119 0.399843H512.499805l117.454119-0.399843-10.395939 10.395939c-18.89262 18.89262-28.488872 44.982429-26.28973 71.472081l20.292073 250.502148c2.998829 36.68567 18.092932 72.171808 42.483405 99.661069l34.186646 38.684889-122.252245-0.899648-55.478329-0.399844h-0.99961l-55.478329 0.399844-122.452167 0.799687 34.186646-38.684888c24.390472-27.589223 39.484576-62.9754 42.483405-99.66107l20.292074-250.402187c2.199141-26.589613-7.397111-52.679422-26.289731-71.472081l-10.395939-10.395939m281.889887-64.174932h-0.199922L512.399844 0.599766h-0.799688L348.36392 0h-0.199922c-20.891839 0-39.684498 13.494729-45.582194 33.58688-4.098399 13.994533-1.899258 30.887934 17.79305 47.581414l38.584927 38.584927c5.597813 5.597813 8.39672 13.294807 7.796955 21.091761L346.464662 391.247169c-1.899258 23.190941-11.195627 45.08239-26.589613 62.475596l-61.87583 69.872706c-8.696603 9.796173-13.894572 22.291292-14.394377 35.386177-0.299883 8.996486 1.599375 18.89262 8.596642 27.28934 6.897306 8.296759 17.293245 12.894963 27.989067 12.894963h0.299882l175.931277-1.199532 55.178446 422.834831 0.399844 3.098789 0.399844-3.098789 55.178446-422.834831 175.931277 1.199532h0.299882c10.795783 0 21.191722-4.598204 27.989067-12.894963 6.897306-8.39672 8.796564-18.292854 8.596642-27.28934-0.399844-13.094885-5.697774-25.590004-14.394377-35.386177l-61.87583-69.872706c-15.393987-17.393206-24.690355-39.284654-26.589613-62.475596l-20.292074-250.402187c-0.599766-7.796954 2.199141-15.593909 7.796955-21.091761l38.584927-38.584927c19.692308-16.693479 21.891449-33.58688 17.79305-47.581414-5.997657-19.992191-24.790316-33.58688-45.682155-33.58688z" p-id="12558" fill="#d81e06"></path></svg>`;
const topSvg = `<svg t="1750922932228" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="8446" width="200" height="200"><path d="M702.725498 84.067161L822.778602 204.919953l0.099961 0.099961 0.099961 0.099961 0.699727 0.699727 0.099961 0.099961 0.099961 0.099961L944.531043 325.872706h-47.581414c-28.188989 0-54.878563 12.295197-73.071456 33.786802L629.55408 588.170246c-26.789535 31.4877-42.883249 71.472081-45.382272 112.755955l-5.397892 89.265131-340.367044-340.467006 89.265131-5.397891c41.183913-2.499024 81.268255-18.592737 112.755955-45.382273l228.510738-194.324092c21.491605-18.292854 33.786802-44.882468 33.786802-73.071456V84.067161zM690.33034 4.598204c-8.996486 0-18.092932 2.199141-26.389692 6.697384-15.294026 8.39672-27.689184 24.490433-25.19016 55.178446v65.07458c0 9.39633-4.098399 18.292854-11.295588 24.390472L398.944162 350.263178c-21.091761 17.992971-47.481453 28.588832-75.170636 30.288169l-111.25654 6.697384c-15.593909 0.899649-30.588052 6.997267-41.983601 17.693089-7.796954 7.397111-14.594299 17.293245-15.79383 30.288168-1.199531 12.795002 3.698555 25.390082 12.795002 34.486529l0.199922 0.199922 149.541585 147.542366L6.897306 1021.001171l-2.299102 2.998829 2.998828-2.299102 403.542367-310.378758 147.542366 149.541585 0.199922 0.199922c8.196798 8.196798 19.192503 12.994924 30.688012 12.994924 1.299492 0 2.598985-0.099961 3.798517-0.199922 12.894963-1.199531 22.891058-7.996876 30.288168-15.793831 10.695822-11.395549 16.79344-26.389692 17.693089-41.9836l6.697384-111.25654c1.699336-27.689184 12.295197-54.078875 30.288168-75.170637L872.659118 401.143303c6.097618-7.197189 14.994143-11.295588 24.390472-11.295587h65.07458c2.698946 0.199922 5.29793 0.299883 7.796955 0.299883 25.689965 0 39.784459-11.49551 47.381491-25.490043 11.995314-21.891449 7.497071-49.180789-10.096056-66.773917l-0.099961-0.099961-138.245998-137.346349-0.699726-0.699727L730.814526 21.591566l-0.099961-0.099961c-10.995705-10.995705-25.590004-16.893401-40.384225-16.893401z" p-id="8447" fill="#515151"></path></svg>`;

if (topmostButton) {
    const iconSpan = topmostButton.querySelector('.icon-svg');
    iconSpan.innerHTML = topSvg;
    topmostButton.addEventListener('click', () => {
        isTopMost = !isTopMost;
        if (window.electronAPI && window.electronAPI.send) {
            window.electronAPI.send('toggle-always-on-top', isTopMost);
        } else if (window.electronAPI && window.electronAPI.toggleAlwaysOnTop) {
            window.electronAPI.toggleAlwaysOnTop(isTopMost);
        } else if (window.electronAPI && window.electronAPI.invoke) {
            window.electronAPI.invoke('toggle-always-on-top', isTopMost);
        }
        // 切换按钮样式和图标
        if (isTopMost) {
            topmostButton.classList.add('active');
            topmostButton.title = '取消置顶';
            iconSpan.innerHTML = topSvgActive;
        } else {
            topmostButton.classList.remove('active');
            topmostButton.title = '窗口置顶';
            iconSpan.innerHTML = topSvg;
        }
    });
}
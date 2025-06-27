import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';

// --- 全局状态 ---
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

// --- 骨骼点击检测系统 ---
let boneClickSystem = {
    // 骨骼区域定义
    boneRegions: {
        head: {
            bones: ['head'],
            radius: 0.15,
            color: 0xff0000,
            visible: true,
            offsetY: 0.1
        },
        arms: {
            bones: ['leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand'],
            radius: 0.12,
            color: 0x00ff00,
            visible: true,
            offsetY: 0
        },
        legs: {
            bones: ['leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot'],
            radius: 0.08,
            color: 0x0000ff,
            visible: true,
            offsetY: 0
        },
        chest: {
            bones: ['chest', 'spine'],
            radius: 0.12,
            color: 0xffff00,
            visible: true,
            offsetY: 0
        },
        belly: {
            bones: ['spine'],
            radius: 0.10,
            color: 0xff00ff,
            visible: true,
            offsetY: -0.1
        },
        hips: {
            bones: ['hips'],
            radius: 0.12,
            color: 0x00ffff,
            visible: true,
            offsetY: 0
        }
    },
    init(vrm) {
        // 不再生成任何可视化标记
        if (!vrm || !vrm.humanoid) {
            return;
        }
    },
    // 检测点击的部位 - 优化版本
    detectClickedPart(worldPosition) {
        if (!vrm || !vrm.humanoid) return null;
        // 锁骨/脖子空间优先排除
        const excludeBones = [
            'neck',
            'leftShoulder', 'rightShoulder',
            'leftCollarbone', 'rightCollarbone'
        ];
        for (const boneName of excludeBones) {
            const boneNode = vrm.humanoid.getRawBoneNode(boneName);
            if (boneNode) {
                const bonePosition = new THREE.Vector3();
                boneNode.getWorldPosition(bonePosition);
                const modelScale = vrm.scene.scale.x;
                const detectionRadius = (this.boneRegions.arms?.radius || 0.12) * modelScale;
                if (worldPosition.distanceTo(bonePosition) <= detectionRadius) {
                    return null;
                }
            }
        }

        // -----------胸部自适应检测区域（仅胸部事件）-----------
        // 常见左右胸骨骼名
        const leftChestNames = ['leftUpperChest', 'leftBust', 'LeftBust', 'leftChest', 'LeftChest'];
        const rightChestNames = ['rightUpperChest', 'rightBust', 'RightBust', 'rightChest', 'RightChest'];
        let leftChestNode = null, rightChestNode = null;
        for (const name of leftChestNames) {
            leftChestNode = vrm.humanoid.getRawBoneNode(name);
            if (leftChestNode) break;
        }
        for (const name of rightChestNames) {
            rightChestNode = vrm.humanoid.getRawBoneNode(name);
            if (rightChestNode) break;
        }
        const chestRadius = 0.12 * (vrm.scene.scale.x || 1); // 可调
        const chestYOffset = 0.05 * (vrm.scene.scale.x || 1); // 上移量，可调
        if (leftChestNode && rightChestNode) {
            // 两个圆形胸部检测区
            const leftPos = new THREE.Vector3();
            const rightPos = new THREE.Vector3();
            leftChestNode.getWorldPosition(leftPos);
            rightChestNode.getWorldPosition(rightPos);
            leftPos.y += chestYOffset;
            rightPos.y += chestYOffset;
            if (worldPosition.distanceTo(leftPos) <= chestRadius || worldPosition.distanceTo(rightPos) <= chestRadius) {
                return 'chest';
            }
        } else {
            // 退化为chest中心的长方体区域
            const chestNode = vrm.humanoid.getRawBoneNode('chest');
            if (chestNode) {
                const chestPos = new THREE.Vector3();
                chestNode.getWorldPosition(chestPos);
                chestPos.y += chestYOffset;
                // 长方体参数
                const width = 0.28 * (vrm.scene.scale.x || 1); // 左右宽度
                const height = 0.18 * (vrm.scene.scale.x || 1); // 上下高度
                const depth = 0.18 * (vrm.scene.scale.x || 1); // 前后厚度
                if (
                    Math.abs(worldPosition.x - chestPos.x) <= width / 2 &&
                    Math.abs(worldPosition.y - chestPos.y) <= height / 2 &&
                    Math.abs(worldPosition.z - chestPos.z) <= depth / 2
                ) {
                    return 'chest';
                }
            }
        }
        // -----------胸部自适应检测区域结束-----------

        // -----------腹部自适应检测区域（仅腹部事件）-----------
        // 仅当未命中胸部事件时再检测腹部
        // 以chest骨骼为基准，腹部区域紧挨胸部下方
        const chestNodeForBelly = vrm.humanoid.getRawBoneNode('chest');
        if (chestNodeForBelly) {
            const chestPos = new THREE.Vector3();
            chestNodeForBelly.getWorldPosition(chestPos);
            const chestYOffset = 0.05 * (vrm.scene.scale.x || 1); // 与胸部事件一致
            chestPos.y += chestYOffset; // 胸部上移量
            const chestHeight = 0.18 * (vrm.scene.scale.x || 1); // 胸部高度
            const chestWidth = 0.28 * (vrm.scene.scale.x || 1); // 胸部宽度
            const chestDepth = 0.18 * (vrm.scene.scale.x || 1); // 胸部深度
            // 腹部参数
            const bellyHeight = 0.06 * (vrm.scene.scale.x || 1); // 腹部高度
            const bellyWidth = chestWidth;
            const bellyDepth = chestDepth;
            // 腹部中心y = 胸部中心y - (胸部高度/2) - (腹部高度/2)
            const bellyCenterY = chestPos.y - (chestHeight / 2) - (bellyHeight / 2);
            if (
                Math.abs(worldPosition.x - chestPos.x) <= bellyWidth / 2 &&
                Math.abs(worldPosition.y - bellyCenterY) <= bellyHeight / 2 &&
                Math.abs(worldPosition.z - chestPos.z) <= bellyDepth / 2
            ) {
                return 'belly';
            }
        }
        // -----------腹部自适应检测区域结束-----------

        // -----------臀部自适应检测区域（仅臀部事件）-----------
        // 仅当未命中腹部事件时再检测臀部
        // 以chest骨骼为基准，臀部区域紧挨腹部下方
        if (chestNodeForBelly) {
            const chestPos = new THREE.Vector3();
            chestNodeForBelly.getWorldPosition(chestPos);
            const chestYOffset = 0.05 * (vrm.scene.scale.x || 1); // 与胸部事件一致
            chestPos.y += chestYOffset; // 胸部上移量
            const chestHeight = 0.18 * (vrm.scene.scale.x || 1); // 胸部高度
            const chestWidth = 0.28 * (vrm.scene.scale.x || 1); // 胸部宽度
            const chestDepth = 0.18 * (vrm.scene.scale.x || 1); // 胸部深度
            // 腹部参数
            const bellyHeight = 0.14 * (vrm.scene.scale.x || 1); // 腹部高度
            // 臀部参数
            const hipsHeight = 0.13 * (vrm.scene.scale.x || 1); // 臀部高度（下边界上移，区域更窄）
            const hipsWidth = chestWidth;
            const hipsDepth = chestDepth;
            // 臀部中心y = 腹部中心y - (腹部高度/2) - (臀部高度/2)
            const bellyCenterY = chestPos.y - (chestHeight / 2) - (bellyHeight / 2);
            const hipsCenterY = bellyCenterY - (bellyHeight / 2) - (hipsHeight / 2);
            if (
                Math.abs(worldPosition.x - chestPos.x) <= hipsWidth / 2 &&
                Math.abs(worldPosition.y - hipsCenterY) <= hipsHeight / 2 &&
                Math.abs(worldPosition.z - chestPos.z) <= hipsDepth / 2
            ) {
                return 'hips';
            }
        }
        // -----------臀部自适应检测区域结束-----------

        // -----------腿部自适应检测区域（仅腿部事件）-----------
        // 仅当未命中臀部事件时再检测腿部
        // 以chest骨骼为基准，腿部区域从臀部下边界到脚部
        if (chestNodeForBelly) {
            const chestPos = new THREE.Vector3();
            chestNodeForBelly.getWorldPosition(chestPos);
            const chestYOffset = 0.05 * (vrm.scene.scale.x || 1); // 与胸部事件一致
            chestPos.y += chestYOffset; // 胸部上移量
            const chestHeight = 0.18 * (vrm.scene.scale.x || 1); // 胸部高度
            const chestWidth = 0.28 * (vrm.scene.scale.x || 1); // 胸部宽度
            const chestDepth = 0.18 * (vrm.scene.scale.x || 1); // 胸部深度
            // 腹部参数
            const bellyHeight = 0.14 * (vrm.scene.scale.x || 1); // 腹部高度
            // 臀部参数
            const hipsHeight = 0.13 * (vrm.scene.scale.x || 1); // 臀部高度
            // 腿部参数
            const legsWidth = chestWidth * 0.7; // 腿部略窄
            const legsDepth = chestDepth;
            // 计算腿部y范围
            const bellyCenterY = chestPos.y - (chestHeight / 2) - (bellyHeight / 2);
            const hipsCenterY = bellyCenterY - (bellyHeight / 2) - (hipsHeight / 2);
            const hipsBottomY = hipsCenterY - (hipsHeight / 2); // 臀部下边界
            // 获取脚部最低点
            let minFootY = null;
            const footBones = ['leftFoot', 'rightFoot'];
            footBones.forEach(boneName => {
                const boneNode = vrm.humanoid.getRawBoneNode(boneName);
                if (boneNode) {
                    const pos = new THREE.Vector3();
                    boneNode.getWorldPosition(pos);
                    if (minFootY === null || pos.y < minFootY) minFootY = pos.y;
                }
            });
            if (minFootY !== null) {
                // 腿部中心y = (臀部下边界 + 脚底) / 2
                const legsCenterY = (hipsBottomY + minFootY) / 2;
                const legsHeight = Math.abs(hipsBottomY - minFootY);
                if (
                    Math.abs(worldPosition.x - chestPos.x) <= legsWidth / 2 &&
                    Math.abs(worldPosition.y - legsCenterY) <= legsHeight / 2 &&
                    Math.abs(worldPosition.z - chestPos.z) <= legsDepth / 2
                ) {
                    return 'legs';
                }
            }
        }
        // -----------腿部自适应检测区域结束-----------

        let closestRegion = null;
        let closestDistance = Infinity;
        let closestBone = null;
        
        Object.entries(this.boneRegions).forEach(([regionName, region]) => {
            // 跳过chest区域，已自适应处理
            if(regionName === 'chest') return;
            region.bones.forEach(boneName => {
                const boneNode = vrm.humanoid.getRawBoneNode(boneName);
                if (boneNode) {
                    const bonePosition = new THREE.Vector3();
                    boneNode.getWorldPosition(bonePosition);
                    bonePosition.y += region.offsetY;
                    const distance = worldPosition.distanceTo(bonePosition);
                    const modelScale = vrm.scene.scale.x;
                    const detectionRadius = region.radius * modelScale;
                    if (distance <= detectionRadius && distance < closestDistance) {
                        closestDistance = distance;
                        closestRegion = regionName;
                        closestBone = boneName;
                    }
                }
            });
        });
        if (closestBone === 'spine') return null;
        return closestRegion;
    },
    
    // 切换区域可见性
    toggleRegionVisibility(regionName) {
        if (this.boneRegions[regionName]) {
            this.boneRegions[regionName].visible = !this.boneRegions[regionName].visible;
            if (vrm) {
                this.clearVisualMarkers();
                this.createVisualMarkers(vrm);
            }
        }
    },
    
    // 获取所有可用骨骼名称
    getAvailableBones() {
        if (!vrm || !vrm.humanoid) return [];
        
        const availableBones = [];
        vrm.humanoid.humanBones.forEach(humanBone => {
            if (humanBone.node) {
                availableBones.push(humanBone.bone);
            }
        });
        return availableBones;
    },
    
    // 显示所有区域标记
    showAllRegions() {
        Object.keys(this.boneRegions).forEach(region => {
            this.boneRegions[region].visible = true;
        });
        if (vrm) {
            this.clearVisualMarkers();
            this.createVisualMarkers(vrm);
        }
    },
    
    // 隐藏所有区域标记
    hideAllRegions() {
        Object.keys(this.boneRegions).forEach(region => {
            this.boneRegions[region].visible = false;
        });
        this.clearVisualMarkers();
    }
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
let currentUtterance = null; // 添加当前语音对象引用

function showSpeechBubble(text, clickedObject) {
    if (!speechBubble) {
        speechBubble = document.getElementById('speech-bubble');
    }
    
    // 清除之前的定时器
    if (bubbleTimeout) {
        clearTimeout(bubbleTimeout);
    }
    
    // 立即停止当前正在播放的语音
    if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
        currentUtterance = null;
    }
    
    // 立即设置气泡文本
    speechBubble.textContent = text;
    
    // 立即显示气泡（不等待DOM渲染）
    speechBubble.style.visibility = 'visible';
    speechBubble.style.opacity = '1';
    speechBubble.classList.add('visible');

    // 语音播报功能 - 立即播放新语音
    (async () => {
        const config = await getConfig();
        if (config?.model?.bubbleTTS && window.speechSynthesis) {
            // 确保停止之前的语音
            window.speechSynthesis.cancel();
            
            const utter = new window.SpeechSynthesisUtterance(text);
            currentUtterance = utter;
            
            // 语音类型
            if(config.model.bubbleTTSVoice) {
                const voices = window.speechSynthesis.getVoices();
                const v = voices.find(v=>v.voiceURI===config.model.bubbleTTSVoice);
                if(v) utter.voice = v;
            }
            // 语速
            utter.rate = config.model.bubbleTTSRate || 1;
            // 音量
            utter.volume = config.model.bubbleTTSVolume || 1;
            // 自动选择语言（如未指定语音类型）
            if (!utter.voice) {
                if (/[\u0000-\u007f]/.test(text) && !/[\u4e00-\u9fa5]/.test(text)) {
                    utter.lang = 'en-US';
                } else {
                    utter.lang = 'zh-CN';
                }
            }
            
            // 立即播放新语音
            window.speechSynthesis.speak(utter);
        }
    })();
    
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
    speechBubble.style.visibility = 'visible';
    speechBubble.style.opacity = '1';
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
    
    // 3秒后自动隐藏
    bubbleTimeout = setTimeout(() => {
        speechBubble.classList.remove('visible');
        speechBubble.style.visibility = 'hidden';
        speechBubble.style.opacity = '0';
        // 停止语音
        if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
            currentUtterance = null;
        }
    }, 3000);
}

// 获取模型头部位置 - 改进版本
function getHeadPosition() {
    if (!vrm || !vrm.scene) {
        // 如果没有VRM，返回模型中心位置
        return new THREE.Vector3(0, 0, 0);
    }
    
    // 尝试获取VRM的头部骨骼
    if (vrm.humanoid && vrm.humanoid.getRawBoneNode('head')) {
        const headBone = vrm.humanoid.getRawBoneNode('head');
        const headPosition = new THREE.Vector3();
        headBone.getWorldPosition(headPosition);
        return headPosition;
    }
    
    // 如果没有头部骨骼，计算模型顶部位置
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    
    // 返回模型顶部位置（头部位置）
    return new THREE.Vector3(center.x, center.y + size.y * 0.5, center.z);
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
}

// 修改点击事件处理函数
async function onMouseClick(event) {
    // 只响应左键
    if (event.button !== 0) return;
    
    // 判断是否允许弹出气泡
    const config = await getConfig();
    if (!config?.model?.allowBubble) {
        return;
    }
    
    if (isFixed) {
        return;
    }
    
    if (!vrm || !vrm.scene) {
        return;
    }
    
    // 阻止事件冒泡，避免与OrbitControls冲突
    event.preventDefault();
    event.stopPropagation();
    
    // 计算鼠标位置
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // 射线检测
    raycaster.setFromCamera(mouse, camera);
    
    // 获取所有可点击的对象
    const objects = [];
    vrm.scene.traverse((child) => {
        if (child.isMesh) {
            objects.push(child);
        }
    });
    
    const intersects = raycaster.intersectObjects(objects, true);
    
    if (intersects.length > 0) {
        const intersect = intersects[0];
        const clickedObject = intersect.object;
        // 获取点击位置的世界坐标
        const worldPosition = intersect.point;
        
        // 使用优化后的骨骼检测系统识别点击的部位
        const partName = boneClickSystem.detectClickedPart(worldPosition);
        
        if (partName) {
            // 获取对应的提示文本
            const tipText = getPartTip(partName);
            showSpeechBubble(tipText, clickedObject);
        } else {
            // 随机显示问候语
            const randomGreeting = defaultGreetings[Math.floor(Math.random() * defaultGreetings.length)];
            showSpeechBubble(randomGreeting, clickedObject);
        }
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
    // 只检查自定义部位提示
    if (partTips[partName]) {
        return partTips[partName];
    }
    // 没有事件或没有对应响应时，不展示任何内容
    return '';
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
      
      // 初始化骨骼点击检测系统
      boneClickSystem.init(vrm);
      
      if (onLoadCallback) {
        onLoadCallback();
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
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import MicrosoftTTS from './microsoft-tts.js';

// --- 全局状态 ---
let isFixed = false;
let currentAction = 'idle';
let randomAnimationInterval = null;
let animationClips = [];
let lastSavedState = null; // 记录上次保存的状态
let globalConfig = null; // 全局配置变量

// --- TTS相关全局变量 ---
let microsoftTTS = new MicrosoftTTS();
let currentAudio = null; // 当前播放的音频对象

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
    // 初始化骨骼检测系统（目前无可视化标记）
    init(vrm) {
        if (!vrm || !vrm.humanoid) return;
    },
    // 通用检测区域辅助函数
    _inBox(worldPosition, center, size) {
        return (
            Math.abs(worldPosition.x - center.x) <= size.x / 2 &&
            Math.abs(worldPosition.y - center.y) <= size.y / 2 &&
            Math.abs(worldPosition.z - center.z) <= size.z / 2
        );
    },
    // 检测点击的部位（优化：抽象重复区域检测）
    detectClickedPart(worldPosition) {
        if (!vrm || !vrm.humanoid) return null;
        // 锁骨/脖子空间优先排除
        const excludeBones = [
            'neck', 'leftShoulder', 'rightShoulder', 'leftCollarbone', 'rightCollarbone'
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
        // 检测胸部、腹部、臀部、腿部区域
        const chestNode = vrm.humanoid.getRawBoneNode('chest');
        if (chestNode) {
            const scale = vrm.scene.scale.x || 1;
            const chestPos = new THREE.Vector3();
            chestNode.getWorldPosition(chestPos);
            chestPos.y += 0.05 * scale; // 上移
            // 检查胸部
            const chestSize = new THREE.Vector3(0.28 * scale, 0.18 * scale, 0.18 * scale);
            if (this._inBox(worldPosition, chestPos, chestSize)) return 'chest';
            // 检查腹部
            const bellyHeight = 0.06 * scale;
            const bellyCenterY = chestPos.y - (chestSize.y / 2) - (bellyHeight / 2);
            if (this._inBox(worldPosition, new THREE.Vector3(chestPos.x, bellyCenterY, chestPos.z), new THREE.Vector3(chestSize.x, bellyHeight, chestSize.z))) return 'belly';
            // 检查臀部
            const hipsHeight = 0.13 * scale;
            const hipsCenterY = bellyCenterY - (bellyHeight / 2) - (hipsHeight / 2);
            if (this._inBox(worldPosition, new THREE.Vector3(chestPos.x, hipsCenterY, chestPos.z), new THREE.Vector3(chestSize.x, hipsHeight, chestSize.z))) return 'hips';
            // 检查腿部
            let minFootY = null;
            ['leftFoot', 'rightFoot'].forEach(boneName => {
                const boneNode = vrm.humanoid.getRawBoneNode(boneName);
                if (boneNode) {
                    const pos = new THREE.Vector3();
                    boneNode.getWorldPosition(pos);
                    if (minFootY === null || pos.y < minFootY) minFootY = pos.y;
                }
            });
            if (minFootY !== null) {
                const hipsBottomY = hipsCenterY - (hipsHeight / 2);
                const legsCenterY = (hipsBottomY + minFootY) / 2;
                const legsHeight = Math.abs(hipsBottomY - minFootY);
                const legsWidth = chestSize.x * 0.7;
                if (this._inBox(worldPosition, new THREE.Vector3(chestPos.x, legsCenterY, chestPos.z), new THREE.Vector3(legsWidth, legsHeight, chestSize.z))) return 'legs';
            }
        }
        // 其它部位（头、手臂）
        let closestRegion = null;
        let closestDistance = Infinity;
        let closestBone = null;
        Object.entries(this.boneRegions).forEach(([regionName, region]) => {
            if(regionName === 'chest') return; // 已处理
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
}, 300);

// 立即保存模型状态（不使用防抖）
const saveModelStateImmediate = async (state) => {
    if (window.electronAPI && window.electronAPI.saveModelState) {
        await window.electronAPI.saveModelState(state);
    }
};

// 获取模型状态
async function getModelState() {
    if (window.electronAPI && window.electronAPI.getModelState) {
        const state = await window.electronAPI.getModelState();
        return state;
    }
    return null;
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

function showSpeechBubble(text, clickedObject) {
    if (!speechBubble) {
        speechBubble = document.getElementById('speech-bubble');
    }
    
    // 清除之前的定时器
    if (bubbleTimeout) {
        clearTimeout(bubbleTimeout);
    }
    
    // 立即停止当前正在播放的语音
    stopCurrentAudio();
    
    // 立即设置气泡文本
    speechBubble.textContent = text;
    
    // 立即显示气泡（不等待DOM渲染）
    speechBubble.style.visibility = 'visible';
    speechBubble.style.opacity = '1';
    speechBubble.classList.add('visible');

    // 语音播报功能 - 使用微软TTS
    (async () => {
        const config = await getConfig();
        
        if (config?.model?.bubbleTTS) {
            try {
                // 获取TTS配置
                const voice = config.model.bubbleTTSVoice || 'zh-CN-XiaoxiaoNeural';
                const speed = config.model.bubbleTTSRate || 1.0;
                
                // 判断是否为微软TTS语音
                const isMicrosoftVoice = voice.includes('Neural');
                
                if (isMicrosoftVoice) {
                    // 使用微软TTS生成语音
                    const audioBlob = await microsoftTTS.textToSpeech(text, {
                        voice: voice,
                        speed: speed,
                        pitch: 1.0,
                        volume: '+0%' // 使用默认音量
                    });
                    
                    // 播放音频
                    playAudio(audioBlob);
                } else {
                    // 使用浏览器语音合成
                    fallbackToBrowserTTS(text, config);
                }
            } catch (error) {
                console.error('微软TTS播放失败:', error);
                // 如果微软TTS失败，回退到浏览器语音合成
                fallbackToBrowserTTS(text, config);
            }
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
        stopCurrentAudio();
    }, 3000);
}

// 播放音频的辅助函数
function playAudio(audioBlob) {
    // 停止当前播放的音频
    stopCurrentAudio();
    
    // 创建新的音频对象
    const audioUrl = URL.createObjectURL(audioBlob);
    currentAudio = new Audio(audioUrl);
    
    // 音频播放完成后的清理
    currentAudio.onended = () => {
        stopCurrentAudio();
    };
    
    // 音频播放错误处理
    currentAudio.onerror = (error) => {
        console.error('音频播放错误:', error);
        stopCurrentAudio();
    };
    
    // 开始播放
    currentAudio.play().catch(error => {
        console.error('音频播放失败:', error);
        stopCurrentAudio();
    });
}

// 停止当前音频播放
function stopCurrentAudio() {
    // 停止微软TTS音频
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        URL.revokeObjectURL(currentAudio.src);
        currentAudio = null;
    }
    
    // 停止浏览器语音合成
    if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
}

// 回退到浏览器语音合成
function fallbackToBrowserTTS(text, config) {
    if (window.speechSynthesis) {
        // 确保停止之前的语音
        window.speechSynthesis.cancel();
        
        const utter = new window.SpeechSynthesisUtterance(text);
        
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

// 部位与表情的映射（支持多个表情混合）
const partToExpression = {
    head: [
        { name: 'happy', weight: 0.7 },
        { name: 'surprised', weight: 0.3 }
    ],
    chest: [
        { name: 'angry', weight: 1.0 }
    ],
    belly: [
        { name: 'surprised', weight: 0.8 },
        { name: 'sad', weight: 0.2 }
    ],
    hips: [
        { name: 'sad', weight: 1.0 }
    ],
    arms: [
        { name: 'aa', weight: 1.0 }
    ],
    legs: [
        { name: 'oh', weight: 1.0 }
    ]
};

// --- 表情平滑过渡状态变量（支持多个表情） ---
let currentExpressions = {}; // { 表情名: 当前权重 }
let targetExpressions = {};  // { 表情名: 目标权重 }
let expressionTransitionSpeed = 0.08;

// 平滑切换表情（支持多个表情混合）
function setVrmExpressionSmooth(expressionArray) {
    if (!vrm || !vrm.expressionManager) return;
    // expressionArray: [{name, weight}, ...]
    // 构建目标表情集
    targetExpressions = {};
    if (Array.isArray(expressionArray)) {
        expressionArray.forEach(item => {
            if (item && item.name) {
                targetExpressions[item.name] = item.weight;
            }
        });
    }
    // 保证所有当前表情都在 currentExpressions 里
    Object.keys(targetExpressions).forEach(name => {
        if (!(name in currentExpressions)) {
            currentExpressions[name] = 0;
        }
    });
    // 旧的表情如果不在目标里，也要插值到0
    Object.keys(currentExpressions).forEach(name => {
        if (!(name in targetExpressions)) {
            targetExpressions[name] = 0;
        }
    });
}

// 修改点击事件处理函数
async function onMouseClick(event) {
    // 只响应左键
    if (event.button !== 0) return;
    
    // 检查是否固定状态
    if (isFixed) {
        return;
    }
    
    if (!vrm || !vrm.scene) {
        return;
    }
    
    // 获取配置并检查是否允许气泡
    const config = await getConfig();
    if (config?.model?.allowBubble === false) {
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
        const worldPosition = intersect.point;
        const partName = boneClickSystem.detectClickedPart(worldPosition);
        
        if (partName) {
            console.log('检测到部位点击:', partName);
            
            // 1. 平滑切换表情（支持多个表情混合）
            const expressionArray = partToExpression[partName];
            if (expressionArray) {
                setVrmExpressionSmooth(expressionArray);
            }

            // 2. 显示气泡
            const tipText = await getPartTip(partName);
            console.log('获取到的提示文本:', tipText);
            if (tipText) {
                console.log('显示气泡:', tipText);
                showSpeechBubble(tipText, clickedObject);
            } else {
                console.log('提示文本为空，不显示气泡');
            }
        }
    }
}

// 获取部位提示文本
async function getPartTip(partName) {
    // 只读取 config.model.partTips
    if (globalConfig && globalConfig.model && Array.isArray(globalConfig.model.partTips)) {
        const partTip = globalConfig.model.partTips.find(p => p.name === partName);
        if (partTip && partTip.tip) {
            return partTip.tip;
        }
    }
    
    // 如果 config.model.partTips 为空，尝试从 options 中读取默认提示
    try {
        const options = await window.electronAPI.getOptions();
        if (options && options.partTips) {
            const defaultPart = options.partTips.find(p => p.name === partName);
            if (defaultPart && defaultPart.content) {
                return defaultPart.content;
            }
        }
    } catch (error) {
        console.error('读取 options 失败:', error);
    }
    
    // 没有自定义提示内容时，不显示任何内容
    return '';
}

// 加载部位提示配置
async function loadPartTips() {
    try {
        const config = await getConfig();
        if (config) {
            globalConfig = config; // 更新全局配置
        }
    } catch (error) {
        console.error('加载部位提示配置失败:', error);
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

  // 更新全局配置
  globalConfig = config;

  // 确保配置包含必要的模型设置
  if (!config.model) {
    // 保存当前的modelState（如果存在）
    const savedModelState = config.modelState;
    config.model = {
      allowBubble: true,
      bubbleTTS: true,
      bubbleTTSVoice: "zh-CN-XiaoxiaoNeural",
      bubbleTTSRate: 1.0,
      bubbleTTSVolume: 1.0
    };
    // 恢复保存的modelState
    if (savedModelState) {
      config.modelState = savedModelState;
    }
    // 保存修复后的配置
    if (window.electronAPI && window.electronAPI.setConfig) {
      window.electronAPI.setConfig(config);
    }
    // 更新全局配置
    globalConfig = config;
  }

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
      if (savedState && savedState.cameraPosition && Array.isArray(savedState.cameraPosition) && savedState.cameraPosition.length === 3) {
        // 应用相机状态
        camera.position.set(...savedState.cameraPosition);
        camera.fov = savedState.cameraFov || 30;
        camera.updateProjectionMatrix();
        
        // 应用控制器状态
        if (savedState.cameraTarget && Array.isArray(savedState.cameraTarget) && savedState.cameraTarget.length === 3) {
          controls.target.set(...savedState.cameraTarget);
        } else {
          controls.target.set(0, 0, 0);
        }
        controls.update();
        
        // 应用缩放
        if (savedState.scale && typeof savedState.scale === 'number' && savedState.scale > 0) {
          vrm.scene.scale.setScalar(savedState.scale);
        }
        
        // 应用固定状态
        isFixed = savedState.isFixed || false;
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
      
      // 初始化lastSavedState，确保状态比较逻辑正常工作
      lastSavedState = {
        scale: vrm.scene.scale.x,
        cameraPosition: camera.position.toArray(),
        cameraTarget: controls.target.toArray(),
        cameraFov: camera.fov,
        isFixed: isFixed
      };
      
      if (onLoadCallback) {
        onLoadCallback();
      }
    },
    (progress) => {
      // 可以在这里添加加载进度显示
    },
    (error) => {
      // 使用更友好的错误提示，而不是弹框
      showSpeechBubble('模型加载失败，请检查文件路径是否正确', null);
      
      // 尝试加载默认模型
      if (modelPath !== '../../assets/default.vrm') {
        loadVRMModel('../../assets/default.vrm', onLoadCallback);
      }
    }
  );
}

// --- 启动时加载配置模型 ---
loadModelFromConfig();

// --- 监听配置变更，实时切换模型 ---
if (window.electronAPI && window.electronAPI.onConfigUpdated) {
  window.electronAPI.onConfigUpdated((config) => {
    console.log('配置更新事件触发:', config);
    
    // 更新全局配置
    globalConfig = config;
    console.log('更新后的 globalConfig:', globalConfig);
    
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

  // 保存控制器变化后的状态（仅在状态发生变化且用户正在交互时）
  if (vrm && vrm.scene && controls.enabled && controls.enableDamping) {
    const currentState = {
      scale: vrm.scene.scale.x,
      cameraPosition: camera.position.toArray(),
      cameraTarget: controls.target.toArray(),
      cameraFov: camera.fov,
      isFixed: isFixed
    };
    
    // 检查状态是否发生变化
    const stateChanged = !lastSavedState || 
      lastSavedState.scale !== currentState.scale ||
      lastSavedState.cameraFov !== currentState.cameraFov ||
      lastSavedState.isFixed !== currentState.isFixed ||
      !lastSavedState.cameraPosition.every((val, i) => Math.abs(val - currentState.cameraPosition[i]) < 0.01) ||
      !lastSavedState.cameraTarget.every((val, i) => Math.abs(val - currentState.cameraTarget[i]) < 0.01);
    
    if (stateChanged) {
      lastSavedState = currentState;
      saveModelState(currentState);
    }
  }

  if (vrm) {
    vrm.update(delta);
  }
  if (mixer) {
    mixer.update(delta);
  }

  // --- 表情平滑过渡（支持多个表情混合） ---
  if (vrm && vrm.expressionManager) {
      Object.keys(targetExpressions).forEach(name => {
          let cur = currentExpressions[name] || 0;
          let tgt = targetExpressions[name] || 0;
          if (Math.abs(cur - tgt) < 0.01) {
              cur = tgt;
          } else if (cur < tgt) {
              cur += expressionTransitionSpeed;
              if (cur > tgt) cur = tgt;
          } else if (cur > tgt) {
              cur -= expressionTransitionSpeed;
              if (cur < tgt) cur = tgt;
          }
          currentExpressions[name] = cur;
          vrm.expressionManager.setValue(name, cur);
      });
      vrm.expressionManager.update();
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
        lastSavedState = newState;
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
        lastSavedState = newState;
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
        saveModelStateImmediate(finalState);
    }
});


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
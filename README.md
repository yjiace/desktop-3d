# 桌面3D看板娘

一个基于Electron和Three.js的桌面3D看板娘应用。

## 功能特性

### 新增状态保存功能

应用现在支持实时保存和恢复以下状态：

#### 窗口状态
- 窗口位置 (x, y)
- 窗口大小 (width, height)
- 自动保存，无需手动操作

#### 3D模型状态
- 模型缩放 (scale)
- 相机位置 (cameraPosition)
- 相机目标点 (cameraTarget)
- 相机视野角度 (cameraFov)
- 固定状态 (isFixed)

**注意**: 为了保持原有的缩放中心逻辑，模型的位置和旋转不直接保存，而是通过相机和控制器状态来体现，确保缩放始终以模型的几何中心为基准。

### 状态保存机制

1. **实时保存**: 当用户操作3D模型（旋转、缩放、移动）时，状态会自动保存
2. **防抖机制**: 使用500ms防抖，避免频繁保存
3. **启动恢复**: 程序启动时自动恢复上次的状态
4. **退出保存**: 程序退出时强制保存当前状态
5. **保持原有逻辑**: 不修改原有的缩放中心，确保用户体验一致性

### 配置文件

状态保存在 `config.json` 文件中，包含以下结构：

```json
{
  "modelPath": "../../assets/default.vrm",
  "action": "idle",
  "appearance": {
    "scale": 1.0,
    "background": "transparent"
  },
  "modelState": {
    "scale": 1.0,
    "cameraPosition": [0, 0, 3],
    "cameraTarget": [0, 0, 0],
    "cameraFov": 30,
    "isFixed": false
  }
}
```

## 安装和运行

```bash
npm install
npm start
```

## 使用说明

1. 启动应用后，3D模型会自动加载并恢复到上次的状态
2. 使用鼠标拖拽可以旋转模型视角
3. 使用鼠标滚轮可以缩放模型（缩放中心始终为模型几何中心）
4. 点击锁定按钮可以固定窗口位置
5. 所有操作都会自动保存，下次启动时恢复
6. 缩放行为与原始版本完全一致

## 故障排除

### 如果缩放中心出现问题

如果发现缩放中心不在模型中心，可能是缓存状态导致的。可以运行以下命令清除缓存：

```bash
node clear-cache.js
```

然后重新启动应用，将使用默认设置。

## 技术栈

- Electron
- Three.js
- @pixiv/three-vrm
- electron-store (状态持久化) 
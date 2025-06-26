// 清除缓存状态脚本
import Store from 'electron-store';

console.log('正在清除缓存状态...');

try {
    const store = new Store();
    
    // 清除所有配置
    store.clear();
    
    console.log('✅ 缓存状态已清除');
    console.log('现在可以重新启动应用，将使用默认设置');
    
} catch (error) {
    console.error('❌ 清除缓存失败:', error);
} 
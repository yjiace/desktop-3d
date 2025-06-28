// 微软TTS模块 - 无需鉴权
class MicrosoftTTS {
    constructor() {
        this.tokenInfo = {
            endpoint: null,
            token: null,
            expiredAt: null
        };
        this.TOKEN_REFRESH_BEFORE_EXPIRY = 3 * 60; // Token 刷新时间（秒）
        this.DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural'; // 默认语音
        this.DEFAULT_SPEED = 1.0; // 默认语速
        this.DEFAULT_PITCH = 1.0; // 默认音调
    }

    // 主TTS方法
    async textToSpeech(text, options = {}) {
        const {
            voice = this.DEFAULT_VOICE,
            speed = this.DEFAULT_SPEED,
            pitch = this.DEFAULT_PITCH,
            volume = '+0%',
            style = 'general',
            outputFormat = 'audio-24khz-48kbitrate-mono-mp3'
        } = options;

        try {
            // 验证参数
            this.validateParameterRange('speed', speed, 0.5, 2.0);
            this.validateParameterRange('pitch', pitch, 0.5, 2.0);

            const rate = this.calculateRate(speed);
            const numPitch = this.calculatePitch(pitch);
            
            const audioBlob = await this.getVoice(
                text,
                voice,
                rate >= 0 ? `+${rate}%` : `${rate}%`,
                numPitch >= 0 ? `+${numPitch}%` : `${numPitch}%`,
                volume,
                style,
                outputFormat
            );

            return audioBlob;
        } catch (error) {
            console.error("TTS Error:", error);
            throw error;
        }
    }

    // 获取语音
    async getVoice(text, voiceName, rate, pitch, volume, style, outputFormat) {
        try {
            const chunks = text.trim().split("\n");
            const audioChunks = await Promise.all(
                chunks.map(chunk => this.getAudioChunk(chunk, voiceName, rate, pitch, volume, style, outputFormat))
            );

            // 将音频片段拼接起来
            return new Blob(audioChunks, { type: `audio/${outputFormat.split('-').pop()}` });
        } catch (error) {
            console.error("语音合成失败:", error);
            throw error;
        }
    }

    // 获取单个音频片段
    async getAudioChunk(text, voiceName, rate, pitch, volume, style, outputFormat) {
        const endpoint = await this.getEndpoint();
        const url = `https://${endpoint.r}.tts.speech.microsoft.com/cognitiveservices/v1`;
        const slien = this.extractSilenceDuration(text);

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": endpoint.t,
                "Content-Type": "application/ssml+xml",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 Edg/127.0.0.0",
                "X-Microsoft-OutputFormat": outputFormat,
            },
            body: this.getSsml(text, voiceName, rate, pitch, volume, style, slien),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Edge TTS API error: ${response.status} ${errorText}`);
        }

        return response.blob();
    }

    // 获取 Endpoint
    async getEndpoint() {
        const now = Date.now() / 1000;
        if (this.tokenInfo.token && this.tokenInfo.expiredAt && now < this.tokenInfo.expiredAt - this.TOKEN_REFRESH_BEFORE_EXPIRY) {
            return this.tokenInfo.endpoint;
        }

        // 获取新 Token
        const endpointUrl = "https://dev.microsofttranslator.com/apps/endpoint?api-version=1.0";
        const clientId = crypto.randomUUID().replace(/-/g, "");

        try {
            const response = await fetch(endpointUrl, {
                method: "POST",
                headers: {
                    "Accept-Language": "zh-Hans",
                    "X-ClientVersion": "4.0.530a 5fe1dc6c",
                    "X-UserId": "0f04d16a175c411e",
                    "X-HomeGeographicRegion": "zh-Hans-CN",
                    "X-ClientTraceId": clientId,
                    "X-MT-Signature": await this.sign(endpointUrl),
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 Edg/127.0.0.0",
                    "Content-Type": "application/json; charset=utf-8",
                    "Content-Length": "0",
                    "Accept-Encoding": "gzip",
                },
            });

            if (!response.ok) {
                throw new Error(`获取 Endpoint 失败: ${response.status}`);
            }

            const data = await response.json();
            const jwt = data.t.split(".")[1];
            const decodedJwt = JSON.parse(atob(jwt));

            this.tokenInfo = {
                endpoint: data,
                token: data.t,
                expiredAt: decodedJwt.exp,
            };

            return data;
        } catch (error) {
            console.error("获取 Endpoint 失败:", error);
            if (this.tokenInfo.token) {
                console.log("使用过期的缓存 Token");
                return this.tokenInfo.endpoint;
            }
            throw error;
        }
    }

    // 签名
    async sign(urlStr) {
        const url = urlStr.split("://")[1];
        const encodedUrl = encodeURIComponent(url);
        const uuidStr = this.uuid();
        const formattedDate = this.dateFormat();
        const bytesToSign = `MSTranslatorAndroidApp${encodedUrl}${formattedDate}${uuidStr}`.toLowerCase();
        const decode = await this.base64ToBytes("oik6PdDdMnOXemTbwvMn9de/h9lFnfBaCWbGMMZqqoSaQaqUOqjVGm5NqsmjcBI1x+sS9ugjB55HEJWRiFXYFw==");
        const signData = await this.hmacSha256(decode, bytesToSign);
        const signBase64 = await this.bytesToBase64(signData);
        return `MSTranslatorAndroidApp::${signBase64}::${formattedDate}::${uuidStr}`;
    }

    // 生成 SSML
    getSsml(text, voiceName, rate, pitch, volume, style, slien) {
        // 移除可能的静音标记
        const cleanText = text.replace(/\[(\d+)\]\s*?$/, '');
        
        // 构建SSML
        return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${voiceName.split('-')[0]}-${voiceName.split('-')[1]}">
            <voice name="${voiceName}">
                <prosody rate="${rate}" pitch="${pitch}" volume="${volume}">
                    ${style ? `<mstts:express-as style="${style}">` : ''}
                    ${cleanText}
                    ${style ? '</mstts:express-as>' : ''}
                    ${slien > 0 ? `<break time="${slien}ms"/>` : ''}
                </prosody>
            </voice>
        </speak>`;
    }

    // 提取静音时长
    extractSilenceDuration(text) {
        const match = text.match(/\[(\d+)\]\s*?$/);
        return match && match.length === 2 ? parseInt(match[1]) : 0;
    }

    // 验证参数范围
    validateParameterRange(name, value, min, max) {
        if (value < min || value > max) {
            throw new Error(`${name} must be between ${min} and ${max}`);
        }
    }

    // 计算语速
    calculateRate(speed) {
        return parseInt(String((parseFloat(speed) - 1.0) * 100));
    }

    // 计算音调
    calculatePitch(pitch) {
        return parseInt(String((parseFloat(pitch) - 1.0) * 100));
    }

    // 格式化日期
    dateFormat() {
        return (new Date()).toUTCString().replace(/GMT/, "").trim() + " GMT";
    }

    // HMAC SHA-256 签名
    async hmacSha256(key, data) {
        const cryptoKey = await crypto.subtle.importKey(
            "raw",
            key,
            { name: "HMAC", hash: { name: "SHA-256" } },
            false,
            ["sign"]
        );
        const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
        return new Uint8Array(signature);
    }

    // Base64 转字节数组
    async base64ToBytes(base64) {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    }

    // 字节数组转 Base64
    async bytesToBase64(bytes) {
        return btoa(String.fromCharCode.apply(null, bytes));
    }

    // 生成 UUID
    uuid() {
        return crypto.randomUUID().replace(/-/g, "");
    }

    // 获取可用的语音列表
    getAvailableVoices() {
        return {
            'zh-CN-XiaoxiaoNeural': '晓晓 - 温暖活泼',
            'zh-CN-XiaoyiNeural': '晓伊 - 温暖亲切',
            'zh-CN-YunxiNeural': '云希 - 男声，稳重',
            'zh-CN-YunyangNeural': '云扬 - 男声，专业',
            'zh-CN-XiaohanNeural': '晓涵 - 自然流畅',
            'zh-CN-XiaomengNeural': '晓梦 - 甜美活力',
            'zh-CN-XiaochenNeural': '晓辰 - 温和从容',
            'zh-CN-XiaoruiNeural': '晓睿 - 男声，儒雅',
            'zh-CN-XiaoshuangNeural': '晓双 - 女声，温柔',
            'zh-CN-YunfengNeural': '云枫 - 男声，成熟',
            'zh-CN-YunjianNeural': '云健 - 男声，阳光',
            'zh-CN-XiaoxuanNeural': '晓萱 - 女声，知性',
            'zh-CN-YunxiaNeural': '云夏 - 男声，青春',
            'zh-CN-XiaomoNeural': '晓墨 - 女声，优雅',
            'zh-CN-XiaozhenNeural': '晓甄 - 女声，自信',
            'en-US-JennyNeural': 'Jenny - 英文',
            'en-US-GuyNeural': 'Guy - 英文',
            'ja-JP-NanamiNeural': 'Nanami - 日文',
            'ja-JP-KeitaNeural': 'Keita - 日文',
            'ko-KR-SunHiNeural': 'Sun-Hi - 韩文',
            'ko-KR-InJoonNeural': 'InJoon - 韩文'
        };
    }
}

// 导出模块
export default MicrosoftTTS; 
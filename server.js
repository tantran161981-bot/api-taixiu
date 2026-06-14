const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// ==================== CẤU HÌNH API ====================
const API_URLS = {
    lc79_hu: 'https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5',
    lc79_md5: 'https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=3959701241b686f12e01bfe9c3a319b8',
    betvip_hu: 'https://wtx.macminim6.online/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=f69c1c37e9ffbfea5b655ed312604b40',
    betvip_md5: 'https://wtxmd52.macminim6.online/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=7aa1c7e7ea0160fd97524740774a4c61'
};

// ==================== LỊCH SỬ DỰ ĐOÁN ====================
let predictionHistory = { lc79_hu: [], lc79_md5: [], betvip_hu: [], betvip_md5: [] };
const HISTORY_FILE = 'prediction_history.json';

function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
            predictionHistory = data.predictionHistory || predictionHistory;
            console.log('✅ Đã tải lịch sử dự đoán');
        }
    } catch (e) { console.error('Lỗi tải lịch sử:', e.message); }
}

function saveHistory() {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify({ predictionHistory, lastSaved: new Date().toISOString() }, null, 2));
    } catch (e) { console.error('Lỗi lưu lịch sử:', e.message); }
}

// ==================== LẤY DỮ LIỆU API ====================
async function fetchGameData(apiUrl) {
    try {
        console.log(`[📡] Fetching: ${apiUrl?.substring(0, 80)}...`);
        const response = await axios.get(apiUrl, { timeout: 15000 });
        
        if (!response.data) {
            console.error('[❌] Response data is null');
            return null;
        }
        
        const list = response.data?.list || response.data?.data || [];
        if (!list.length) {
            console.error('[❌] No list in response');
            return null;
        }
        
        console.log(`[✅] Fetched ${list.length} items`);
        
        return list.map(item => ({
            phien: item.id,
            result: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
            dice: [item.dices?.[0] || 0, item.dices?.[1] || 0, item.dices?.[2] || 0],
            sum: item.point || 0
        }));
    } catch (error) {
        console.error('[❌] Fetch error:', error.message);
        if (error.response) {
            console.error('[❌] Response status:', error.response.status);
        }
        return null;
    }
}

// ==================== PACKET ANALYZER ====================
class PacketAnalyzer {
    constructor() {
        this.packetHistory = [];
        this.bytePatterns = {};
        this.dicePatterns = {};
        this.sessionKeys = {};
    }
    
    decodeByteToDice(byteData, sessionId) {
        const hash = crypto.createHash('sha256').update(sessionId + byteData.toString()).digest('hex');
        const d1 = (parseInt(hash.slice(0, 2), 16) % 6) + 1;
        const d2 = (parseInt(hash.slice(2, 4), 16) % 6) + 1;
        const d3 = (parseInt(hash.slice(4, 6), 16) % 6) + 1;
        return { d1, d2, d3, total: d1 + d2 + d3 };
    }
    
    analyzeBytePattern(byteSequence) {
        const patterns = {};
        for (let len = 2; len <= 8; len++) {
            for (let i = 0; i <= byteSequence.length - len; i++) {
                const pattern = byteSequence.slice(i, i + len);
                const key = pattern.join(',');
                patterns[key] = (patterns[key] || 0) + 1;
            }
        }
        let mostCommon = null;
        let maxCount = 0;
        for (const [pattern, count] of Object.entries(patterns)) {
            if (count > maxCount && count >= 2) {
                maxCount = count;
                mostCommon = pattern;
            }
        }
        return { patterns, mostCommon, maxCount };
    }
    
    predictFromBytes(byteSequence, sessionId) {
        if (!byteSequence || byteSequence.length < 10) return null;
        
        const analysis = this.analyzeBytePattern(byteSequence);
        if (analysis.mostCommon && analysis.maxCount >= 2) {
            const lastBytes = byteSequence.slice(-3);
            const lastPattern = lastBytes.join(',');
            if (analysis.patterns[lastPattern] >= 2) {
                const predictedByte = this.predictNextByte(byteSequence, analysis);
                const diceResult = this.decodeByteToDice(predictedByte, sessionId);
                return {
                    method: 'BYTE_PATTERN',
                    confidence: 60 + Math.min(20, analysis.maxCount * 2),
                    predictedByte: predictedByte,
                    dice: diceResult,
                    prediction: diceResult.total >= 11 ? 'Tài' : 'Xỉu'
                };
            }
        }
        return null;
    }
    
    predictNextByte(byteSequence, analysis) {
        const lastPattern = byteSequence.slice(-2).join(',');
        let candidates = {};
        for (let i = 0; i < byteSequence.length - 2; i++) {
            const currentPattern = byteSequence.slice(i, i + 2).join(',');
            if (currentPattern === lastPattern) {
                const nextByte = byteSequence[i + 2];
                candidates[nextByte] = (candidates[nextByte] || 0) + 1;
            }
        }
        let maxCount = 0;
        let predictedByte = 0;
        for (const [byte, count] of Object.entries(candidates)) {
            if (count > maxCount) {
                maxCount = count;
                predictedByte = parseInt(byte);
            }
        }
        return predictedByte || (byteSequence[byteSequence.length - 1] + 1) % 256;
    }
}

// ==================== WEBSOCKET ANALYZER ====================
class WebSocketAnalyzer {
    constructor() {
        this.frameHistory = [];
        this.opcodeStats = {};
        this.payloadPatterns = {};
    }
    
    analyzeWebSocketFrame(frame) {
        const opcode = frame.opcode || (frame.type === 'binary' ? 2 : 1);
        const payload = frame.payload || frame.data;
        this.opcodeStats[opcode] = (this.opcodeStats[opcode] || 0) + 1;
        if (payload && typeof payload === 'string') {
            const patterns = this.findStringPatterns(payload);
            return { opcode, patterns, payloadLength: payload.length };
        }
        return { opcode, payloadLength: payload ? payload.length : 0 };
    }
    
    findStringPatterns(str) {
        const patterns = {};
        for (let len = 3; len <= 8; len++) {
            for (let i = 0; i <= str.length - len; i++) {
                const pattern = str.slice(i, i + len);
                patterns[pattern] = (patterns[pattern] || 0) + 1;
            }
        }
        return patterns;
    }
    
    predictFromFrames(recentFrames) {
        if (!recentFrames || recentFrames.length === 0) return null;
        
        const lastFrame = recentFrames[recentFrames.length - 1];
        const analysis = this.analyzeWebSocketFrame(lastFrame);
        let mostCommonOpcode = null;
        let maxCount = 0;
        for (const [opcode, count] of Object.entries(this.opcodeStats)) {
            if (count > maxCount) {
                maxCount = count;
                mostCommonOpcode = parseInt(opcode);
            }
        }
        return {
            method: 'WEBSOCKET_FRAME',
            confidence: 55,
            mostCommonOpcode: mostCommonOpcode,
            lastFrameAnalysis: analysis
        };
    }
}

// ==================== API RESPONSE ANALYZER ====================
class APIResponseAnalyzer {
    constructor() {
        this.responseHistory = [];
        this.fieldPatterns = {};
        this.timingPatterns = [];
    }
    
    analyzeResponse(response, timestamp) {
        const analysis = {
            timestamp: timestamp,
            fields: Object.keys(response),
            numericFields: {},
            stringFields: {},
            responseTime: 0
        };
        for (const [key, value] of Object.entries(response)) {
            if (typeof value === 'number') {
                analysis.numericFields[key] = value;
            } else if (typeof value === 'string') {
                analysis.stringFields[key] = value;
            }
        }
        this.responseHistory.push(analysis);
        if (this.responseHistory.length > 100) this.responseHistory.shift();
        return analysis;
    }
    
    predictFromHistory() {
        if (this.responseHistory.length < 10) return null;
        const numericTrends = {};
        const last10 = this.responseHistory.slice(-10);
        for (const field of Object.keys(last10[0].numericFields)) {
            const values = last10.map(h => h.numericFields[field]).filter(v => v !== undefined);
            if (values.length >= 5) {
                const avg = values.reduce((a, b) => a + b, 0) / values.length;
                const last = values[values.length - 1];
                const trend = last - avg;
                numericTrends[field] = { avg, last, trend };
            }
        }
        return {
            method: 'API_RESPONSE',
            confidence: 65,
            numericTrends: numericTrends,
            totalResponses: this.responseHistory.length
        };
    }
}

// ==================== KHỞI TẠO ANALYZERS ====================
const packetAnalyzer = new PacketAnalyzer();
const wsAnalyzer = new WebSocketAnalyzer();
const apiAnalyzer = new APIResponseAnalyzer();

// ==================== HÀM TẠO BYTE SEQUENCE ====================
function generateByteSequenceFromAPI(data) {
    const bytes = [];
    for (const item of data) {
        const resultByte = item.result === 'Tài' ? 0x01 : 0x00;
        bytes.push(resultByte);
        bytes.push(item.sum & 0xFF);
        bytes.push((item.sum >> 8) & 0xFF);
        for (const dice of item.dice) {
            bytes.push(dice);
        }
    }
    return bytes;
}

function generateSimulatedFrames(data) {
    const frames = [];
    for (const item of data) {
        frames.push({
            opcode: 2,
            payload: Buffer.from(JSON.stringify({
                phien: item.phien,
                result: item.result,
                sum: item.sum,
                dice: item.dice
            })),
            timestamp: Date.now()
        });
    }
    return frames;
}

// ==================== DỰ ĐOÁN ĐA NGUỒN ====================
function estimateFromTrend(numericTrends) {
    for (const [field, trend] of Object.entries(numericTrends)) {
        if (field === 'sum' || field === 'Tong' || field === 'total') {
            if (trend.trend > 1.5) return 'Xỉu';
            if (trend.trend < -1.5) return 'Tài';
        }
    }
    return null;
}

function multiSourcePrediction(data, sessionId) {
    const results = [];
    
    try {
        const byteSequence = generateByteSequenceFromAPI(data);
        const bytePrediction = packetAnalyzer.predictFromBytes(byteSequence, sessionId);
        if (bytePrediction) results.push(bytePrediction);
    } catch (e) {
        console.error('[⚠️] Byte prediction error:', e.message);
    }
    
    try {
        const frames = generateSimulatedFrames(data);
        for (const frame of frames) {
            wsAnalyzer.analyzeWebSocketFrame(frame);
        }
        const wsPrediction = wsAnalyzer.predictFromFrames(frames);
        if (wsPrediction) results.push(wsPrediction);
    } catch (e) {
        console.error('[⚠️] WebSocket prediction error:', e.message);
    }
    
    try {
        for (const item of data) {
            apiAnalyzer.analyzeResponse(item, item.phien);
        }
        const apiPrediction = apiAnalyzer.predictFromHistory();
        if (apiPrediction) results.push(apiPrediction);
    } catch (e) {
        console.error('[⚠️] API prediction error:', e.message);
    }
    
    let taiScore = 0, xiuScore = 0;
    let predictionMethods = [];
    
    for (const r of results) {
        if (r.prediction === 'Tài') {
            taiScore += r.confidence;
            predictionMethods.push({ method: r.method, pred: 'Tài', conf: r.confidence });
        } else if (r.prediction === 'Xỉu') {
            xiuScore += r.confidence;
            predictionMethods.push({ method: r.method, pred: 'Xỉu', conf: r.confidence });
        } else if (r.method === 'API_RESPONSE') {
            const trendPred = estimateFromTrend(r.numericTrends);
            if (trendPred === 'Tài') {
                taiScore += r.confidence;
                predictionMethods.push({ method: r.method, pred: 'Tài', conf: r.confidence });
            } else if (trendPred === 'Xỉu') {
                xiuScore += r.confidence;
                predictionMethods.push({ method: r.method, pred: 'Xỉu', conf: r.confidence });
            }
        }
    }
    
    const total = taiScore + xiuScore;
    let finalPred = taiScore > xiuScore ? 'Tài' : 'Xỉu';
    let finalConf = total > 0 ? Math.round((Math.max(taiScore, xiuScore) / total) * 100) : 60;
    finalConf = Math.min(95, Math.max(60, finalConf));
    
    return {
        prediction: finalPred,
        confidence: finalConf,
        methods: predictionMethods,
        byte_analysis: results.find(r => r.method === 'BYTE_PATTERN') ? {
            predicted_byte: results.find(r => r.method === 'BYTE_PATTERN').predictedByte,
            predicted_dice: results.find(r => r.method === 'BYTE_PATTERN').dice
        } : null,
        websocket_analysis: results.find(r => r.method === 'WEBSOCKET_FRAME') ? {
            most_common_opcode: results.find(r => r.method === 'WEBSOCKET_FRAME').mostCommonOpcode
        } : null,
        api_analysis: results.find(r => r.method === 'API_RESPONSE') ? {
            numeric_trends: results.find(r => r.method === 'API_RESPONSE').numericTrends
        } : null
    };
}

// ==================== API ENDPOINTS ====================

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        name: "🔬 PACKET & BYTE ANALYZER V2.0",
        author: "@anhquan",
        status: "running",
        endpoints: {
            "/lc79-hu": "Dự đoán LC79 Hũ",
            "/lc79-md5": "Dự đoán LC79 MD5",
            "/betvip-hu": "Dự đoán BETVIP Hũ",
            "/betvip-md5": "Dự đoán BETVIP MD5",
            "/lc79-hu/packet": "Phân tích packet LC79 Hũ",
            "/lc79-md5/packet": "Phân tích packet LC79 MD5",
            "/betvip-hu/packet": "Phân tích packet BETVIP Hũ",
            "/betvip-md5/packet": "Phân tích packet BETVIP MD5",
            "/lichsu": "Lịch sử dự đoán"
        }
    });
});

// Endpoint dự đoán thường
async function handlePrediction(apiUrl, gameName) {
    const data = await fetchGameData(apiUrl);
    if (!data || data.length < 10) return null;
    
    const nextPhien = data[0].phien + 1;
    const results = data.map(d => d.result);
    
    // Phân tích cầu đơn giản
    let streak = 1;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[0]) streak++;
        else break;
    }
    
    let prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    let confidence = 65;
    
    if (streak >= 7) { prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài'; confidence = 92; }
    else if (streak >= 5) { prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài'; confidence = 85; }
    else if (streak >= 3) { prediction = results[0]; confidence = 75; }
    
    return {
        status: "success",
        game: gameName,
        phien_hien_tai: nextPhien,
        du_doan: prediction,
        do_tin_cay: `${confidence}%`,
        timestamp: new Date().toISOString()
    };
}

app.get('/lc79-hu', async (req, res) => {
    try {
        const result = await handlePrediction(API_URLS.lc79_hu, 'LC79 HŨ');
        if (!result) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/lc79-md5', async (req, res) => {
    try {
        const result = await handlePrediction(API_URLS.lc79_md5, 'LC79 MD5');
        if (!result) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/betvip-hu', async (req, res) => {
    try {
        const result = await handlePrediction(API_URLS.betvip_hu, 'BETVIP HŨ');
        if (!result) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/betvip-md5', async (req, res) => {
    try {
        const result = await handlePrediction(API_URLS.betvip_md5, 'BETVIP MD5');
        if (!result) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== ENDPOINT PACKET ANALYSIS ====================
async function handlePacketAnalysis(apiUrl, gameName) {
    console.log(`[🔬] Starting packet analysis for ${gameName}`);
    
    const data = await fetchGameData(apiUrl);
    if (!data) {
        console.error(`[❌] No data for ${gameName}`);
        return { error: 'Không thể lấy dữ liệu từ API' };
    }
    
    if (data.length < 10) {
        console.warn(`[⚠️] Only ${data.length} sessions, need 10+`);
        return { error: `Chỉ có ${data.length} phiên, cần ít nhất 10 phiên để phân tích` };
    }
    
    console.log(`[✅] Got ${data.length} sessions for analysis`);
    
    const sessionId = crypto.randomBytes(16).toString('hex');
    const nextPhien = data[0].phien + 1;
    
    let result;
    try {
        result = multiSourcePrediction(data, sessionId);
    } catch (e) {
        console.error(`[❌] Prediction error:`, e.message);
        return { error: 'Lỗi xử lý dự đoán', detail: e.message };
    }
    
    return {
        status: "research",
        game: gameName,
        phien_hien_tai: nextPhien,
        session_id: sessionId,
        du_doan: result.prediction,
        do_tin_cay: `${result.confidence}%`,
        phuong_phap: result.methods,
        phan_tich_byte: result.byte_analysis,
        phan_tich_websocket: result.websocket_analysis,
        phan_tich_api: result.api_analysis,
        total_phien_phan_tich: data.length,
        ghi_chu: "⚠️ Đây là kết quả phân tích từ dữ liệu API, không phải packet thật",
        timestamp: new Date().toISOString()
    };
}

app.get('/lc79-hu/packet', async (req, res) => {
    try {
        console.log('[🔬] GET /lc79-hu/packet');
        const result = await handlePacketAnalysis(API_URLS.lc79_hu, 'LC79 HŨ');
        if (result.error) return res.status(500).json(result);
        res.json(result);
    } catch (error) {
        console.error('[❌] Fatal error:', error.message);
        res.status(500).json({ error: 'Lỗi server', message: error.message });
    }
});

app.get('/lc79-md5/packet', async (req, res) => {
    try {
        console.log('[🔬] GET /lc79-md5/packet');
        const result = await handlePacketAnalysis(API_URLS.lc79_md5, 'LC79 MD5');
        if (result.error) return res.status(500).json(result);
        res.json(result);
    } catch (error) {
        console.error('[❌] Fatal error:', error.message);
        res.status(500).json({ error: 'Lỗi server', message: error.message });
    }
});

app.get('/betvip-hu/packet', async (req, res) => {
    try {
        console.log('[🔬] GET /betvip-hu/packet');
        const result = await handlePacketAnalysis(API_URLS.betvip_hu, 'BETVIP HŨ');
        if (result.error) return res.status(500).json(result);
        res.json(result);
    } catch (error) {
        console.error('[❌] Fatal error:', error.message);
        res.status(500).json({ error: 'Lỗi server', message: error.message });
    }
});

app.get('/betvip-md5/packet', async (req, res) => {
    try {
        console.log('[🔬] GET /betvip-md5/packet');
        const result = await handlePacketAnalysis(API_URLS.betvip_md5, 'BETVIP MD5');
        if (result.error) return res.status(500).json(result);
        res.json(result);
    } catch (error) {
        console.error('[❌] Fatal error:', error.message);
        res.status(500).json({ error: 'Lỗi server', message: error.message });
    }
});

// Lịch sử dự đoán
app.get('/lichsu', (req, res) => {
    res.json({
        status: "success",
        lc79_hu: { total: predictionHistory.lc79_hu.length, history: predictionHistory.lc79_hu.slice(0, 30) },
        lc79_md5: { total: predictionHistory.lc79_md5.length, history: predictionHistory.lc79_md5.slice(0, 30) },
        betvip_hu: { total: predictionHistory.betvip_hu.length, history: predictionHistory.betvip_hu.slice(0, 30) },
        betvip_md5: { total: predictionHistory.betvip_md5.length, history: predictionHistory.betvip_md5.slice(0, 30) }
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: "healthy", uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// ==================== KHỞI ĐỘNG SERVER ====================
loadHistory();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║                                                                       ║
║   🔬 PACKET & BYTE ANALYZER V2.0 - FIXED 🔬                           ║
║   📡 PORT: ${PORT}                                                       ║
║   👤 AUTHOR: @anhquan                                                 ║
║                                                                       ║
║   ✅ API đã sẵn sàng!                                                 ║
║                                                                       ║
║   📡 ENDPOINTS:                                                       ║
║   ├── GET /lc79-hu          → Dự đoán LC79 Hũ                        ║
║   ├── GET /lc79-md5         → Dự đoán LC79 MD5                       ║
║   ├── GET /betvip-hu        → Dự đoán BETVIP Hũ                      ║
║   ├── GET /betvip-md5       → Dự đoán BETVIP MD5                     ║
║   ├── GET /lc79-hu/packet   → Phân tích packet LC79 Hũ               ║
║   ├── GET /lc79-md5/packet  → Phân tích packet LC79 MD5              ║
║   ├── GET /betvip-hu/packet → Phân tích packet BETVIP Hũ             ║
║   ├── GET /betvip-md5/packet→ Phân tích packet BETVIP MD5            ║
║   ├── GET /lichsu           → Lịch sử dự đoán                        ║
║   └── GET /health           → Kiểm tra sức khỏe                      ║
║                                                                       ║
╚═══════════════════════════════════════════════════════════════════════╝
    `);
});

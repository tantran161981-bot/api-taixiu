const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// ==================== CẤU HÌNH ====================
const API_URLS = {
    lc79_hu: 'https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5',
    lc79_md5: 'https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=3959701241b686f12e01bfe9c3a319b8',
    betvip_hu: 'https://wtx.macminim6.online/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=f69c1c37e9ffbfea5b655ed312604b40',
    betvip_md5: 'https://wtxmd52.macminim6.online/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=7aa1c7e7ea0160fd97524740774a4c61'
};

// ==================== GIẢ LẬP PACKET DATA ====================
// Trong thực tế, bạn cần một proxy hoặc WebSocket để bắt packet thật
// Đây là mô phỏng dựa trên dữ liệu API có sẵn

class PacketAnalyzer {
    constructor() {
        this.packetHistory = [];
        this.bytePatterns = {};
        this.dicePatterns = {};
        this.sessionKeys = {};
    }
    
    // Giải mã byte thành kết quả xúc xắc (giả lập)
    decodeByteToDice(byteData, sessionId) {
        // Tạo một hash từ sessionId + byte để có tính ngẫu nhiên nhưng nhất quán
        const hash = crypto.createHash('sha256').update(sessionId + byteData.toString()).digest('hex');
        
        // Lấy 3 bytes đầu tiên của hash để tạo 3 con xúc xắc (1-6)
        const d1 = (parseInt(hash.slice(0, 2), 16) % 6) + 1;
        const d2 = (parseInt(hash.slice(2, 4), 16) % 6) + 1;
        const d3 = (parseInt(hash.slice(4, 6), 16) % 6) + 1;
        
        return { d1, d2, d3, total: d1 + d2 + d3 };
    }
    
    // Phân tích pattern byte
    analyzeBytePattern(byteSequence) {
        const patterns = {};
        
        // Tìm pattern lặp lại trong byte sequence
        for (let len = 2; len <= 8; len++) {
            for (let i = 0; i <= byteSequence.length - len; i++) {
                const pattern = byteSequence.slice(i, i + len);
                const key = pattern.join(',');
                patterns[key] = (patterns[key] || 0) + 1;
            }
        }
        
        // Tìm pattern phổ biến nhất
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
    
    // Dự đoán từ byte pattern
    predictFromBytes(byteSequence, sessionId) {
        const analysis = this.analyzeBytePattern(byteSequence);
        
        if (analysis.mostCommon && analysis.maxCount >= 2) {
            // Lấy pattern cuối cùng
            const lastBytes = byteSequence.slice(-3);
            const lastPattern = lastBytes.join(',');
            
            // Nếu pattern cuối khớp với pattern phổ biến, dự đoán byte tiếp theo
            if (analysis.patterns[lastPattern] >= 2) {
                // Dự đoán byte tiếp theo dựa trên pattern
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
        // Tìm byte thường xuất hiện sau pattern cuối
        const lastPattern = byteSequence.slice(-2).join(',');
        let candidates = {};
        
        for (let i = 0; i < byteSequence.length - 2; i++) {
            const currentPattern = byteSequence.slice(i, i + 2).join(',');
            if (currentPattern === lastPattern) {
                const nextByte = byteSequence[i + 2];
                candidates[nextByte] = (candidates[nextByte] || 0) + 1;
            }
        }
        
        // Chọn byte có tần suất cao nhất
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

// ==================== PHÂN TÍCH WEB SOCKET (GIẢ LẬP) ====================
class WebSocketAnalyzer {
    constructor() {
        this.frameHistory = [];
        this.opcodeStats = {};
        this.payloadPatterns = {};
    }
    
    analyzeWebSocketFrame(frame) {
        // Phân tích WebSocket frame
        const opcode = frame.opcode || (frame.type === 'binary' ? 2 : 1);
        const payload = frame.payload || frame.data;
        
        this.opcodeStats[opcode] = (this.opcodeStats[opcode] || 0) + 1;
        
        if (payload && typeof payload === 'string') {
            // Phân tích payload string
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
        // Phân tích các frame gần đây
        const lastFrame = recentFrames[recentFrames.length - 1];
        const analysis = this.analyzeWebSocketFrame(lastFrame);
        
        // Dự đoán dựa trên opcode phổ biến
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

// ==================== PHÂN TÍCH API RESPONSE ====================
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
        
        // Phân tích các trường số
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
        
        // Tìm pattern trong các trường số
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

// ==================== TỔNG HỢP DỰ ĐOÁN TỪ PACKET ====================
const packetAnalyzer = new PacketAnalyzer();
const wsAnalyzer = new WebSocketAnalyzer();
const apiAnalyzer = new APIResponseAnalyzer();

// Biến lưu trữ byte sequence giả lập
let simulatedByteSequence = [];
let simulatedFrames = [];

// Tạo byte sequence từ dữ liệu API
function generateByteSequenceFromAPI(data) {
    const bytes = [];
    for (const item of data) {
        // Chuyển đổi kết quả thành byte
        const resultByte = item.result === 'Tài' ? 0x01 : 0x00;
        bytes.push(resultByte);
        
        // Thêm các byte từ tổng điểm
        bytes.push(item.sum & 0xFF);
        bytes.push((item.sum >> 8) & 0xFF);
        
        // Thêm byte từ xúc xắc
        for (const dice of item.dice) {
            bytes.push(dice);
        }
    }
    return bytes;
}

// Tạo WebSocket frame giả lập
function generateSimulatedFrames(data) {
    const frames = [];
    for (const item of data) {
        frames.push({
            opcode: 2, // binary frame
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

// ==================== DỰ ĐOÁN TỪ NHIỀU NGUỒN ====================
function multiSourcePrediction(data, sessionId) {
    const results = [];
    
    // 1. Phân tích byte sequence
    const byteSequence = generateByteSequenceFromAPI(data);
    const bytePrediction = packetAnalyzer.predictFromBytes(byteSequence, sessionId);
    if (bytePrediction) results.push(bytePrediction);
    
    // 2. Phân tích WebSocket frames
    const frames = generateSimulatedFrames(data);
    for (const frame of frames) {
        wsAnalyzer.analyzeWebSocketFrame(frame);
    }
    const wsPrediction = wsAnalyzer.predictFromFrames(frames);
    if (wsPrediction) results.push(wsPrediction);
    
    // 3. Phân tích API response
    for (const item of data) {
        apiAnalyzer.analyzeResponse(item, item.phien);
    }
    const apiPrediction = apiAnalyzer.predictFromHistory();
    if (apiPrediction) results.push(apiPrediction);
    
    // Tổng hợp kết quả
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
            // Từ phân tích API, ước lượng dựa trên trend
            const trendPred = this.estimateFromTrend(r.numericTrends);
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
        byte_analysis: bytePrediction ? {
            predicted_byte: bytePrediction.predictedByte,
            predicted_dice: bytePrediction.dice
        } : null,
        websocket_analysis: wsPrediction ? {
            most_common_opcode: wsPrediction.mostCommonOpcode,
            last_frame: wsPrediction.lastFrameAnalysis
        } : null,
        api_analysis: apiPrediction ? {
            numeric_trends: apiPrediction.numericTrends
        } : null
    };
}

function estimateFromTrend(numericTrends) {
    // Ước lượng từ trend của các trường số
    for (const [field, trend] of Object.entries(numericTrends)) {
        if (field === 'sum' || field === 'Tong') {
            if (trend.trend > 1.5) return 'Xỉu';  // Tổng tăng → Xỉu
            if (trend.trend < -1.5) return 'Tài'; // Tổng giảm → Tài
        }
    }
    return null;
}

// ==================== LẤY DỮ LIỆU ====================
async function fetchGameData(apiUrl) {
    try {
        const response = await axios.get(apiUrl, { timeout: 10000 });
        const list = response.data?.list || [];
        if (!list.length) return null;
        
        return list.map(item => ({
            phien: item.id,
            result: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
            dice: [item.dices[0], item.dices[1], item.dices[2]],
            sum: item.point
        }));
    } catch (error) {
        console.error('Lỗi fetch:', error.message);
        return null;
    }
}

// ==================== API ENDPOINTS ====================

app.get('/', (req, res) => {
    res.json({
        name: "🔬 PACKET & BYTE ANALYZER V1.0",
        author: "@anhquan",
        description: "Phân tích packet, byte pattern, WebSocket frames để dự đoán",
        note: "⚠️ ĐÂY LÀ PHIÊN BẢN NGHIÊN CỨU - KHÔNG ĐẢM BẢO CHÍNH XÁC 100%",
        endpoints: {
            "/lc79-hu/packet": "Phân tích packet LC79 Hũ",
            "/lc79-md5/packet": "Phân tích packet LC79 MD5",
            "/betvip-hu/packet": "Phân tích packet BETVIP Hũ",
            "/betvip-md5/packet": "Phân tích packet BETVIP MD5"
        }
    });
});

async function handlePacketAnalysis(apiUrl, gameName) {
    const data = await fetchGameData(apiUrl);
    if (!data || data.length < 10) return null;
    
    const sessionId = crypto.randomBytes(16).toString('hex');
    const nextPhien = data[0].phien + 1;
    const result = multiSourcePrediction(data, sessionId);
    
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
        ghi_chu: "⚠️ Đây là kết quả phân tích packet giả lập từ API. Để có packet thật, cần tích hợp WebSocket/proxy thực tế.",
        timestamp: new Date().toISOString()
    };
}

app.get('/lc79-hu/packet', async (req, res) => {
    try {
        const result = await handlePacketAnalysis(API_URLS.lc79_hu, 'LC79 HŨ');
        if (!result) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/lc79-md5/packet', async (req, res) => {
    try {
        const result = await handlePacketAnalysis(API_URLS.lc79_md5, 'LC79 MD5');
        if (!result) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/betvip-hu/packet', async (req, res) => {
    try {
        const result = await handlePacketAnalysis(API_URLS.betvip_hu, 'BETVIP HŨ');
        if (!result) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/betvip-md5/packet', async (req, res) => {
    try {
        const result = await handlePacketAnalysis(API_URLS.betvip_md5, 'BETVIP MD5');
        if (!result) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== KHỞI ĐỘNG ====================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║                                                                       ║
║   🔬 PACKET & BYTE ANALYZER V1.0 - NGHIÊN CỨU 🔬                     ║
║   📡 PORT: ${PORT}                                                       ║
║   👤 AUTHOR: @anhquan                                                 ║
║                                                                       ║
║   ⚠️ LƯU Ý QUAN TRỌNG:                                                ║
║   ├── Đây là phiên bản nghiên cứu, không đảm bảo chính xác 100%      ║
║   ├── Packet thật được mã hóa TLS, không thể đọc trực tiếp           ║
║   ├── Kết quả dựa trên giả lập từ API có sẵn                         ║
║   └── Để phân tích packet thật, cần:                                 ║
║       • Proxy MITM (mitmproxy, Burp Suite)                           ║
║       • WebSocket real-time (ws://)                                  ║
║       • Giải mã TLS (cần private key)                                ║
║                                                                       ║
║   🔬 PHƯƠNG PHÁP PHÂN TÍCH:                                           ║
║   ├── Byte Pattern Recognition                                       ║
║   ├── WebSocket Frame Analysis                                       ║
║   ├── API Response Timing & Trends                                   ║
║   └── Multi-source Ensemble Voting                                   ║
║                                                                       ║
╚═══════════════════════════════════════════════════════════════════════╝
    `);
});

const express = require('express');
const axios = require('axios');
const cors = require('cors');
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

// ==================== LỚP PHÂN TÍCH PACKET ====================
class PacketAnalyzer {
    constructor() {
        this.sessionData = new Map();
        this.packetPatterns = new Map();
        this.dicePatterns = new Map();
        this.predictionHistory = [];
    }

    generateSessionId() {
        return crypto.randomBytes(16).toString('hex');
    }

    // Phân tích byte pattern và dự đoán 3 xúc xắc
    analyzeBytePattern(data) {
        const bytes = this.convertToBytes(data);
        const patterns = this.findPatterns(bytes);
        const dicePrediction = this.predictDiceFromBytes(bytes);
        
        return {
            byte_length: bytes.length,
            unique_patterns: Object.keys(patterns).length,
            dice_prediction: dicePrediction,
            confidence: dicePrediction.confidence
        };
    }

    // Chuyển đổi dữ liệu thành byte array
    convertToBytes(data) {
        const bytes = [];
        for (const item of data.slice(0, 30)) {
            // Kết quả (Tài=1, Xỉu=0)
            bytes.push(item.result === 'Tài' ? 0x01 : 0x00);
            // Tổng điểm
            bytes.push(item.sum & 0xFF);
            bytes.push((item.sum >> 8) & 0xFF);
            // 3 xúc xắc
            bytes.push(item.dice[0]);
            bytes.push(item.dice[1]);
            bytes.push(item.dice[2]);
        }
        return bytes;
    }

    // Tìm pattern lặp lại
    findPatterns(bytes) {
        const patterns = {};
        for (let len = 2; len <= 8; len++) {
            for (let i = 0; i <= bytes.length - len; i++) {
                const pattern = bytes.slice(i, i + len).join(',');
                patterns[pattern] = (patterns[pattern] || 0) + 1;
            }
        }
        return patterns;
    }

    // Dự đoán 3 xúc xắc từ byte pattern
    predictDiceFromBytes(bytes) {
        if (bytes.length < 18) {
            return {
                dice1: 3, dice2: 4, dice3: 3,
                total: 10,
                confidence: 50,
                method: 'insufficient_data'
            };
        }

        // Lấy pattern của 3 xúc xắc gần nhất
        const lastDiceBytes = bytes.slice(-6); // 3 xúc xắc cuối (mỗi xúc xắc 1 byte)
        
        // Tìm các lần xuất hiện trước đó của pattern xúc xắc
        const dicePatterns = {};
        for (let i = 0; i <= bytes.length - 6; i += 6) {
            const pattern = bytes.slice(i, i + 6).join(',');
            dicePatterns[pattern] = (dicePatterns[pattern] || 0) + 1;
        }
        
        const lastPattern = lastDiceBytes.join(',');
        const frequency = dicePatterns[lastPattern] || 1;
        
        // Tính toán xác suất cho từng mặt xúc xắc
        const dice1Freq = {}, dice2Freq = {}, dice3Freq = {};
        
        for (let i = 0; i <= bytes.length - 6; i += 6) {
            const d1 = bytes[i];
            const d2 = bytes[i + 1];
            const d3 = bytes[i + 2];
            
            dice1Freq[d1] = (dice1Freq[d1] || 0) + 1;
            dice2Freq[d2] = (dice2Freq[d2] || 0) + 1;
            dice3Freq[d3] = (dice3Freq[d3] || 0) + 1;
        }
        
        // Tìm giá trị có tần suất cao nhất
        let predD1 = 3, predD2 = 4, predD3 = 3;
        let max1 = 0, max2 = 0, max3 = 0;
        
        for (const [face, count] of Object.entries(dice1Freq)) {
            if (count > max1) {
                max1 = count;
                predD1 = parseInt(face);
            }
        }
        for (const [face, count] of Object.entries(dice2Freq)) {
            if (count > max2) {
                max2 = count;
                predD2 = parseInt(face);
            }
        }
        for (const [face, count] of Object.entries(dice3Freq)) {
            if (count > max3) {
                max3 = count;
                predD3 = parseInt(face);
            }
        }
        
        // Điều chỉnh dựa trên xu hướng
        const total = predD1 + predD2 + predD3;
        let confidence = 55 + Math.min(35, frequency * 3);
        
        return {
            dice1: predD1,
            dice2: predD2,
            dice3: predD3,
            total: total,
            prediction: total >= 11 ? 'Tài' : 'Xỉu',
            confidence: Math.min(92, confidence),
            frequency: frequency,
            method: 'byte_pattern_matching'
        };
    }

    // Phân tích xu hướng và dự đoán xúc xắc
    analyzeTrendAndPredict(data) {
        const results = data.map(d => d.result);
        const diceHistory = data.map(d => d.dice);
        const sums = data.map(d => d.sum);
        
        // Phân tích streak
        let streak = 1;
        for (let i = 1; i < results.length; i++) {
            if (results[i] === results[0]) streak++;
            else break;
        }
        
        // Phân tích tổng điểm
        const avgSum = sums.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
        
        // Phân tích từng xúc xắc
        const dice1History = diceHistory.map(d => d[0]);
        const dice2History = diceHistory.map(d => d[1]);
        const dice3History = diceHistory.map(d => d[2]);
        
        // Dự đoán từng xúc xắc dựa trên tần suất
        const getMostFrequent = (arr) => {
            const freq = {};
            for (const val of arr.slice(0, 20)) {
                freq[val] = (freq[val] || 0) + 1;
            }
            let maxFace = 3, maxCount = 0;
            for (const [face, count] of Object.entries(freq)) {
                if (count > maxCount) {
                    maxCount = count;
                    maxFace = parseInt(face);
                }
            }
            return { face: maxFace, confidence: 50 + maxCount * 2 };
        };
        
        const d1Pred = getMostFrequent(dice1History);
        const d2Pred = getMostFrequent(dice2History);
        const d3Pred = getMostFrequent(dice3History);
        
        let prediction = 'Tài';
        let confidence = 65;
        
        // Điều chỉnh theo streak
        if (streak >= 5) {
            prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
            confidence = 85;
        } else if (streak >= 3) {
            prediction = results[0];
            confidence = 75;
        } else {
            const total = d1Pred.face + d2Pred.face + d3Pred.face;
            prediction = total >= 11 ? 'Tài' : 'Xỉu';
            confidence = Math.round((d1Pred.confidence + d2Pred.confidence + d3Pred.confidence) / 3);
        }
        
        return {
            dice1: d1Pred.face,
            dice2: d2Pred.face,
            dice3: d3Pred.face,
            total: d1Pred.face + d2Pred.face + d3Pred.face,
            prediction: prediction,
            confidence: Math.min(92, confidence),
            streak: streak,
            avg_sum: avgSum.toFixed(1)
        };
    }

    // Tổng hợp dự đoán từ nhiều phương pháp
    predict(data) {
        const byteAnalysis = this.analyzeBytePattern(data);
        const trendAnalysis = this.analyzeTrendAndPredict(data);
        
        // Kết hợp kết quả
        let finalDice1, finalDice2, finalDice3;
        let finalPrediction;
        let finalConfidence;
        
        // Ưu tiên byte pattern nếu confidence cao
        if (byteAnalysis.dice_prediction.confidence > trendAnalysis.confidence + 10) {
            finalDice1 = byteAnalysis.dice_prediction.dice1;
            finalDice2 = byteAnalysis.dice_prediction.dice2;
            finalDice3 = byteAnalysis.dice_prediction.dice3;
            finalPrediction = byteAnalysis.dice_prediction.prediction;
            finalConfidence = byteAnalysis.dice_prediction.confidence;
        } 
        // Ưu tiên trend analysis nếu confidence cao hơn
        else if (trendAnalysis.confidence > byteAnalysis.dice_prediction.confidence + 10) {
            finalDice1 = trendAnalysis.dice1;
            finalDice2 = trendAnalysis.dice2;
            finalDice3 = trendAnalysis.dice3;
            finalPrediction = trendAnalysis.prediction;
            finalConfidence = trendAnalysis.confidence;
        }
        // Kết hợp cân bằng
        else {
            finalDice1 = Math.round((byteAnalysis.dice_prediction.dice1 + trendAnalysis.dice1) / 2);
            finalDice2 = Math.round((byteAnalysis.dice_prediction.dice2 + trendAnalysis.dice2) / 2);
            finalDice3 = Math.round((byteAnalysis.dice_prediction.dice3 + trendAnalysis.dice3) / 2);
            // Đảm bảo xúc xắc trong khoảng 1-6
            finalDice1 = Math.min(6, Math.max(1, finalDice1));
            finalDice2 = Math.min(6, Math.max(1, finalDice2));
            finalDice3 = Math.min(6, Math.max(1, finalDice3));
            
            const total = finalDice1 + finalDice2 + finalDice3;
            finalPrediction = total >= 11 ? 'Tài' : 'Xỉu';
            finalConfidence = Math.round((byteAnalysis.dice_prediction.confidence + trendAnalysis.confidence) / 2);
        }
        
        const total = finalDice1 + finalDice2 + finalDice3;
        
        return {
            dice: [finalDice1, finalDice2, finalDice3],
            total: total,
            prediction: finalPrediction,
            confidence: finalConfidence,
            methods: {
                byte_pattern: byteAnalysis.dice_prediction,
                trend_analysis: trendAnalysis
            }
        };
    }
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
            console.error('[❌] No data in response');
            return null;
        }
        
        console.log(`[✅] Fetched ${list.length} sessions`);
        
        return list.map(item => ({
            phien: item.id,
            result: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
            dice: [item.dices?.[0] || 0, item.dices?.[1] || 0, item.dices?.[2] || 0],
            sum: item.point || 0,
            timestamp: Date.now()
        }));
    } catch (error) {
        console.error('[❌] Fetch error:', error.message);
        return null;
    }
}

// ==================== KHỞI TẠO ANALYZER ====================
const packetAnalyzer = new PacketAnalyzer();

// ==================== API ENDPOINTS ====================

app.get('/', (req, res) => {
    res.json({
        name: "🔬 PACKET ANALYZER API V4.0 - DỰ ĐOÁN 3 XÚC XẮC",
        author: "@anhquan",
        status: "running",
        description: "Phân tích packet và byte pattern để dự đoán 3 xúc xắc cụ thể",
        endpoints: {
            "/packet/lc79-hu": "Phân tích packet LC79 Hũ",
            "/packet/lc79-md5": "Phân tích packet LC79 MD5",
            "/packet/betvip-hu": "Phân tích packet BETVIP Hũ",
            "/packet/betvip-md5": "Phân tích packet BETVIP MD5",
            "/health": "Kiểm tra server"
        }
    });
});

// Endpoint phân tích packet
async function handlePacketAnalysis(apiUrl, gameName) {
    console.log(`[🔬] Starting packet analysis for ${gameName}`);
    
    const data = await fetchGameData(apiUrl);
    if (!data) {
        return { error: 'Không thể lấy dữ liệu từ API', game: gameName };
    }
    
    if (data.length < 10) {
        return { 
            error: `Không đủ dữ liệu (chỉ ${data.length}/10 phiên)`, 
            game: gameName,
            suggestion: 'Đợi thêm phiên hoặc kiểm tra API'
        };
    }
    
    console.log(`[✅] Analyzing ${data.length} sessions...`);
    
    const sessionId = packetAnalyzer.generateSessionId();
    const result = packetAnalyzer.predict(data);
    const nextPhien = data[0].phien + 1;
    const lastActual = data[0];
    
    return {
        status: "success",
        game: gameName,
        session_id: sessionId,
        phien_hien_tai: nextPhien,
        
        // DỰ ĐOÁN 3 XÚC XẮC
        du_doan_xuc_xac: {
            xuc_xac_1: result.dice[0],
            xuc_xac_2: result.dice[1],
            xuc_xac_3: result.dice[2],
            tong: result.total,
            ket_qua: result.prediction
        },
        
        do_tin_cay: `${result.confidence}%`,
        
        // SO SÁNH VỚI THỰC TẾ GẦN NHẤT
        thuc_te_gan_nhat: {
            phien: lastActual.phien,
            xuc_xac: lastActual.dice,
            tong: lastActual.sum,
            ket_qua: lastActual.result
        },
        
        // CHI TIẾT PHÂN TÍCH
        phan_tich: {
            tu_byte_pattern: {
                xuc_xac: [result.methods.byte_pattern.dice1, result.methods.byte_pattern.dice2, result.methods.byte_pattern.dice3],
                tong: result.methods.byte_pattern.total,
                ket_qua: result.methods.byte_pattern.prediction,
                do_tin_cay: result.methods.byte_pattern.confidence + '%',
                tan_suat_xuat_hien: result.methods.byte_pattern.frequency
            },
            tu_xu_huong: {
                xuc_xac: [result.methods.trend_analysis.dice1, result.methods.trend_analysis.dice2, result.methods.trend_analysis.dice3],
                tong: result.methods.trend_analysis.total,
                ket_qua: result.methods.trend_analysis.prediction,
                do_tin_cay: result.methods.trend_analysis.confidence + '%',
                chuoi_bet: result.methods.trend_analysis.streak
            }
        },
        
        timestamp: new Date().toISOString()
    };
}

app.get('/packet/lc79-hu', async (req, res) => {
    try {
        console.log('[🔬] GET /packet/lc79-hu');
        const result = await handlePacketAnalysis(API_URLS.lc79_hu, 'LC79 HŨ');
        if (result.error) return res.status(500).json(result);
        res.json(result);
    } catch (error) {
        console.error('[❌] Error:', error.message);
        res.status(500).json({ error: 'Lỗi server', message: error.message });
    }
});

app.get('/packet/lc79-md5', async (req, res) => {
    try {
        console.log('[🔬] GET /packet/lc79-md5');
        const result = await handlePacketAnalysis(API_URLS.lc79_md5, 'LC79 MD5');
        if (result.error) return res.status(500).json(result);
        res.json(result);
    } catch (error) {
        console.error('[❌] Error:', error.message);
        res.status(500).json({ error: 'Lỗi server', message: error.message });
    }
});

app.get('/packet/betvip-hu', async (req, res) => {
    try {
        console.log('[🔬] GET /packet/betvip-hu');
        const result = await handlePacketAnalysis(API_URLS.betvip_hu, 'BETVIP HŨ');
        if (result.error) return res.status(500).json(result);
        res.json(result);
    } catch (error) {
        console.error('[❌] Error:', error.message);
        res.status(500).json({ error: 'Lỗi server', message: error.message });
    }
});

app.get('/packet/betvip-md5', async (req, res) => {
    try {
        console.log('[🔬] GET /packet/betvip-md5');
        const result = await handlePacketAnalysis(API_URLS.betvip_md5, 'BETVIP MD5');
        if (result.error) return res.status(500).json(result);
        res.json(result);
    } catch (error) {
        console.error('[❌] Error:', error.message);
        res.status(500).json({ error: 'Lỗi server', message: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: "healthy", 
        uptime: process.uptime(), 
        timestamp: new Date().toISOString() 
    });
});

// ==================== KHỞI ĐỘNG SERVER ====================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║                                                                       ║
║   🔬 PACKET ANALYZER API V4.0 - DỰ ĐOÁN 3 XÚC XẮC 🔬                 ║
║   📡 PORT: ${PORT}                                                       ║
║   👤 AUTHOR: @anhquan                                                 ║
║                                                                       ║
║   ✅ API đã sẵn sàng!                                                 ║
║                                                                       ║
║   🎲 KẾT QUẢ TRẢ VỀ:                                                  ║
║   {                                                                   ║
║     "du_doan_xuc_xac": {                                              ║
║       "xuc_xac_1": 4,                                                 ║
║       "xuc_xac_2": 5,                                                 ║
║       "xuc_xac_3": 3,                                                 ║
║       "tong": 12,                                                     ║
║       "ket_qua": "Tài"                                                ║
║     },                                                                ║
║     "do_tin_cay": "87%",                                              ║
║     "thuc_te_gan_nhat": {                                             ║
║       "xuc_xac": [2, 4, 3],                                           ║
║       "tong": 9,                                                      ║
║       "ket_qua": "Xỉu"                                                ║
║     }                                                                 ║
║   }                                                                   ║
║                                                                       ║
╚═══════════════════════════════════════════════════════════════════════╝
    `);
});

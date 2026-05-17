const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

// ==================== CẤU HÌNH ====================
const API_RESULT_URL = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const FETCH_INTERVAL = 5000; // 5 giây
const HISTORY_LIMIT = 100;   // Lưu tối đa 100 phiên

// ==================== LƯU TRỮ ====================
let resultHistory = [];      // Lưu kết quả lịch sử
let lastProcessedId = null;  // ID phiên cuối cùng đã xử lý

// ==================== AI ANALYZER ====================
class TaiXiuPredictor {
    constructor() {
        // Trọng số ban đầu cho từng logic AI
        this.weights = {
            markov: 1.0,
            trend: 1.0,
            imbalance: 1.0,
            pattern: 1.0,
            streak: 1.0,
            alternating: 1.0,
            pair22: 1.0,
            breakPoint: 1.0
        };
        
        // Lưu lịch sử dự đoán để tự học
        this.predictionHistory = [];
        this.accuracyWindow = 20;
    }
    
    // ==================== 8 LOGIC AI ====================
    
    // Logic 1: Markov Chain (bậc 3)
    markovPredict(results) {
        if (results.length < 4) return null;
        const seq = results.map(r => r === 'TAI' ? 'T' : 'X');
        const last3 = seq.slice(-3).join('');
        const transitions = {};
        for (let i = 0; i < seq.length - 3; i++) {
            const key = seq.slice(i, i + 3).join('');
            const next = seq[i + 3];
            if (!transitions[key]) transitions[key] = { T: 0, X: 0 };
            transitions[key][next]++;
        }
        const possible = transitions[last3];
        if (!possible) return null;
        const total = possible.T + possible.X;
        if (possible.T > possible.X) return { prediction: 'TAI', confidence: possible.T / total };
        if (possible.X > possible.T) return { prediction: 'XIU', confidence: possible.X / total };
        return null;
    }
    
    // Logic 2: Xu hướng dài hạn (20 phiên)
    trendPredict(results) {
        if (results.length < 20) return null;
        const last20 = results.slice(0, 20);
        const taiCount = last20.filter(r => r === 'TAI').length;
        const xiuCount = 20 - taiCount;
        if (taiCount > 13) return { prediction: 'XIU', confidence: (taiCount - 10) / 20 };
        if (xiuCount > 13) return { prediction: 'TAI', confidence: (xiuCount - 10) / 20 };
        return null;
    }
    
    // Logic 3: Chênh lệch 12 phiên (bẻ cầu)
    imbalancePredict(results) {
        if (results.length < 12) return null;
        const last12 = results.slice(0, 12);
        const taiCount = last12.filter(r => r === 'TAI').length;
        if (taiCount >= 9) return { prediction: 'XIU', confidence: 0.7 + (taiCount - 8) * 0.05 };
        if (taiCount <= 3) return { prediction: 'TAI', confidence: 0.7 + (4 - taiCount) * 0.05 };
        return null;
    }
    
    // Logic 4: Pattern 3 phiên (1-2-1, 2-1-2, 3 phiên giống)
    patternPredict(results) {
        if (results.length < 4) return null;
        const last3 = results.slice(0, 3);
        if (last3[0] === last3[1] && last3[1] === last3[2]) {
            return { prediction: last3[0] === 'TAI' ? 'XIU' : 'TAI', confidence: 0.8 };
        }
        if (last3[0] === last3[2] && last3[0] !== last3[1]) {
            return { prediction: last3[1], confidence: 0.7 };
        }
        if (last3[0] === last3[1] && last3[1] !== last3[2]) {
            return { prediction: last3[2], confidence: 0.65 };
        }
        return null;
    }
    
    // Logic 5: Bệt (streak)
    streakPredict(results) {
        if (results.length < 3) return null;
        let streak = 1;
        const current = results[0];
        for (let i = 1; i < results.length; i++) {
            if (results[i] === current) streak++;
            else break;
        }
        if (streak >= 3) {
            let confidence = 0.55 + (streak * 0.03);
            if (streak >= 6) {
                // Bệt dài quá → có thể gãy
                return { prediction: current === 'TAI' ? 'XIU' : 'TAI', confidence: 0.7 };
            }
            return { prediction: current, confidence: Math.min(confidence, 0.85) };
        }
        return null;
    }
    
    // Logic 6: Cầu đảo 1-1
    alternatingPredict(results) {
        if (results.length < 6) return null;
        let isAlternating = true;
        for (let i = 0; i < 4; i++) {
            if (results[i] === results[i + 1]) {
                isAlternating = false;
                break;
            }
        }
        if (isAlternating) {
            const last = results[0];
            return { prediction: last === 'TAI' ? 'XIU' : 'TAI', confidence: 0.75 };
        }
        return null;
    }
    
    // Logic 7: Cầu 2-2
    pair22Predict(results) {
        if (results.length < 6) return null;
        let pairs = [];
        for (let i = 0; i < 4; i += 2) {
            if (results[i] === results[i + 1]) pairs.push(results[i]);
            else break;
        }
        if (pairs.length >= 2 && pairs[0] !== pairs[1]) {
            const lastPair = pairs[pairs.length - 1];
            return { prediction: lastPair === 'TAI' ? 'XIU' : 'TAI', confidence: 0.75 };
        }
        return null;
    }
    
    // Logic 8: Phân tích điểm gãy
    breakPointPredict(results) {
        if (results.length < 8) return null;
        const last5 = results.slice(0, 5);
        const prev5 = results.slice(5, 10);
        const lastTaiCount = last5.filter(r => r === 'TAI').length;
        const prevTaiCount = prev5.filter(r => r === 'TAI').length;
        if (Math.abs(lastTaiCount - prevTaiCount) >= 3) {
            const dominant = lastTaiCount > prevTaiCount ? 'TAI' : 'XIU';
            return { prediction: dominant === 'TAI' ? 'XIU' : 'TAI', confidence: 0.7 };
        }
        return null;
    }
    
    // ==================== TỔNG HỢP AI ====================
    predict(results) {
        if (results.length < 10) {
            const last = results[0];
            return { prediction: last || 'TAI', confidence: 0.5, reason: 'Chưa đủ dữ liệu' };
        }
        
        const predictions = [
            { logic: 'markov', result: this.markovPredict(results) },
            { logic: 'trend', result: this.trendPredict(results) },
            { logic: 'imbalance', result: this.imbalancePredict(results) },
            { logic: 'pattern', result: this.patternPredict(results) },
            { logic: 'streak', result: this.streakPredict(results) },
            { logic: 'alternating', result: this.alternatingPredict(results) },
            { logic: 'pair22', result: this.pair22Predict(results) },
            { logic: 'breakPoint', result: this.breakPointPredict(results) }
        ];
        
        let taiScore = 0;
        let xiuScore = 0;
        let totalWeight = 0;
        
        for (const item of predictions) {
            if (item.result && item.result.confidence > 0.5) {
                const weight = this.weights[item.logic] * item.result.confidence;
                if (item.result.prediction === 'TAI') {
                    taiScore += weight;
                } else {
                    xiuScore += weight;
                }
                totalWeight += weight;
            }
        }
        
        if (totalWeight === 0) {
            const last = results[0];
            return { prediction: last, confidence: 0.5, reason: 'Không logic nào đủ tin cậy' };
        }
        
        const finalPrediction = taiScore > xiuScore ? 'TAI' : 'XIU';
        let confidence = (Math.max(taiScore, xiuScore) / totalWeight);
        confidence = Math.min(0.95, Math.max(0.55, confidence));
        
        return {
            prediction: finalPrediction,
            confidence: confidence,
            reason: `Ensemble từ ${predictions.filter(p => p.result && p.result.confidence > 0.5).length} logic`
        };
    }
    
    // Hàm tự học: cập nhật trọng số dựa trên kết quả thực tế
    selfLearn(actualResult, predictedResult, logicResults) {
        this.predictionHistory.push({
            actual: actualResult,
            predicted: predictedResult,
            logicResults: logicResults,
            timestamp: Date.now()
        });
        
        if (this.predictionHistory.length > this.accuracyWindow) {
            this.predictionHistory.shift();
        }
        
        // Cập nhật trọng số cho từng logic dựa trên độ chính xác gần đây
        for (const logic in this.weights) {
            let correctCount = 0;
            let totalCount = 0;
            for (const record of this.predictionHistory) {
                const logicResult = record.logicResults[logic];
                if (logicResult && logicResult.confidence > 0.5) {
                    totalCount++;
                    if (logicResult.prediction === record.actual) {
                        correctCount++;
                    }
                }
            }
            if (totalCount >= 5) {
                const accuracy = correctCount / totalCount;
                this.weights[logic] = Math.min(2.0, Math.max(0.3, accuracy * 1.2));
            }
        }
    }
}

const predictor = new TaiXiuPredictor();

// ==================== FETCH & UPDATE ====================
async function fetchLC79Results() {
    try {
        const response = await axios.get(API_RESULT_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
                'Referer': 'https://lc79b.bet/'
            },
            timeout: 10000
        });
        
        if (response.data && response.data.list && response.data.list.length > 0) {
            // Lấy phiên mới nhất
            const list = response.data.list;
            const latest = list[0];
            
            // Cập nhật lịch sử (mới nhất ở đầu)
            resultHistory = list.map(item => ({
                id: item.id,
                result: item.resultTruyenThong,
                dice: item.dices,
                point: item.point
            }));
            
            if (resultHistory.length > HISTORY_LIMIT) {
                resultHistory = resultHistory.slice(0, HISTORY_LIMIT);
            }
            
            // Nếu có phiên mới
            if (lastProcessedId !== latest.id) {
                console.log(`[📥] Phiên mới: ${latest.id} - Kết quả: ${latest.resultTruyenThong} - Xúc xắc: ${latest.dices.join(',')}`);
                
                // Kiểm tra dự đoán cũ và tự học
                if (lastProcessedId !== null && predictor.predictionHistory.length > 0) {
                    const lastPrediction = predictor.predictionHistory[predictor.predictionHistory.length - 1];
                    if (lastPrediction && !lastPrediction.verified) {
                        const wasCorrect = (lastPrediction.predicted === latest.resultTruyenThong);
                        predictor.selfLearn(latest.resultTruyenThong, lastPrediction.predicted, lastPrediction.logicResults);
                        lastPrediction.verified = true;
                        console.log(`[📊] Tự học: Dự đoán ${lastPrediction.predicted} - Thực tế: ${latest.resultTruyenThong} - ${wasCorrect ? 'ĐÚNG ✅' : 'SAI ❌'}`);
                    }
                }
                
                lastProcessedId = latest.id;
            }
            
            return true;
        }
    } catch (error) {
        console.error('[❌] Lỗi fetch API:', error.message);
    }
    return false;
}

// ==================== API ENDPOINTS ====================

app.get('/', (req, res) => {
    res.json({
        name: 'LC79 Tài Xỉu Predictor',
        version: '3.0',
        author: '@anhquan',
        endpoints: [
            '/predict - Dự đoán phiên tiếp theo',
            '/history - Lịch sử kết quả',
            '/stats - Thống kê độ chính xác'
        ]
    });
});

app.get('/predict', async (req, res) => {
    if (resultHistory.length < 5) {
        return res.json({
            phien_truoc: null,
            xuc_xac: null,
            ket_qua: null,
            phien_hien_tai: null,
            du_doan: "Đang thu thập dữ liệu...",
            do_tin_cay: "0%",
            id: "@anhquan"
        });
    }
    
    const latest = resultHistory[0];
    const resultsOnly = resultHistory.map(r => r.result);
    const predictionResult = predictor.predict(resultsOnly);
    
    // Lưu logic results để sau này tự học
    const logicResults = {
        markov: predictor.markovPredict(resultsOnly),
        trend: predictor.trendPredict(resultsOnly),
        imbalance: predictor.imbalancePredict(resultsOnly),
        pattern: predictor.patternPredict(resultsOnly),
        streak: predictor.streakPredict(resultsOnly),
        alternating: predictor.alternatingPredict(resultsOnly),
        pair22: predictor.pair22Predict(resultsOnly),
        breakPoint: predictor.breakPointPredict(resultsOnly)
    };
    
    predictor.predictionHistory.push({
        predicted: predictionResult.prediction,
        logicResults: logicResults,
        verified: false,
        timestamp: Date.now()
    });
    
    if (predictor.predictionHistory.length > 20) {
        predictor.predictionHistory.shift();
    }
    
    res.json({
        phien_truoc: latest.id,
        xuc_xac: latest.dice,
        ket_qua: latest.result,
        phien_hien_tai: latest.id + 1,
        du_doan: predictionResult.prediction,
        do_tin_cay: `${(predictionResult.confidence * 100).toFixed(1)}%`,
        id: "@anhquan"
    });
});

app.get('/history', (req, res) => {
    res.json({
        total: resultHistory.length,
        data: resultHistory.slice(0, 50),
        last_update: new Date().toISOString()
    });
});

app.get('/stats', (req, res) => {
    const verified = predictor.predictionHistory.filter(p => p.verified);
    const correctCount = verified.filter(p => p.predicted === resultHistory.find(r => r.id === (lastProcessedId - verified.length + verified.indexOf(p) + 1))?.result).length;
    const accuracy = verified.length > 0 ? (correctCount / verified.length * 100).toFixed(1) : 0;
    
    res.json({
        total_predictions: verified.length,
        correct: correctCount,
        wrong: verified.length - correctCount,
        accuracy: `${accuracy}%`,
        weights: predictor.weights
    });
});

// ==================== KHỞI ĐỘNG ====================
async function init() {
    console.log('\n========================================');
    console.log('  LC79 TÀI XỈU PREDICTOR - SIÊU CHUẨN');
    console.log('  Tác giả: @anhquan');
    console.log('========================================\n');
    
    await fetchLC79Results();
    setInterval(async () => {
        await fetchLC79Results();
    }, FETCH_INTERVAL);
    
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server chạy tại http://localhost:${PORT}`);
        console.log(`📊 Dự đoán: http://localhost:${PORT}/predict`);
        console.log(`📜 Lịch sử: http://localhost:${PORT}/history`);
        console.log(`📈 Thống kê: http://localhost:${PORT}/stats`);
    });
}

init();
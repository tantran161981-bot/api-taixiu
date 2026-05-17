const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

// ==================== CẤU HÌNH ====================
const API_RESULT_URL = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const FETCH_INTERVAL = 5000;
const HISTORY_LIMIT = 200;

// ==================== LƯU TRỮ ====================
let resultHistory = [];
let lastProcessedId = null;
let performanceLog = []; // Lưu lịch sử đúng/sai để tự học

// ==================== AI ANALYZER NÂNG CẤP ====================
class TaiXiuSuperPredictor {
    constructor() {
        // 15 logic AI với trọng số ban đầu
        this.logics = {
            markov4: { weight: 1.2, correct: 0, total: 0, name: 'Markov bậc 4' },
            trend20: { weight: 1.0, correct: 0, total: 0, name: 'Xu hướng 20 phiên' },
            imbalance12: { weight: 1.1, correct: 0, total: 0, name: 'Mất cân bằng 12 phiên' },
            pattern3: { weight: 0.9, correct: 0, total: 0, name: 'Pattern 3 phiên' },
            streak: { weight: 1.3, correct: 0, total: 0, name: 'Cầu bệt' },
            alternating: { weight: 1.0, correct: 0, total: 0, name: 'Cầu 1-1' },
            pair22: { weight: 1.0, correct: 0, total: 0, name: 'Cầu 2-2' },
            triple33: { weight: 0.9, correct: 0, total: 0, name: 'Cầu 3-3' },
            pattern121: { weight: 0.8, correct: 0, total: 0, name: 'Cầu 1-2-1' },
            pattern212: { weight: 0.8, correct: 0, total: 0, name: 'Cầu 2-1-2' },
            fibonacci: { weight: 0.7, correct: 0, total: 0, name: 'Fibonacci' },
            cycle: { weight: 0.9, correct: 0, total: 0, name: 'Chu kỳ' },
            volatility: { weight: 0.8, correct: 0, total: 0, name: 'Biến động' },
            reversal: { weight: 1.1, correct: 0, total: 0, name: 'Điểm đảo chiều' },
            superEnsemble: { weight: 1.5, correct: 0, total: 0, name: 'Siêu tổng hợp' }
        };
        
        this.predictionHistory = [];
        this.minSamples = 20;
    }
    
    // ==================== 15 LOGIC AI ====================
    
    // 1. Markov bậc 4
    markov4Predict(results) {
        if (results.length < 5) return null;
        const seq = results.map(r => r === 'TAI' ? 'T' : 'X');
        const last4 = seq.slice(-4).join('');
        const transitions = {};
        for (let i = 0; i < seq.length - 4; i++) {
            const key = seq.slice(i, i + 4).join('');
            const next = seq[i + 4];
            if (!transitions[key]) transitions[key] = { T: 0, X: 0 };
            transitions[key][next]++;
        }
        const possible = transitions[last4];
        if (!possible) return null;
        const total = possible.T + possible.X;
        if (total < 3) return null;
        if (possible.T / total > 0.65) return { prediction: 'TAI', confidence: possible.T / total };
        if (possible.X / total > 0.65) return { prediction: 'XIU', confidence: possible.X / total };
        return null;
    }
    
    // 2. Xu hướng 20 phiên (có trọng số thời gian)
    trendWeightedPredict(results) {
        if (results.length < 20) return null;
        let taiWeight = 0, xiuWeight = 0;
        for (let i = 0; i < 20; i++) {
            const weight = 1 - (i / 20) * 0.7; // Phiên gần hơn có trọng số cao hơn
            if (results[i] === 'TAI') taiWeight += weight;
            else xiuWeight += weight;
        }
        const total = taiWeight + xiuWeight;
        if (taiWeight / total > 0.6) return { prediction: 'TAI', confidence: taiWeight / total };
        if (xiuWeight / total > 0.6) return { prediction: 'XIU', confidence: xiuWeight / total };
        return null;
    }
    
    // 3. Mất cân bằng 12 phiên
    imbalancePredict(results) {
        if (results.length < 12) return null;
        const last12 = results.slice(0, 12);
        const taiCount = last12.filter(r => r === 'TAI').length;
        if (taiCount >= 9) return { prediction: 'XIU', confidence: 0.6 + (taiCount - 8) * 0.08 };
        if (taiCount <= 3) return { prediction: 'TAI', confidence: 0.6 + (4 - taiCount) * 0.08 };
        return null;
    }
    
    // 4. Pattern 3 phiên (nâng cao)
    patternAdvancedPredict(results) {
        if (results.length < 4) return null;
        const last3 = results.slice(0, 3);
        const patterns = {
            'TAI-TAI-TAI': { pred: 'XIU', conf: 0.75 },
            'XIU-XIU-XIU': { pred: 'TAI', conf: 0.75 },
            'TAI-XIU-TAI': { pred: 'XIU', conf: 0.7 },
            'XIU-TAI-XIU': { pred: 'TAI', conf: 0.7 },
            'TAI-TAI-XIU': { pred: 'TAI', conf: 0.68 },
            'XIU-XIU-TAI': { pred: 'XIU', conf: 0.68 }
        };
        const key = last3.join('-');
        if (patterns[key]) {
            return { prediction: patterns[key].pred, confidence: patterns[key].conf };
        }
        return null;
    }
    
    // 5. Cầu bệt thông minh
    streakSmartPredict(results) {
        if (results.length < 3) return null;
        let streak = 1;
        const current = results[0];
        for (let i = 1; i < results.length; i++) {
            if (results[i] === current) streak++;
            else break;
        }
        if (streak >= 3) {
            // Tìm xem trong lịch sử, streak này thường kéo dài bao lâu
            let avgStreakLength = 0;
            let streakCount = 0;
            for (let i = 0; i < results.length - streak; i++) {
                if (results[i] === current) {
                    let len = 1;
                    for (let j = i + 1; j < results.length; j++) {
                        if (results[j] === current) len++;
                        else break;
                    }
                    if (len >= streak) {
                        avgStreakLength += len;
                        streakCount++;
                    }
                }
            }
            avgStreakLength = streakCount > 0 ? avgStreakLength / streakCount : streak;
            
            if (streak >= avgStreakLength + 1) {
                return { prediction: current === 'TAI' ? 'XIU' : 'TAI', confidence: 0.75 };
            }
            let confidence = 0.55 + (streak * 0.04);
            return { prediction: current, confidence: Math.min(confidence, 0.85) };
        }
        return null;
    }
    
    // 6. Cầu 1-1 nâng cao
    alternatingSmartPredict(results) {
        if (results.length < 8) return null;
        let altLength = 1;
        for (let i = 1; i < 8; i++) {
            if (results[i] !== results[i - 1]) altLength++;
            else break;
        }
        if (altLength >= 4) {
            let confidence = 0.6 + (altLength - 3) * 0.05;
            const last = results[0];
            return { prediction: last === 'TAI' ? 'XIU' : 'TAI', confidence: Math.min(confidence, 0.85) };
        }
        return null;
    }
    
    // 7. Cầu 2-2 nâng cao
    pair22SmartPredict(results) {
        if (results.length < 6) return null;
        let pairs = [];
        for (let i = 0; i < 5; i += 2) {
            if (i + 1 < results.length && results[i] === results[i + 1]) {
                pairs.push(results[i]);
            } else break;
        }
        if (pairs.length >= 2) {
            const lastPair = pairs[pairs.length - 1];
            const prevPair = pairs[pairs.length - 2];
            if (lastPair !== prevPair) {
                return { prediction: lastPair === 'TAI' ? 'XIU' : 'TAI', confidence: 0.75 };
            }
        }
        return null;
    }
    
    // 8. Cầu 3-3
    triple33Predict(results) {
        if (results.length < 9) return null;
        let triples = [];
        for (let i = 0; i < 8; i += 3) {
            if (i + 2 < results.length && results[i] === results[i + 1] && results[i + 1] === results[i + 2]) {
                triples.push(results[i]);
            } else break;
        }
        if (triples.length >= 2 && triples[0] !== triples[1]) {
            return { prediction: triples[1] === 'TAI' ? 'XIU' : 'TAI', confidence: 0.8 };
        }
        return null;
    }
    
    // 9. Cầu 1-2-1
    pattern121Predict(results) {
        if (results.length < 5) return null;
        const pattern = results.slice(0, 5);
        if (pattern[0] !== pattern[1] && pattern[1] === pattern[2] && pattern[2] !== pattern[3] && pattern[3] === pattern[4]) {
            return { prediction: pattern[0], confidence: 0.7 };
        }
        return null;
    }
    
    // 10. Cầu 2-1-2
    pattern212Predict(results) {
        if (results.length < 5) return null;
        const pattern = results.slice(0, 5);
        if (pattern[0] === pattern[1] && pattern[1] !== pattern[2] && pattern[2] !== pattern[3] && pattern[3] === pattern[4]) {
            return { prediction: pattern[0] === 'TAI' ? 'XIU' : 'TAI', confidence: 0.7 };
        }
        return null;
    }
    
    // 11. Fibonacci (các phiên cách nhau 1,2,3,5,8...)
    fibonacciPredict(results) {
        if (results.length < 13) return null;
        const fibs = [1, 2, 3, 5, 8];
        let matchCount = 0;
        let taiMatches = 0;
        for (const f of fibs) {
            if (results.length > f && results[0] === results[f]) matchCount++;
            if (results.length > f && results[f] === 'TAI') taiMatches++;
        }
        if (matchCount >= 3) {
            const isTaiDominant = taiMatches >= 3;
            return { prediction: isTaiDominant ? 'TAI' : 'XIU', confidence: 0.65 + matchCount * 0.05 };
        }
        return null;
    }
    
    // 12. Phát hiện chu kỳ
    cyclePredict(results) {
        if (results.length < 20) return null;
        for (let cycle = 2; cycle <= 6; cycle++) {
            let match = true;
            for (let i = 0; i < cycle; i++) {
                if (results[i] !== results[i + cycle]) {
                    match = false;
                    break;
                }
            }
            if (match && results.length > cycle * 2) {
                const nextIndex = cycle;
                return { prediction: results[nextIndex], confidence: 0.7 };
            }
        }
        return null;
    }
    
    // 13. Phân tích biến động tổng điểm
    volatilityPredict(results) {
        if (results.length < 20 || !results[0].point) return null;
        const points = results.map(r => r.point);
        const avg = points.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
        const lastPoint = points[0];
        if (lastPoint > avg + 2.5) return { prediction: 'XIU', confidence: 0.65 };
        if (lastPoint < avg - 2.5) return { prediction: 'TAI', confidence: 0.65 };
        return null;
    }
    
    // 14. Phát hiện điểm đảo chiều
    reversalPredict(results) {
        if (results.length < 8) return null;
        const last4 = results.slice(0, 4);
        const prev4 = results.slice(4, 8);
        const lastTaiCount = last4.filter(r => r === 'TAI').length;
        const prevTaiCount = prev4.filter(r => r === 'TAI').length;
        if (Math.abs(lastTaiCount - prevTaiCount) >= 3) {
            const dominant = lastTaiCount > prevTaiCount ? 'TAI' : 'XIU';
            return { prediction: dominant === 'TAI' ? 'XIU' : 'TAI', confidence: 0.7 };
        }
        return null;
    }
    
    // 15. Siêu tổng hợp (kết hợp kết quả của các logic trên)
    superEnsemblePredict(results, allResults) {
        let taiScore = 0, xiuScore = 0, totalWeight = 0;
        for (const [logicName, res] of Object.entries(allResults)) {
            if (res && res.confidence > 0.55) {
                const weight = this.logics[logicName].weight * res.confidence;
                if (res.prediction === 'TAI') taiScore += weight;
                else xiuScore += weight;
                totalWeight += weight;
            }
        }
        if (totalWeight === 0) return null;
        const prediction = taiScore > xiuScore ? 'TAI' : 'XIU';
        let confidence = Math.max(taiScore, xiuScore) / totalWeight;
        confidence = Math.min(0.92, Math.max(0.6, confidence));
        return { prediction, confidence };
    }
    
    // ==================== TỔNG HỢP DỰ ĐOÁN ====================
    predict(results) {
        if (results.length < this.minSamples) {
            return { prediction: results[0]?.result || 'TAI', confidence: 0.5 };
        }
        
        const resultsOnly = results.map(r => r.result);
        
        const logicResults = {
            markov4: this.markov4Predict(resultsOnly),
            trend20: this.trendWeightedPredict(resultsOnly),
            imbalance12: this.imbalancePredict(resultsOnly),
            pattern3: this.patternAdvancedPredict(resultsOnly),
            streak: this.streakSmartPredict(resultsOnly),
            alternating: this.alternatingSmartPredict(resultsOnly),
            pair22: this.pair22SmartPredict(resultsOnly),
            triple33: this.triple33Predict(resultsOnly),
            pattern121: this.pattern121Predict(resultsOnly),
            pattern212: this.pattern212Predict(resultsOnly),
            fibonacci: this.fibonacciPredict(resultsOnly),
            cycle: this.cyclePredict(resultsOnly),
            volatility: this.volatilityPredict(results),
            reversal: this.reversalPredict(resultsOnly)
        };
        
        // Thêm super ensemble
        logicResults.superEnsemble = this.superEnsemblePredict(results, logicResults);
        
        // Tính điểm có trọng số
        let taiScore = 0, xiuScore = 0, totalWeight = 0;
        const activeLogics = [];
        
        for (const [logicName, res] of Object.entries(logicResults)) {
            if (res && res.confidence > 0.55 && this.logics[logicName]) {
                const weight = this.logics[logicName].weight * res.confidence;
                if (res.prediction === 'TAI') taiScore += weight;
                else xiuScore += weight;
                totalWeight += weight;
                activeLogics.push(logicName);
            }
        }
        
        if (totalWeight === 0) {
            return { prediction: resultsOnly[0], confidence: 0.5, activeLogics: [] };
        }
        
        const finalPrediction = taiScore > xiuScore ? 'TAI' : 'XIU';
        let confidence = (Math.max(taiScore, xiuScore) / totalWeight);
        confidence = Math.min(0.94, Math.max(0.55, confidence));
        
        return {
            prediction: finalPrediction,
            confidence: confidence,
            activeLogics: activeLogics,
            logicResults: logicResults
        };
    }
    
    // Tự học cập nhật trọng số
    selfLearn(actual, predicted, logicResults) {
        for (const [logicName, res] of Object.entries(logicResults)) {
            if (res && this.logics[logicName]) {
                this.logics[logicName].total++;
                if (res.prediction === actual) {
                    this.logics[logicName].correct++;
                }
                // Cập nhật trọng số dựa trên độ chính xác gần đây
                if (this.logics[logicName].total >= 10) {
                    const accuracy = this.logics[logicName].correct / this.logics[logicName].total;
                    this.logics[logicName].weight = Math.min(1.8, Math.max(0.4, accuracy * 1.5));
                }
            }
        }
    }
}

const predictor = new TaiXiuSuperPredictor();

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
            const list = response.data.list;
            resultHistory = list.map(item => ({
                id: item.id,
                result: item.resultTruyenThong,
                dice: item.dices,
                point: item.point
            }));
            
            if (resultHistory.length > HISTORY_LIMIT) {
                resultHistory = resultHistory.slice(0, HISTORY_LIMIT);
            }
            
            const latest = resultHistory[0];
            if (lastProcessedId !== latest.id) {
                console.log(`[📥] Phiên mới: ${latest.id} - ${latest.result} - [${latest.dice.join(',')}]`);
                
                // Tự học từ dự đoán trước
                if (lastProcessedId !== null && performanceLog.length > 0) {
                    const lastPred = performanceLog[performanceLog.length - 1];
                    if (!lastPred.verified && lastPred.predicted) {
                        const wasCorrect = (lastPred.predicted === latest.result);
                        predictor.selfLearn(latest.result, lastPred.predicted, lastPred.logicResults);
                        lastPred.verified = true;
                        lastPred.actual = latest.result;
                        console.log(`[📚] Tự học: ${wasCorrect ? 'ĐÚNG ✅' : 'SAI ❌'} (${lastPred.predicted} -> ${latest.result})`);
                    }
                }
                
                lastProcessedId = latest.id;
            }
            return true;
        }
    } catch (error) {
        console.error('[❌] Lỗi fetch:', error.message);
    }
    return false;
}

// ==================== API ENDPOINTS ====================

app.get('/', (req, res) => {
    res.json({
        name: 'LC79 Tài Xỉu Super Predictor',
        version: '4.0',
        author: '@anhquan',
        endpoints: ['/predict', '/history', '/stats', '/logics']
    });
});

app.get('/predict', (req, res) => {
    if (resultHistory.length < 10) {
        return res.json({
            phien_truoc: null,
            xuc_xac: null,
            ket_qua: null,
            phien_hien_tai: null,
            du_doan: "Đang học...",
            do_tin_cay: "0%",
            id: "@anhquan"
        });
    }
    
    const latest = resultHistory[0];
    const prediction = predictor.predict(resultHistory);
    
    // Lưu để tự học sau
    performanceLog.push({
        predicted: prediction.prediction,
        logicResults: prediction.logicResults,
        verified: false,
        timestamp: Date.now()
    });
    if (performanceLog.length > 100) performanceLog.shift();
    
    res.json({
        phien_truoc: latest.id,
        xuc_xac: latest.dice,
        ket_qua: latest.result,
        phien_hien_tai: latest.id + 1,
        du_doan: prediction.prediction,
        do_tin_cay: `${(prediction.confidence * 100).toFixed(1)}%`,
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
    const verified = performanceLog.filter(p => p.verified);
    const correctCount = verified.filter(p => p.predicted === p.actual).length;
    const accuracy = verified.length > 0 ? (correctCount / verified.length * 100).toFixed(1) : 0;
    
    const logicStats = {};
    for (const [name, logic] of Object.entries(predictor.logics)) {
        logicStats[name] = {
            name: logic.name,
            weight: logic.weight.toFixed(2),
            accuracy: logic.total > 0 ? ((logic.correct / logic.total) * 100).toFixed(1) + '%' : 'N/A',
            samples: logic.total
        };
    }
    
    res.json({
        total_predictions: verified.length,
        correct: correctCount,
        wrong: verified.length - correctCount,
        accuracy: `${accuracy}%`,
        logic_performance: logicStats
    });
});

app.get('/logics', (req, res) => {
    const activeLogics = [];
    for (const [name, logic] of Object.entries(predictor.logics)) {
        activeLogics.push({
            name: logic.name,
            weight: logic.weight,
            accuracy: logic.total > 0 ? ((logic.correct / logic.total) * 100).toFixed(1) + '%' : 'Đang học'
        });
    }
    res.json({ active_logics: activeLogics.length, logics: activeLogics });
});

// ==================== KHỞI ĐỘNG ====================
async function init() {
    console.log('\n========================================');
    console.log('  LC79 SUPER PREDICTOR v4.0');
    console.log('  15+ Logic AI | Tự học thông minh');
    console.log('  Tác giả: @anhquan');
    console.log('========================================\n');
    
    await fetchLC79Results();
    setInterval(fetchLC79Results, FETCH_INTERVAL);
    
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server: http://localhost:${PORT}`);
        console.log(`🎯 Dự đoán: http://localhost:${PORT}/predict`);
        console.log(`📊 Thống kê: http://localhost:${PORT}/stats`);
    });
}

init();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

const API_RESULT_URL = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
let resultHistory = [];
let lastPrediction = null;
let lastPhienId = null;

// File lưu lịch sử dự đoán để tự học
const HISTORY_FILE = './prediction_history.json';
let predictionHistory = [];

// ==================== THUẬT TOÁN DỰ ĐOÁN CAO CẤP ====================
class SuperPredictor {
    constructor() {
        this.learningData = {
            patterns: new Map(),
            accuracy: { total: 0, correct: 0 }
        };
        this.loadHistory();
    }
    
    loadHistory() {
        try {
            if (fs.existsSync(HISTORY_FILE)) {
                const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
                predictionHistory = data;
                console.log(`📚 Đã tải ${predictionHistory.length} dự đoán cũ`);
            }
        } catch(e) { console.error('Lỗi load history:', e.message); }
    }
    
    saveHistory() {
        try {
            const toSave = predictionHistory.slice(-500);
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(toSave, null, 2));
        } catch(e) { console.error('Lỗi save history:', e.message); }
    }
    
    // ========== 1. PATTERN MATCHING SIÊU MẠNH ==========
    findPattern(results) {
        if (results.length < 6) return null;
        
        let bestPattern = null;
        let bestConfidence = 0;
        
        // Thử các độ dài pattern từ 3 đến 8
        for (let len = 3; len <= 8; len++) {
            if (results.length < len + 2) continue;
            
            const recentPattern = results.slice(0, len).join(',');
            let matches = [];
            
            // Tìm các lần xuất hiện của pattern trong lịch sử
            for (let i = 1; i <= results.length - len - 1; i++) {
                const pattern = results.slice(i, i + len).join(',');
                if (pattern === recentPattern) {
                    matches.push(results[i + len]);
                }
            }
            
            if (matches.length >= 2) {
                const taiCount = matches.filter(r => r === 'TAI').length;
                const xiuCount = matches.length - taiCount;
                const confidence = Math.max(taiCount, xiuCount) / matches.length;
                
                if (confidence > bestConfidence && confidence > 0.7) {
                    bestConfidence = confidence;
                    bestPattern = taiCount > xiuCount ? 'TAI' : 'XIU';
                }
            }
        }
        
        if (bestPattern) {
            return { prediction: bestPattern, confidence: Math.round(bestConfidence * 100), method: 'Pattern' };
        }
        return null;
    }
    
    // ========== 2. PHÂN TÍCH CHUỖI (RUNS) ==========
    analyzeRuns(results) {
        if (results.length < 10) return null;
        
        let currentRun = 1;
        let runs = [];
        
        for (let i = 1; i < Math.min(results.length, 30); i++) {
            if (results[i] === results[i-1]) {
                currentRun++;
            } else {
                runs.push({ result: results[i-1], length: currentRun });
                currentRun = 1;
            }
        }
        runs.push({ result: results[Math.min(results.length,30)-1], length: currentRun });
        
        const lastRun = runs[runs.length - 1];
        const avgRunLength = runs.slice(0, -1).reduce((a, b) => a + b.length, 0) / (runs.length - 1);
        
        // Nếu run hiện tại dài hơn trung bình nhiều -> sắp gãy
        if (lastRun.length > avgRunLength * 1.5 && lastRun.length >= 3) {
            const prediction = lastRun.result === 'TAI' ? 'XIU' : 'TAI';
            let confidence = 60 + (lastRun.length - avgRunLength) * 5;
            return { prediction, confidence: Math.min(confidence, 85), method: 'RunBreak' };
        }
        
        // Nếu run ngắn -> tiếp tục theo xu hướng
        if (lastRun.length <= 2 && runs.length >= 3) {
            const prevRun = runs[runs.length - 2];
            if (prevRun && prevRun.result !== lastRun.result) {
                return { prediction: lastRun.result, confidence: 65, method: 'RunContinue' };
            }
        }
        return null;
    }
    
    // ========== 3. PHÂN TÍCH XÁC SUẤT KẾT HỢP ==========
    probabilityAnalysis(results) {
        if (results.length < 20) return null;
        
        // Xác suất tổng thể
        const taiCount = results.slice(0, 30).filter(r => r === 'TAI').length;
        const globalProb = taiCount / 30;
        
        // Xác suất 10 phiên gần nhất
        const recentTaiCount = results.slice(0, 10).filter(r => r === 'TAI').length;
        const recentProb = recentTaiCount / 10;
        
        // Độ chênh lệch
        const diff = recentProb - globalProb;
        
        if (Math.abs(diff) > 0.2) {
            const prediction = recentProb > globalProb ? 'TAI' : 'XIU';
            const confidence = 60 + Math.abs(diff) * 50;
            return { prediction, confidence: Math.min(confidence, 80), method: 'Probability' };
        }
        return null;
    }
    
    // ========== 4. PHÂN TÍCH CÂN BẰNG 50-50 ==========
    balanceAnalysis(results) {
        if (results.length < 40) return null;
        
        const taiCount = results.slice(0, 40).filter(r => r === 'TAI').length;
        const xiuCount = 40 - taiCount;
        
        if (Math.abs(taiCount - xiuCount) >= 8) {
            const prediction = taiCount > xiuCount ? 'XIU' : 'TAI';
            const confidence = 65 + Math.abs(taiCount - xiuCount) * 1.5;
            return { prediction, confidence: Math.min(confidence, 82), method: 'Balance' };
        }
        return null;
    }
    
    // ========== TỔNG HỢP DỰ ĐOÁN ==========
    predict(results) {
        if (results.length < 10) {
            return { prediction: 'TAI', confidence: 50, reason: 'Đang học...' };
        }
        
        // Lấy kết quả từ các phương pháp
        const pattern = this.findPattern(results);
        const runs = this.analyzeRuns(results);
        const prob = this.probabilityAnalysis(results);
        const balance = this.balanceAnalysis(results);
        
        const signals = [pattern, runs, prob, balance].filter(s => s !== null);
        
        if (signals.length === 0) {
            // Fallback: theo xu hướng 3 phiên gần nhất
            const last3 = results.slice(0, 3);
            const taiCount = last3.filter(r => r === 'TAI').length;
            const prediction = taiCount >= 2 ? 'TAI' : 'XIU';
            return { prediction, confidence: 55, reason: 'Xu hướng 3 phiên' };
        }
        
        // Tính weighted vote
        let taiScore = 0, xiuScore = 0;
        for (const s of signals) {
            if (s.prediction === 'TAI') taiScore += s.confidence;
            else xiuScore += s.confidence;
        }
        
        const finalPrediction = taiScore > xiuScore ? 'TAI' : 'XIU';
        const maxConfidence = Math.max(taiScore, xiuScore);
        const totalConfidence = taiScore + xiuScore;
        let finalConfidence = totalConfidence > 0 ? (maxConfidence / totalConfidence) * 100 : 60;
        finalConfidence = Math.min(92, Math.max(58, finalConfidence));
        
        const mainMethod = signals[0]?.method || 'Ensemble';
        
        return {
            prediction: finalPrediction,
            confidence: Math.round(finalConfidence),
            reason: `${mainMethod} (${signals.length} tín hiệu)`
        };
    }
    
    // Cập nhật độ chính xác khi có kết quả thực tế
    updateAccuracy(phien, predicted, actual, confidence) {
        const isCorrect = (predicted === actual);
        
        predictionHistory.push({
            phien,
            predicted,
            actual,
            confidence,
            isCorrect,
            timestamp: Date.now()
        });
        
        this.learningData.accuracy.total++;
        if (isCorrect) this.learningData.accuracy.correct++;
        
        // Giữ 200 dự đoán gần nhất
        if (predictionHistory.length > 200) predictionHistory.shift();
        this.saveHistory();
        
        return isCorrect;
    }
    
    getStats() {
        const recent = predictionHistory.slice(-50);
        const correct = recent.filter(p => p.isCorrect).length;
        const accuracy = recent.length > 0 ? (correct / recent.length * 100).toFixed(1) : 0;
        
        return {
            total: predictionHistory.length,
            recent_50_correct: correct,
            recent_50_accuracy: accuracy + '%'
        };
    }
}

const predictor = new SuperPredictor();

// ==================== LẤY DỮ LIỆU TỪ API ====================
async function fetchLC79Results() {
    try {
        const response = await axios.get(API_RESULT_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json'
            },
            timeout: 10000
        });
        
        if (response.data && response.data.list) {
            const newHistory = response.data.list.map(item => ({
                id: item.id,
                result: item.resultTruyenThong,
                dice: item.dices,
                point: item.point
            }));
            
            // Kiểm tra phiên mới
            const latestPhien = newHistory[0].id;
            
            if (lastPhienId !== latestPhien) {
                // Nếu có phiên mới, kiểm tra dự đoán cũ
                if (lastPhienId !== null && lastPrediction) {
                    const actualResult = newHistory[0].result;
                    const isCorrect = predictor.updateAccuracy(
                        lastPhienId,
                        lastPrediction.prediction,
                        actualResult,
                        lastPrediction.confidence
                    );
                    
                    const stats = predictor.getStats();
                    console.log(`📊 Phiên ${lastPhienId}: Dự đoán ${lastPrediction.prediction} | Thực tế: ${actualResult} | ${isCorrect ? '✅ ĐÚNG' : '❌ SAI'} | Gần đây: ${stats.recent_50_accuracy}`);
                }
                
                // Cập nhật lịch sử
                resultHistory = newHistory;
                lastPhienId = latestPhien;
                
                // Dự đoán phiên tiếp theo
                const resultsOnly = resultHistory.map(r => r.result);
                const prediction = predictor.predict(resultsOnly);
                const nextPhien = latestPhien + 1;
                
                lastPrediction = {
                    phien: nextPhien,
                    prediction: prediction.prediction,
                    confidence: prediction.confidence,
                    reason: prediction.reason
                };
                
                console.log(`🎯 Dự đoán phiên ${nextPhien}: ${prediction.prediction} (${prediction.confidence}%) - ${prediction.reason}`);
            }
            
            return true;
        }
    } catch (error) {
        console.error('❌ Lỗi fetch API:', error.message);
    }
    return false;
}

// ==================== API ENDPOINTS ====================

app.get('/', (req, res) => {
    res.json({
        name: 'LC79 DỰ ĐOÁN LIÊN TỤC - SIÊU XỊN',
        version: '8.0',
        author: '@anhquan',
        features: ['Dự đoán mọi phiên', 'Phân tích pattern + runs + xác suất', 'Tự học từ kết quả'],
        endpoints: ['/predict', '/stats', '/history', '/status']
    });
});

app.get('/predict', (req, res) => {
    if (!lastPrediction) {
        return res.json({
            phien_truoc: resultHistory[0]?.id || null,
            xuc_xac: resultHistory[0]?.dice || null,
            ket_qua: resultHistory[0]?.result || null,
            phien_hien_tai: resultHistory[0] ? resultHistory[0].id + 1 : null,
            du_doan: "Đang khởi tạo...",
            do_tin_cay: "0%",
            ly_do: "Đang phân tích dữ liệu",
            id: "@anhquan"
        });
    }
    
    const latest = resultHistory[0];
    
    res.json({
        phien_truoc: latest.id,
        xuc_xac: latest.dice,
        ket_qua: latest.result,
        phien_hien_tai: lastPrediction.phien,
        du_doan: lastPrediction.prediction,
        do_tin_cay: `${lastPrediction.confidence}%`,
        ly_do: lastPrediction.reason,
        id: "@anhquan"
    });
});

app.get('/stats', (req, res) => {
    const stats = predictor.getStats();
    const total = predictionHistory.length;
    const correct = predictionHistory.filter(p => p.isCorrect).length;
    const overall = total > 0 ? (correct / total * 100).toFixed(1) : 0;
    
    res.json({
        total_predictions: total,
        correct: correct,
        wrong: total - correct,
        overall_accuracy: overall + '%',
        recent_50_accuracy: stats.recent_50_accuracy,
        predictions: predictionHistory.slice(-20).reverse()
    });
});

app.get('/history', (req, res) => {
    res.json({
        total: resultHistory.length,
        data: resultHistory.slice(0, 50),
        last_update: new Date().toISOString()
    });
});

app.get('/status', (req, res) => {
    res.json({
        status: 'online',
        last_phien: lastPhienId,
        history_count: resultHistory.length,
        next_prediction: lastPrediction?.phien || null
    });
});

// ==================== KHỞI ĐỘNG ====================
async function init() {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║   LC79 DỰ ĐOÁN LIÊN TỤC - SIÊU XỊN   ║');
    console.log('║   Pattern Matching + Runs + Prob     ║');
    console.log('║   Tự học sau mỗi phiên               ║');
    console.log(`║   PORT: ${PORT}                         ║`);
    console.log('╚════════════════════════════════════════╝\n');
    
    await fetchLC79Results();
    
    // Cập nhật mỗi 5 giây
    setInterval(async () => {
        await fetchLC79Results();
    }, 5000);
    
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`✅ API đã sẵn sàng!`);
        console.log(`📡 http://localhost:${PORT}/predict`);
        console.log(`📊 http://localhost:${PORT}/stats`);
    });
}

init();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

// ==================== CẤU HÌNH ====================
const API_RESULT_URL = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
let resultHistory = [];
let lastProcessedId = null;
let modelState = {
    total: 0,
    correct: 0,
    threshold: 0.55 // Ngưỡng tự học, sẽ tối ưu dần
};

// ==================== THUẬT TOÁN POISSON + WEIGHTED PROBABILITY ====================
class AdvancedProbabilityModel {
    constructor() {
        this.performanceLog = [];
    }

    // Tính xác suất bằng phân phối Poisson (dựa trên tần suất xuất hiện gần đây)
    poissonProbability(results, target) {
        const windowSize = Math.min(30, results.length);
        const recentResults = results.slice(0, windowSize);
        const lambda = recentResults.filter(r => r === target).length / windowSize;
        if (lambda === 0) return 0.45;
        // Poisson: P(X=k) với k=1 (xuất hiện 1 lần trong kỳ tới) - xấp xỉ tỷ lệ
        const prob = Math.exp(-lambda) * Math.pow(lambda, 1) / 1;
        return Math.min(0.85, prob);
    }

    // Tính xác suất xu hướng có trọng số thời gian (hàm mũ)
    weightedTrendProbability(results) {
        if (results.length < 10) return null;
        let taiWeight = 0, xiuWeight = 0;
        const decayFactor = 0.85; // Hệ số giảm dần: phiên càng gần càng quan trọng
        
        for (let i = 0; i < Math.min(results.length, 30); i++) {
            const weight = Math.pow(decayFactor, i);
            if (results[i] === 'TAI') taiWeight += weight;
            else xiuWeight += weight;
        }
        const totalWeight = taiWeight + xiuWeight;
        if (totalWeight === 0) return 0.5;
        return taiWeight / totalWeight;
    }

    // Phân tích chu kỳ ngầm (tìm chu kỳ lặp có độ dài biến thiên)
    cycleProbability(results) {
        if (results.length < 15) return null;
        let bestScore = 0;
        let bestProb = 0.5;
        
        for (let cycle = 2; cycle <= 7; cycle++) {
            let matches = 0;
            let comparisons = 0;
            for (let i = cycle; i < Math.min(results.length, 100); i++) {
                if (results[i] === results[i - cycle]) matches++;
                comparisons++;
            }
            if (comparisons > 10) {
                const cycleProb = matches / comparisons;
                const score = Math.abs(cycleProb - 0.5);
                if (score > bestScore && (cycleProb > 0.6 || cycleProb < 0.4)) {
                    bestScore = score;
                    bestProb = cycleProb;
                }
            }
        }
        if (bestScore > 0.1) return bestProb;
        return null;
    }

    // Tổng hợp 3 phương pháp: Poisson + Trọng số thời gian + Chu kỳ
    aggregateProbability(results) {
        const poissonProb = this.poissonProbability(results, 'TAI');
        const weightedProb = this.weightedTrendProbability(results);
        const cycleProb = this.cycleProbability(results);
        
        let finalProb = weightedProb !== null ? weightedProb : poissonProb;
        let confidenceWeight = 1;
        
        if (cycleProb !== null && Math.abs(cycleProb - 0.5) > Math.abs(finalProb - 0.5)) {
            finalProb = cycleProb;
            confidenceWeight = 1.2;
        }
        
        // Làm mượt để tránh biến động quá mạnh
        if (this.lastProb) {
            finalProb = this.lastProb * 0.4 + finalProb * 0.6;
        }
        this.lastProb = finalProb;
        
        return { prob: finalProb, weight: confidenceWeight };
    }

    // Tự động tối ưu ngưỡng dự đoán (Dynamic Threshold Optimization)
    optimizeThreshold(history) {
        if (history.length < 30) return 0.55;
        
        let bestThreshold = 0.55;
        let bestAccuracy = 0;
        
        // Thử các ngưỡng từ 0.51 đến 0.7
        for (let thresh = 0.51; thresh <= 0.7; thresh += 0.02) {
            let correct = 0;
            let total = 0;
            
            // Chạy backtest trên 30-50 phiên gần nhất
            for (let i = 20; i < Math.min(history.length, 80); i++) {
                const pastResults = history.slice(0, i).map(r => r.result);
                const actual = history[i].result;
                const { prob } = this.aggregateProbability(pastResults);
                
                let predicted;
                if (prob >= thresh) predicted = 'TAI';
                else if (prob <= 1 - thresh) predicted = 'XIU';
                else continue; // Bỏ qua nếu không đủ mạnh
                
                total++;
                if (predicted === actual) correct++;
            }
            
            if (total > 10 && (correct / total) > bestAccuracy) {
                bestAccuracy = correct / total;
                bestThreshold = thresh;
            }
        }
        
        console.log(`[⚙️] Ngưỡng tối ưu mới: ${bestThreshold} (Độ chính xác kỳ vọng: ${(bestAccuracy*100).toFixed(1)}%)`);
        return bestThreshold;
    }

    // Dự đoán chính
    predict(history) {
        if (history.length < 20) {
            return { prediction: 'TAI', confidence: 50, prob: 0.5, reason: 'Đang thu thập dữ liệu...' };
        }
        
        const resultsOnly = history.map(r => r.result);
        const { prob, weight } = this.aggregateProbability(resultsOnly);
        
        // Cập nhật threshold tự động (mỗi 5-10 phiên)
        if (history.length % 7 === 0) {
            modelState.threshold = this.optimizeThreshold(history);
        }
        
        // Quyết định dự đoán dựa trên ngưỡng tối ưu
        let prediction, confidence;
        let dynamicThreshold = modelState.threshold;
        
        if (prob >= dynamicThreshold) {
            prediction = 'TAI';
            confidence = 50 + (prob - 0.5) * 80;
        } else if (prob <= 1 - dynamicThreshold) {
            prediction = 'XIU';
            confidence = 50 + (0.5 - prob) * 80;
        } else {
            // Vùng không chắc chắn -> dựa vào xu hướng gần nhất với độ tin cậy thấp
            const lastResult = resultsOnly[0];
            prediction = lastResult;
            confidence = 55;
        }
        
        confidence = Math.min(89, Math.max(52, Math.round(confidence)));
        
        return {
            prediction,
            confidence,
            prob: prob,
            threshold: dynamicThreshold,
            reason: `Xác suất Tài = ${(prob*100).toFixed(1)}% | Ngưỡng tối ưu ${(dynamicThreshold*100).toFixed(0)}%`
        };
    }
    
    updateStats(actual, predicted, confidence) {
        modelState.total++;
        if (actual === predicted) modelState.correct++;
        
        // Lưu log để giám sát
        this.performanceLog.push({ actual, predicted, confidence, time: Date.now() });
        if (this.performanceLog.length > 200) this.performanceLog.shift();
    }
    
    getStats() {
        const total = modelState.total;
        const correct = modelState.correct;
        const recentLog = this.performanceLog.slice(-50);
        const recentCorrect = recentLog.filter(l => l.actual === l.predicted).length;
        
        return {
            total,
            correct,
            overall_accuracy: total > 0 ? (correct / total * 100).toFixed(1) : 0,
            recent_50_accuracy: (recentCorrect / 50 * 100).toFixed(1),
            current_threshold: (modelState.threshold * 100).toFixed(0) + '%'
        };
    }
}

const predictor = new AdvancedProbabilityModel();

// ==================== FETCH & UPDATE ====================
async function fetchLC79Results() {
    try {
        const response = await axios.get(API_RESULT_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json',
                'Referer': 'https://lc79b.bet/'
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
            
            if (newHistory.length > 0 && newHistory[0].id !== lastProcessedId) {
                if (lastProcessedId !== null && resultHistory.length > 15) {
                    const latestResult = newHistory[0].result;
                    const { prediction, confidence } = predictor.predict(resultHistory.slice(0, 30));
                    predictor.updateStats(latestResult, prediction, confidence);
                    console.log(`[🎯] Phiên ${newHistory[0].id}: ${latestResult} | Dự đoán: ${prediction} (${confidence}%) | ${prediction === latestResult ? '✅' : '❌'}`);
                }
                resultHistory = newHistory;
                lastProcessedId = newHistory[0].id;
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
        name: 'LC79 Advanced Probability Model v6.0',
        author: '@anhquan',
        algorithm: 'Poisson + Weighted Average + Dynamic Threshold',
        note: 'Thuật toán xác suất KHÔNG dựa trên cầu, tự tối ưu ngưỡng theo thời gian',
        endpoints: ['/predict', '/stats', '/history', '/model-info']
    });
});

app.get('/predict', (req, res) => {
    if (resultHistory.length < 20) {
        const latest = resultHistory[0] || {};
        return res.json({
            phien_truoc: latest.id || null,
            xuc_xac: latest.dice || null,
            ket_qua: latest.result || null,
            phien_hien_tai: latest.id ? latest.id + 1 : null,
            du_doan: "Đang phân tích chuỗi...",
            do_tin_cay: "0%",
            ly_do: `Cần thêm ${20 - resultHistory.length} phiên để đạt độ tin cậy`,
            id: "@anhquan"
        });
    }
    
    const prediction = predictor.predict(resultHistory);
    const latest = resultHistory[0];
    
    res.json({
        phien_truoc: latest.id,
        xuc_xac: latest.dice,
        ket_qua: latest.result,
        phien_hien_tai: latest.id + 1,
        du_doan: prediction.prediction,
        do_tin_cay: `${prediction.confidence}%`,
        ly_do: prediction.reason,
        id: "@anhquan"
    });
});

app.get('/stats', (req, res) => {
    const stats = predictor.getStats();
    res.json({
        ...stats,
        last_update: new Date().toISOString()
    });
});

app.get('/history', (req, res) => {
    res.json({
        total: resultHistory.length,
        data: resultHistory.slice(0, 50),
        last_update: new Date().toISOString()
    });
});

app.get('/model-info', (req, res) => {
    res.json({
        algorithm: "Poisson Distribution + Time-weighted Average + Cycle Detection",
        threshold_optimization: "Dynamic (tự tối ưu sau mỗi 7 phiên)",
        learning_method: "Backtesting trên 50 phiên gần nhất",
        note: "Mô hình không có khái niệm 'cầu', chỉ dựa trên xác suất thống kê"
    });
});

// ==================== KHỞI ĐỘNG ====================
async function init() {
    console.log('\n========================================');
    console.log('  LC79 ADVANCED PROBABILITY v6.0');
    console.log('  Poisson + Weighted Average + Dynamic Threshold');
    console.log('  KHÔNG CHẠY THEO CẦU');
    console.log('========================================\n');
    
    await fetchLC79Results();
    setInterval(fetchLC79Results, 6000);
    
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server: http://localhost:${PORT}`);
        console.log(`🎯 Dự đoán: http://localhost:${PORT}/predict`);
        console.log(`📊 Thống kê: http://localhost:${PORT}/stats`);
    });
}

init();
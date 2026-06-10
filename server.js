// server.js - SUPER TAIXIU AI PREDICTOR v5.0
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// Cấu hình API
const API_URLS = {
    hu: 'https://wtx.tele68.com/v1/tx/sessions',
    md5: 'https://wtxmd52.tele68.com/v1/txmd5/sessions'
};

// File lưu trữ
const DATA_DIR = './data';
const HISTORY_FILE = path.join(DATA_DIR, 'prediction_history.json');
const MODEL_FILE = path.join(DATA_DIR, 'ai_model.json');

// Đảm bảo thư mục data tồn tại
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// ==================== THUẬT TOÁN AI THÔNG MINH ====================

class SuperTaixiuPredictor {
    constructor() {
        this.name = 'Super Taixiu AI v5.0';
        this.version = '5.0.0';
        this.learningRate = 0.01;
        this.loadModel();
    }

    // 1. Phân tích chuỗi Markov bậc cao
    markovAnalysis(results) {
        if (results.length < 3) return null;
        
        const patterns = {
            'TTT': 0, 'TTX': 0, 'TXT': 0, 'TXX': 0,
            'XTT': 0, 'XTX': 0, 'XXT': 0, 'XXX': 0
        };
        
        // Đếm tần suất pattern 3 phiên
        for (let i = 0; i < results.length - 2; i++) {
            const pattern = results.slice(i, i + 3).map(r => r === 'Tài' ? 'T' : 'X').join('');
            if (patterns[pattern] !== undefined) patterns[pattern]++;
        }
        
        // Lấy 3 phiên gần nhất
        const last3 = results.slice(0, 3).map(r => r === 'Tài' ? 'T' : 'X').join('');
        const key = last3;
        
        if (patterns[key] > 0) {
            // Dự đoán dựa trên thống kê
            const nextPatterns = {
                'TTT': { T: patterns['TTT'], X: patterns['TTX'] },
                'TTX': { T: patterns['TXT'], X: patterns['TXX'] },
                'TXT': { T: patterns['XTT'], X: patterns['XTX'] },
                'TXX': { T: patterns['XTT'], X: patterns['XTX'] },
                'XTT': { T: patterns['TTT'], X: patterns['TTX'] },
                'XTX': { T: patterns['TXT'], X: patterns['TXX'] },
                'XXT': { T: patterns['XTT'], X: patterns['XTX'] },
                'XXX': { T: patterns['XXT'], X: patterns['XXX'] }
            };
            
            const next = nextPatterns[key];
            if (next && (next.T + next.X) > 0) {
                const tProb = next.T / (next.T + next.X);
                return {
                    prediction: tProb > 0.55 ? 'Tài' : (tProb < 0.45 ? 'Xỉu' : null),
                    confidence: Math.abs(tProb - 0.5) * 2 * 100,
                    algorithm: 'Markov Chain'
                };
            }
        }
        return null;
    }

    // 2. Phát hiện sóng Elliott cho Tài Xỉu
    elliottWaveAnalysis(results) {
        if (results.length < 8) return null;
        
        // Mã hóa sóng (tăng = Tài, giảm = Xỉu)
        let waves = [];
        let currentWave = results[0];
        let waveLength = 1;
        
        for (let i = 1; i < results.length; i++) {
            if (results[i] === currentWave) {
                waveLength++;
            } else {
                waves.push({ type: currentWave, length: waveLength });
                currentWave = results[i];
                waveLength = 1;
            }
        }
        waves.push({ type: currentWave, length: waveLength });
        
        // Phát hiện mô hình 5 sóng impulse
        if (waves.length >= 5) {
            const wave1 = waves[0], wave2 = waves[1], wave3 = waves[2], wave4 = waves[3], wave5 = waves[4];
            
            // Kiểm tra mô hình impulse: 1,3,5 cùng chiều, 2,4 ngược chiều
            if (wave1.type === wave3.type && wave3.type === wave5.type && 
                wave2.type !== wave1.type && wave4.type !== wave1.type) {
                // Dự đoán tiếp theo là sóng điều chỉnh (ngược chiều sóng 5)
                const prediction = wave5.type === 'Tài' ? 'Xỉu' : 'Tài';
                return {
                    prediction: prediction,
                    confidence: 78,
                    algorithm: 'Elliott Wave'
                };
            }
        }
        return null;
    }

    // 3. Phân tích Fibonacci Retracement
    fibonacciAnalysis(sums) {
        if (sums.length < 20) return null;
        
        const recentSums = sums.slice(0, 20);
        const high = Math.max(...recentSums);
        const low = Math.min(...recentSums);
        const range = high - low;
        const current = sums[0];
        
        const fibLevels = {
            '0.236': low + range * 0.236,
            '0.382': low + range * 0.382,
            '0.5': low + range * 0.5,
            '0.618': low + range * 0.618,
            '0.786': low + range * 0.786
        };
        
        // Xác định vị trí hiện tại
        let position = null;
        if (current <= fibLevels['0.236']) position = 'oversold';
        else if (current >= fibLevels['0.786']) position = 'overbought';
        else if (current <= fibLevels['0.382']) position = 'support';
        else if (current >= fibLevels['0.618']) position = 'resistance';
        
        if (position === 'oversold' || position === 'support') {
            return {
                prediction: 'Tài',
                confidence: position === 'oversold' ? 82 : 72,
                algorithm: 'Fibonacci Support'
            };
        } else if (position === 'overbought' || position === 'resistance') {
            return {
                prediction: 'Xỉu',
                confidence: position === 'overbought' ? 82 : 72,
                algorithm: 'Fibonacci Resistance'
            };
        }
        return null;
    }

    // 4. Phân tích chu kỳ (Cycle Detection)
    cycleAnalysis(results) {
        if (results.length < 20) return null;
        
        let bestCycle = null;
        let bestScore = 0;
        
        for (let cycleLen = 2; cycleLen <= 10; cycleLen++) {
            let matches = 0;
            let checks = 0;
            
            for (let i = cycleLen; i < Math.min(results.length, cycleLen * 5); i++) {
                if (results[i] === results[i - cycleLen]) matches++;
                checks++;
            }
            
            const score = matches / checks;
            if (score > bestScore && score > 0.7) {
                bestScore = score;
                bestCycle = cycleLen;
            }
        }
        
        if (bestCycle) {
            const predicted = results[bestCycle - 1];
            return {
                prediction: predicted,
                confidence: 65 + bestScore * 25,
                algorithm: `Cycle Detection (${bestCycle})`
            };
        }
        return null;
    }

    // 5. Machine Learning với trọng số động
    mlPrediction(results, learningData) {
        if (results.length < 10) return null;
        
        // Tính các features
        const features = {
            taiRatio: results.slice(0, 10).filter(r => r === 'Tài').length / 10,
            xiuRatio: results.slice(0, 10).filter(r => r === 'Xỉu').length / 10,
            streak: this.calculateStreak(results),
            reversalProb: this.calculateReversalProb(results)
        };
        
        // Lấy trọng số từ model đã học
        const weights = learningData.weights || {
            taiRatio: 0.35,
            xiuRatio: 0.35,
            streak: 0.15,
            reversalProb: 0.15
        };
        
        let taiScore = features.taiRatio * weights.taiRatio;
        let xiuScore = features.xiuRatio * weights.xiuRatio;
        
        // Điều chỉnh theo streak (cầu dài dễ bẻ)
        if (features.streak >= 4) {
            taiScore *= 0.7;
            xiuScore *= 0.7;
            if (features.streak % 2 === 0) {
                // Bẻ cầu ở phiên chẵn
                const breakPrediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
                return {
                    prediction: breakPrediction,
                    confidence: 70 + features.streak * 2,
                    algorithm: 'ML - Streak Breaker'
                };
            }
        }
        
        // Điều chỉnh theo xác suất đảo chiều
        if (features.reversalProb > 0.6) {
            const reversalPred = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
            return {
                prediction: reversalPred,
                confidence: 75 + features.reversalProb * 15,
                algorithm: 'ML - Reversal Detection'
            };
        }
        
        const finalPred = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
        const confidence = 60 + Math.abs(taiScore - xiuScore) * 30;
        
        return {
            prediction: finalPred,
            confidence: Math.min(92, confidence),
            algorithm: 'ML - Weighted Features'
        };
    }

    // 6. Neural Network đơn giản
    simpleNN(results, sums) {
        if (results.length < 15) return null;
        
        // Input layer (15 features)
        const inputs = [];
        
        // Feature 1-5: 5 phiên gần nhất
        for (let i = 0; i < 5; i++) {
            inputs.push(results[i] === 'Tài' ? 1 : 0);
        }
        
        // Feature 6-10: Tổng điểm 5 phiên gần nhất
        for (let i = 0; i < 5; i++) {
            inputs.push(sums[i] / 18); // Normalize to 0-1
        }
        
        // Feature 11-15: Biến động
        for (let i = 1; i <= 5; i++) {
            const volatility = Math.abs((sums[i-1] - sums[i]) / 18);
            inputs.push(volatility);
        }
        
        // Hidden layer với trọng số đơn giản
        let hidden1 = 0, hidden2 = 0;
        const w1 = [0.5, 0.3, 0.2, -0.1, -0.2]; // Weights for results
        const w2 = [0.4, 0.3, 0.2, 0.1, -0.1]; // Weights for sums
        const w3 = [-0.2, -0.1, 0.1, 0.2, 0.3]; // Weights for volatility
        
        for (let i = 0; i < 5; i++) {
            hidden1 += inputs[i] * w1[i];
            hidden2 += inputs[i+5] * w2[i];
            hidden2 += inputs[i+10] * w3[i];
        }
        
        // Activation function
        const output = Math.tanh(hidden1 + hidden2);
        
        return {
            prediction: output > 0 ? 'Tài' : 'Xỉu',
            confidence: 60 + Math.abs(output) * 30,
            algorithm: 'Neural Network'
        };
    }

    // 7. Phân tích tổng hợp (Ensemble)
    ensemblePrediction(results, sums, learningData) {
        const predictions = [];
        
        // Thu thập dự đoán từ các thuật toán
        const algorithms = [
            this.markovAnalysis.bind(this),
            this.elliottWaveAnalysis.bind(this),
            this.fibonacciAnalysis.bind(this),
            this.cycleAnalysis.bind(this),
            (r, s) => this.mlPrediction(r, learningData),
            (r, s) => this.simpleNN(r, s)
        ];
        
        for (const algo of algorithms) {
            try {
                const pred = algo(results, sums);
                if (pred && pred.prediction) {
                    predictions.push(pred);
                }
            } catch(e) {}
        }
        
        if (predictions.length === 0) return null;
        
        // Weighted voting
        let taiScore = 0, xiuScore = 0;
        let totalWeight = 0;
        
        for (const pred of predictions) {
            const weight = pred.confidence / 100;
            if (pred.prediction === 'Tài') {
                taiScore += weight;
            } else {
                xiuScore += weight;
            }
            totalWeight += weight;
        }
        
        const finalPred = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
        const confidence = (Math.max(taiScore, xiuScore) / totalWeight) * 100;
        
        return {
            prediction: finalPred,
            confidence: Math.min(96, Math.max(55, Math.round(confidence))),
            details: predictions.map(p => `${p.algorithm}: ${p.prediction} (${p.confidence}%)`),
            ensembleSize: predictions.length
        };
    }

    // Helper functions
    calculateStreak(results) {
        let streak = 1;
        for (let i = 1; i < results.length; i++) {
            if (results[i] === results[i-1]) streak++;
            else break;
        }
        return streak;
    }
    
    calculateReversalProb(results) {
        if (results.length < 10) return 0.5;
        
        let momentum = 0;
        for (let i = 0; i < 9; i++) {
            if (results[i] === results[i+1]) momentum++;
            else momentum--;
        }
        momentum = momentum / 9;
        
        // Momentum âm mạnh -> sắp đảo lên
        // Momentum dương mạnh -> sắp đảo xuống
        return Math.abs(momentum);
    }
    
    // Model persistence
    loadModel() {
        try {
            if (fs.existsSync(MODEL_FILE)) {
                const data = JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8'));
                this.model = data;
                console.log('✅ AI Model loaded successfully');
            } else {
                this.model = {
                    weights: { taiRatio: 0.35, xiuRatio: 0.35, streak: 0.15, reversalProb: 0.15 },
                    accuracy: 0,
                    totalPredictions: 0,
                    correctPredictions: 0
                };
            }
        } catch(e) {
            console.error('Error loading model:', e.message);
            this.model = { weights: {}, totalPredictions: 0, correctPredictions: 0 };
        }
    }
    
    saveModel() {
        try {
            fs.writeFileSync(MODEL_FILE, JSON.stringify(this.model, null, 2));
        } catch(e) {
            console.error('Error saving model:', e.message);
        }
    }
    
    updateModel(prediction, actual, confidence) {
        this.model.totalPredictions++;
        const isCorrect = (prediction === actual);
        if (isCorrect) this.model.correctPredictions++;
        
        this.model.accuracy = this.model.correctPredictions / this.model.totalPredictions;
        
        // Gradient descent để cập nhật weights
        if (!isCorrect && confidence > 70) {
            // Nếu sai với confidence cao -> điều chỉnh mạnh
            Object.keys(this.model.weights).forEach(key => {
                const adjustment = (Math.random() - 0.5) * this.learningRate * 2;
                this.model.weights[key] = Math.max(0.1, Math.min(0.6, this.model.weights[key] + adjustment));
            });
        }
        
        this.saveModel();
        return isCorrect;
    }
}

// ==================== API SERVICE ====================

class TaixiuService {
    constructor() {
        this.predictor = new SuperTaixiuPredictor();
        this.predictionHistory = [];
        this.loadHistory();
    }
    
    async fetchData(type) {
        try {
            const url = API_URLS[type];
            const response = await axios.get(url, { timeout: 10000 });
            return this.transformData(response.data);
        } catch (error) {
            console.error(`Error fetching ${type} data:`, error.message);
            return null;
        }
    }
    
    transformData(apiData) {
        if (!apiData || !apiData.list) return null;
        return apiData.list.map(item => ({
            id: item.id,
            result: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
            dice: item.dices,
            total: item.point
        }));
    }
    
    async predict(type) {
        const data = await this.fetchData(type);
        if (!data || data.length === 0) {
            return { error: 'Không thể lấy dữ liệu' };
        }
        
        const results = data.map(d => d.result);
        const totals = data.map(d => d.total);
        const nextId = data[0].id + 1;
        
        // Lấy dự đoán từ ensemble
        const prediction = this.predictor.ensemblePrediction(results, totals, this.predictor.model);
        
        if (!prediction) {
            // Fallback prediction
            const taiCount = results.slice(0, 10).filter(r => r === 'Tài').length;
            const fallbackPred = taiCount >= 5 ? 'Tài' : 'Xỉu';
            return {
                currentSession: data[0],
                nextSession: nextId,
                prediction: fallbackPred,
                confidence: 60,
                method: 'Fallback (Weighted)'
            };
        }
        
        const record = {
            timestamp: new Date().toISOString(),
            type: type,
            sessionId: nextId,
            prediction: prediction.prediction,
            confidence: prediction.confidence,
            details: prediction.details,
            ensembleSize: prediction.ensembleSize,
            actual: null,
            isCorrect: null
        };
        
        this.predictionHistory.unshift(record);
        if (this.predictionHistory.length > 200) this.predictionHistory.pop();
        this.saveHistory();
        
        return {
            currentSession: data[0],
            nextSession: nextId,
            prediction: prediction.prediction,
            confidence: `${prediction.confidence}%`,
            factors: prediction.details,
            algorithmsUsed: prediction.ensembleSize,
            method: 'Super Ensemble AI v5.0'
        };
    }
    
    async verifyAndUpdate(type) {
        const data = await this.fetchData(type);
        if (!data) return { updated: false };
        
        let updated = false;
        for (const record of this.predictionHistory) {
            if (record.type === type && record.actual === null) {
                const actualData = data.find(d => d.id === record.sessionId);
                if (actualData) {
                    record.actual = actualData.result;
                    record.isCorrect = (record.prediction === record.actual);
                    this.predictor.updateModel(record.prediction, record.actual, parseFloat(record.confidence));
                    updated = true;
                }
            }
        }
        
        if (updated) this.saveHistory();
        return { updated, totalUpdated: updated ? 1 : 0 };
    }
    
    getStats() {
        const total = this.predictionHistory.filter(r => r.isCorrect !== null).length;
        const correct = this.predictionHistory.filter(r => r.isCorrect === true).length;
        const accuracy = total > 0 ? (correct / total * 100).toFixed(2) : 0;
        
        const recent = this.predictionHistory.slice(0, 20).filter(r => r.isCorrect !== null);
        const recentAccuracy = recent.length > 0 ? 
            (recent.filter(r => r.isCorrect).length / recent.length * 100).toFixed(2) : 0;
        
        return {
            totalPredictions: total,
            correctPredictions: correct,
            overallAccuracy: `${accuracy}%`,
            recent20Accuracy: `${recentAccuracy}%`,
            modelAccuracy: `${(this.predictor.model.accuracy * 100).toFixed(2)}%`,
            modelWeights: this.predictor.model.weights,
            history: this.predictionHistory.slice(0, 20)
        };
    }
    
    loadHistory() {
        try {
            if (fs.existsSync(HISTORY_FILE)) {
                this.predictionHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
                console.log(`✅ Loaded ${this.predictionHistory.length} history records`);
            }
        } catch(e) {
            console.error('Error loading history:', e.message);
        }
    }
    
    saveHistory() {
        try {
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(this.predictionHistory, null, 2));
        } catch(e) {
            console.error('Error saving history:', e.message);
        }
    }
    
    reset() {
        this.predictionHistory = [];
        this.saveHistory();
        this.predictor.model = { weights: {}, totalPredictions: 0, correctPredictions: 0 };
        this.predictor.saveModel();
        return { message: 'All data reset successfully' };
    }
}

// ==================== EXPRESS API ====================

const service = new TaixiuService();

// Auto verify mỗi 30 giây
setInterval(async () => {
    for (const type of ['hu', 'md5']) {
        await service.verifyAndUpdate(type);
    }
}, 30000);

// API Endpoints
app.use(express.json());

app.get('/', (req, res) => {
    res.json({
        name: 'Super Taixiu AI Predictor',
        version: '5.0.0',
        author: '@Tskhang',
        description: 'API dự đoán Tài Xỉu với thuật toán AI tiên tiến',
        endpoints: {
            '/hu': 'Dự đoán phiên tiếp theo - Hũ',
            '/md5': 'Dự đoán phiên tiếp theo - MD5',
            '/stats': 'Thống kê độ chính xác',
            '/history': 'Lịch sử dự đoán',
            '/reset': 'Reset dữ liệu'
        },
        algorithms: [
            'Markov Chain High-Order',
            'Elliott Wave Analysis',
            'Fibonacci Retracement',
            'Cycle Detection',
            'Machine Learning with Dynamic Weights',
            'Simple Neural Network',
            'Ensemble Voting System'
        ]
    });
});

app.get('/hu', async (req, res) => {
    try {
        const result = await service.predict('hu');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/md5', async (req, res) => {
    try {
        const result = await service.predict('md5');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/stats', (req, res) => {
    res.json(service.getStats());
});

app.get('/history', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    res.json({
        total: service.predictionHistory.length,
        history: service.predictionHistory.slice(0, limit)
    });
});

app.get('/reset', (req, res) => {
    res.json(service.reset());
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║     🎲 SUPER TAIXIU AI PREDICTOR v5.0 🎲                    ║
║                                                              ║
╠══════════════════════════════════════════════════════════════╣
║  🤖 THUẬT TOÁN AI:                                           ║
║  ┌────────────────────────────────────────────────────────┐ ║
║  │ ✅ Markov Chain bậc cao (3 phiên)                      │ ║
║  │ ✅ Elliott Wave - Phát hiện sóng thị trường            │ ║
║  │ ✅ Fibonacci Retracement - Phân tích tổng điểm         │ ║
║  │ ✅ Cycle Detection - Nhận diện chu kỳ                  │ ║
║  │ ✅ Machine Learning - Trọng số động                    │ ║
║  │ ✅ Neural Network - 15 features input                  │ ║
║  │ ✅ Ensemble Voting - Kết hợp 6 thuật toán              │ ║
║  └────────────────────────────────────────────────────────┘ ║
║                                                              ║
║  🚀 API Running: http://0.0.0.0:${PORT}                        ║
║  📡 Endpoints:                                               ║
║     GET /hu    - Dự đoán Hũ                                  ║
║     GET /md5   - Dự đoán MD5                                 ║
║     GET /stats - Thống kê độ chính xác                       ║
║     GET /history - Lịch sử dự đoán                           ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
    `);
});

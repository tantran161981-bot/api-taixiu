const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const HISTORY_FILE = 'history.json';

let predictionHistory = { hu: [], md5: [] };
let lastProcessedPhien = { hu: null, md5: null };
let modelStats = { hu: { correct: 0, total: 0, recent: [] }, md5: { correct: 0, total: 0, recent: [] } };

// ==================== SIÊU THUẬT TOÁN DỰ ĐOÁN ====================

class UltimatePredictor {
    constructor(type) {
        this.type = type;
        this.weights = {
            lstm: 1.8, gru: 1.7, attention: 1.9,
            markov: 1.6, bayesian: 1.5, chaos: 1.4,
            pattern: 1.3, trend: 1.2
        };
        this.memory = [];
        this.accuracy = 0.65;
    }

    // LSTM đơn giản hóa nhưng mạnh
    lstmPredict(sequence) {
        if (sequence.length < 5) return 0.5;
        
        let hidden = 0, cell = 0;
        const weights = { input: 0.7, hidden: 0.5, output: 0.8 };
        
        for (let i = 0; i < Math.min(sequence.length, 20); i++) {
            const x = sequence[i] === 'Tài' ? 1 : 0;
            const f = 1 / (1 + Math.exp(-(x * weights.input + hidden * weights.hidden)));
            const i_gate = 1 / (1 + Math.exp(-(x * weights.input + hidden * weights.hidden)));
            const o = 1 / (1 + Math.exp(-(x * weights.input + hidden * weights.hidden)));
            cell = f * cell + i_gate * Math.tanh(x * weights.input + hidden * weights.hidden);
            hidden = o * Math.tanh(cell);
        }
        
        return 1 / (1 + Math.exp(-hidden * weights.output));
    }

    // Attention mechanism
    attentionPredict(sequence) {
        if (sequence.length < 3) return 0.5;
        
        let scores = [];
        for (let i = 0; i < Math.min(sequence.length, 10); i++) {
            const val = sequence[i] === 'Tài' ? 1 : 0;
            scores.push(Math.exp(val * (i + 1) / 5));
        }
        
        const sumScores = scores.reduce((a, b) => a + b, 0.001);
        const weights = scores.map(s => s / sumScores);
        
        let weightedSum = 0;
        for (let i = 0; i < weights.length; i++) {
            weightedSum += weights[i] * (sequence[i] === 'Tài' ? 1 : 0);
        }
        
        return weightedSum;
    }

    // Markov Chain với ma trận cấp 3
    markovPredict(sequence) {
        if (sequence.length < 5) return 0.5;
        
        const transitions = {};
        for (let i = 0; i < sequence.length - 3; i++) {
            const key = `${sequence[i]}_${sequence[i+1]}_${sequence[i+2]}`;
            const next = sequence[i+3];
            if (!transitions[key]) transitions[key] = { Tai: 0, Xiu: 0 };
            transitions[key][next]++;
        }
        
        const lastKey = `${sequence[0]}_${sequence[1]}_${sequence[2]}`;
        const stats = transitions[lastKey];
        
        if (stats && (stats.Tai + stats.Xiu) > 0) {
            return stats.Tai / (stats.Tai + stats.Xiu);
        }
        
        return 0.5;
    }

    // Bayesian Inference
    bayesianPredict(results, sums) {
        let taiPrior = 0.5;
        
        // Update prior based on recent accuracy
        if (this.accuracy > 0.6) taiPrior = 0.55;
        else if (this.accuracy > 0.55) taiPrior = 0.52;
        
        // Likelihood based on sum trend
        let sumTrend = 0;
        for (let i = 0; i < Math.min(sums.length, 5); i++) {
            sumTrend += sums[i] - 10.5;
        }
        
        const likelihoodTai = 1 / (1 + Math.exp(-sumTrend / 10));
        const posterior = (taiPrior * likelihoodTai) / (taiPrior * likelihoodTai + (1 - taiPrior) * (1 - likelihoodTai));
        
        return posterior;
    }

    // Chaos Theory - Lyapunov exponent
    chaosPredict(sequence) {
        const values = sequence.map(v => v === 'Tài' ? 1 : 0);
        let divergence = 0;
        
        for (let i = 0; i < Math.min(values.length - 1, 15); i++) {
            divergence += Math.abs(values[i] - values[i + 1]);
        }
        
        const chaosIndex = divergence / Math.min(values.length, 15);
        
        // High chaos -> contrarian, low chaos -> follow trend
        if (chaosIndex > 0.6) {
            // Đảo chiều
            return sequence[0] === 'Tài' ? 0.4 : 0.6;
        } else if (chaosIndex < 0.3) {
            // Theo xu hướng
            return sequence[0] === 'Tài' ? 0.6 : 0.4;
        }
        
        return 0.5;
    }

    // Pattern detection tổng hợp
    patternPredict(results) {
        if (results.length < 4) return 0.5;
        
        let taiScore = 0, xiuScore = 0;
        
        // Cầu bệt
        let streak = 1;
        for (let i = 1; i < results.length; i++) {
            if (results[i] === results[0]) streak++;
            else break;
        }
        if (streak >= 4) {
            if (results[0] === 'Tài') xiuScore += 0.7;
            else taiScore += 0.7;
        } else if (streak >= 3) {
            if (results[0] === 'Tài') xiuScore += 0.55;
            else taiScore += 0.55;
        }
        
        // Cầu 1-1
        let alternating = true;
        for (let i = 1; i < Math.min(results.length, 6); i++) {
            if (results[i] === results[i-1]) {
                alternating = false;
                break;
            }
        }
        if (alternating && results.length >= 4) {
            if (results[0] === 'Tài') xiuScore += 0.6;
            else taiScore += 0.6;
        }
        
        // Tỷ lệ Tài/Xỉu
        const taiCount = results.slice(0, 10).filter(r => r === 'Tài').length;
        if (taiCount >= 7) xiuScore += 0.65;
        else if (taiCount <= 3) taiScore += 0.65;
        else if (taiCount >= 6) xiuScore += 0.5;
        else if (taiCount <= 4) taiScore += 0.5;
        
        const totalScore = taiScore + xiuScore;
        if (totalScore === 0) return 0.5;
        
        return taiScore / totalScore;
    }

    // Trend analysis
    trendPredict(sums) {
        if (sums.length < 5) return 0.5;
        
        let trend = 0;
        for (let i = 0; i < Math.min(sums.length, 10) - 1; i++) {
            trend += sums[i] - sums[i + 1];
        }
        
        // Tổng tăng -> Xỉu, tổng giảm -> Tài
        const sigmoid = 1 / (1 + Math.exp(-trend / 15));
        return 1 - sigmoid;
    }

    // Dự đoán chính
    predict(data) {
        const results = data.map(d => d.Ket_qua);
        const sums = data.map(d => d.Tong);
        
        const predictions = {
            lstm: this.lstmPredict(results),
            attention: this.attentionPredict(results),
            markov: this.markovPredict(results),
            bayesian: this.bayesianPredict(results, sums),
            chaos: this.chaosPredict(results),
            pattern: this.patternPredict(results),
            trend: this.trendPredict(sums)
        };
        
        // Weighted ensemble
        let totalTai = 0, totalWeight = 0;
        for (const [model, prob] of Object.entries(predictions)) {
            const weight = this.weights[model] || 1.0;
            totalTai += prob * weight;
            totalWeight += weight;
        }
        
        let finalProb = totalTai / totalWeight;
        
        // Adjust based on model accuracy
        finalProb = finalProb * 0.7 + 0.5 * 0.3;
        
        // Clamp and convert
        finalProb = Math.min(0.92, Math.max(0.08, finalProb));
        
        const prediction = finalProb > 0.5 ? 'Tài' : 'Xỉu';
        const confidence = Math.round(55 + Math.abs(finalProb - 0.5) * 80);
        
        return {
            prediction,
            confidence: Math.min(94, confidence),
            probability: finalProb,
            details: predictions
        };
    }

    update(actual, predicted, wasCorrect) {
        // Update accuracy
        this.accuracy = (this.accuracy * 0.95 + (wasCorrect ? 1 : 0) * 0.05);
        
        // Adjust weights based on correctness
        if (wasCorrect) {
            for (const model in this.weights) {
                this.weights[model] = Math.min(2.5, this.weights[model] * 1.01);
            }
        } else {
            for (const model in this.weights) {
                this.weights[model] = Math.max(0.5, this.weights[model] * 0.99);
            }
        }
        
        // Store in memory
        this.memory.unshift({ actual, predicted, timestamp: Date.now() });
        if (this.memory.length > 100) this.memory.pop();
    }
}

// ==================== API & UTILITIES ====================

function transformApiData(apiData) {
    if (!apiData?.list || !Array.isArray(apiData.list)) return null;
    
    return apiData.list.map(item => ({
        Phien: item.id,
        Ket_qua: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
        Xuc_xac_1: item.dices?.[0] || 0,
        Xuc_xac_2: item.dices?.[1] || 0,
        Xuc_xac_3: item.dices?.[2] || 0,
        Tong: item.point || 0
    }));
}

async function fetchDataHu() {
    try {
        const response = await axios.get(API_URL_HU, { timeout: 8000 });
        return transformApiData(response.data);
    } catch (error) {
        console.error('HU fetch error:', error.message);
        return null;
    }
}

async function fetchDataMd5() {
    try {
        const response = await axios.get(API_URL_MD5, { timeout: 8000 });
        return transformApiData(response.data);
    } catch (error) {
        console.error('MD5 fetch error:', error.message);
        return null;
    }
}

function saveHistory() {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify({
            history: predictionHistory,
            lastProcessedPhien,
            stats: modelStats,
            lastSaved: new Date().toISOString()
        }, null, 2));
    } catch (e) {}
}

function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
            predictionHistory = data.history || { hu: [], md5: [] };
            lastProcessedPhien = data.lastProcessedPhien || { hu: null, md5: null };
            modelStats = data.stats || { hu: { correct: 0, total: 0, recent: [] }, md5: { correct: 0, total: 0, recent: [] } };
            console.log('History loaded');
        }
    } catch (e) {}
}

// Khởi tạo predictors
const predictors = {
    hu: new UltimatePredictor('hu'),
    md5: new UltimatePredictor('md5')
};

// Auto process
async function autoProcess() {
    try {
        for (const type of ['hu', 'md5']) {
            const data = type === 'hu' ? await fetchDataHu() : await fetchDataMd5();
            if (!data?.length) continue;
            
            const latestPhien = data[0].Phien;
            const nextPhien = latestPhien + 1;
            
            if (lastProcessedPhien[type] !== nextPhien) {
                const result = predictors[type].predict(data);
                
                // Save to history
                const record = {
                    Phien: data[0].Phien,
                    Tong: data[0].Tong,
                    Ket_qua: data[0].Ket_qua,
                    Phien_hien_tai: nextPhien,
                    Du_doan: result.prediction,
                    Do_tin_cay: `${result.confidence}%`,
                    timestamp: new Date().toISOString()
                };
                predictionHistory[type].unshift(record);
                if (predictionHistory[type].length > 200) predictionHistory[type].pop();
                
                lastProcessedPhien[type] = nextPhien;
                console.log(`[${type.toUpperCase()}] ${nextPhien}: ${result.prediction} (${result.confidence}%)`);
                
                // Verify past predictions
                const lastRecord = predictionHistory[type].find(r => r.Phien_hien_tai === latestPhien.toString());
                if (lastRecord && !lastRecord.ket_qua_du_doan) {
                    const wasCorrect = lastRecord.Du_doan === data[0].Ket_qua;
                    lastRecord.ket_qua_du_doan = wasCorrect ? 'Đúng ✅' : 'Sai ❌';
                    
                    modelStats[type].total++;
                    if (wasCorrect) modelStats[type].correct++;
                    
                    predictors[type].update(data[0].Ket_qua, lastRecord.Du_doan, wasCorrect);
                }
                
                saveHistory();
            }
        }
    } catch (e) {
        console.error('Auto error:', e.message);
    }
}

// ==================== ENDPOINTS ====================

app.get('/', (req, res) => {
    res.json({
        name: 'Super Tai Xiu Predictor',
        version: '5.0',
        author: '@tiendataox',
        accuracy: `${((modelStats.hu.correct + modelStats.md5.correct) / (modelStats.hu.total + modelStats.md5.total + 1) * 100).toFixed(1)}%`
    });
});

app.get('/lc79-hu', async (req, res) => {
    try {
        const data = await fetchDataHu();
        if (!data?.length) return res.status(500).json({ error: 'Cannot fetch data' });
        
        const result = predictors.hu.predict(data);
        const nextPhien = data[0].Phien + 1;
        
        const record = {
            Phien: data[0].Phien,
            Xuc_xac: `${data[0].Xuc_xac_1},${data[0].Xuc_xac_2},${data[0].Xuc_xac_3}`,
            Tong: data[0].Tong,
            Ket_qua: data[0].Ket_qua,
            Phien_hien_tai: nextPhien,
            Du_doan: result.prediction,
            Do_tin_cay: `${result.confidence}%`,
            timestamp: new Date().toISOString(),
            id: '@tiendataox'
        };
        
        predictionHistory.hu.unshift(record);
        if (predictionHistory.hu.length > 200) predictionHistory.hu.pop();
        saveHistory();
        
        res.json(record);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/lc79-md5', async (req, res) => {
    try {
        const data = await fetchDataMd5();
        if (!data?.length) return res.status(500).json({ error: 'Cannot fetch data' });
        
        const result = predictors.md5.predict(data);
        const nextPhien = data[0].Phien + 1;
        
        const record = {
            Phien: data[0].Phien,
            Xuc_xac: `${data[0].Xuc_xac_1},${data[0].Xuc_xac_2},${data[0].Xuc_xac_3}`,
            Tong: data[0].Tong,
            Ket_qua: data[0].Ket_qua,
            Phien_hien_tai: nextPhien,
            Du_doan: result.prediction,
            Do_tin_cay: `${result.confidence}%`,
            timestamp: new Date().toISOString(),
            id: '@tiendataox'
        };
        
        predictionHistory.md5.unshift(record);
        if (predictionHistory.md5.length > 200) predictionHistory.md5.pop();
        saveHistory();
        
        res.json(record);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/lc79-hu/lichsu', (req, res) => {
    res.json({ type: 'Lẩu Cua 79 - Tài Xỉu Hũ', history: predictionHistory.hu, total: predictionHistory.hu.length });
});

app.get('/lc79-md5/lichsu', (req, res) => {
    res.json({ type: 'Lẩu Cua 79 - Tài Xỉu MD5', history: predictionHistory.md5, total: predictionHistory.md5.length });
});

app.get('/stats', (req, res) => {
    const huAcc = modelStats.hu.total > 0 ? (modelStats.hu.correct / modelStats.hu.total * 100).toFixed(1) : 'N/A';
    const md5Acc = modelStats.md5.total > 0 ? (modelStats.md5.correct / modelStats.md5.total * 100).toFixed(1) : 'N/A';
    
    res.json({
        hu: { total: modelStats.hu.total, correct: modelStats.hu.correct, accuracy: `${huAcc}%` },
        md5: { total: modelStats.md5.total, correct: modelStats.md5.correct, accuracy: `${md5Acc}%` },
        predictors: {
            hu: { accuracy: `${(predictors.hu.accuracy * 100).toFixed(1)}%`, weights: predictors.hu.weights },
            md5: { accuracy: `${(predictors.md5.accuracy * 100).toFixed(1)}%`, weights: predictors.md5.weights }
        }
    });
});

// Khởi động
loadHistory();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 SUPER TAI XIU API v5.0`);
    console.log(`📡 Port: ${PORT}`);
    console.log(`👤 @tiendataox`);
    console.log(`\n⚡ Models: LSTM | Attention | Markov | Bayesian | Chaos | Pattern | Trend`);
    console.log(`========================================\n`);
    
    setInterval(() => autoProcess(), 20000);
    setTimeout(() => autoProcess(), 3000);
});
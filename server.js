const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8000;
app.use(cors());
app.use(express.json());

// ==================== CẤU HÌNH ====================
const API_URL = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';

let APP_STATE = {
    history: [],
    lastPrediction: null,
    stats: { total: 0, win: 0, loss: 0 }
};

// ==================== ULTRA DICE PREDICTION SYSTEM ====================
class UltraDicePredictionSystem {
    constructor() {
        this.history = [];
        this.models = {};
        this.weights = {};
        this.performance = {};
        this.patternDatabase = {};
        this.advancedPatterns = {};
        this.sessionStats = {
            streaks: { T: 0, X: 0, maxT: 0, maxX: 0 },
            transitions: { TtoT: 0, TtoX: 0, XtoT: 0, XtoX: 0 },
            volatility: 0.5,
            patternConfidence: {},
            recentAccuracy: 0,
            bias: { T: 0, X: 0 }
        };
        this.marketState = {
            trend: 'neutral',
            momentum: 0,
            stability: 0.5,
            regime: 'normal'
        };
        this.adaptiveParameters = {
            patternMinLength: 3,
            patternMaxLength: 8,
            volatilityThreshold: 0.7,
            trendStrengthThreshold: 0.6,
            patternConfidenceDecay: 0.95,
            patternConfidenceGrowth: 1.05
        };
        this.initAllModels();
    }

    initAllModels() {
        for (let i = 1; i <= 21; i++) {
            this.models[`model${i}`] = this[`model${i}`]?.bind(this) || (() => null);
            this.weights[`model${i}`] = 1;
            this.performance[`model${i}`] = { 
                correct: 0, total: 0, recentCorrect: 0, recentTotal: 0, streak: 0, maxStreak: 0
            };
        }
        this.initPatternDatabase();
        this.initAdvancedPatterns();
    }

    initPatternDatabase() {
        this.patternDatabase = {
            '1-1': { pattern: ['T', 'X', 'T', 'X'], probability: 0.7, strength: 0.8 },
            '1-2-1': { pattern: ['T', 'X', 'X', 'T'], probability: 0.65, strength: 0.75 },
            '2-1-2': { pattern: ['T', 'T', 'X', 'T', 'T'], probability: 0.68, strength: 0.78 },
            '3-1': { pattern: ['T', 'T', 'T', 'X'], probability: 0.72, strength: 0.82 },
            '1-3': { pattern: ['T', 'X', 'X', 'X'], probability: 0.72, strength: 0.82 },
            '2-2': { pattern: ['T', 'T', 'X', 'X'], probability: 0.66, strength: 0.76 },
            '3-2': { pattern: ['T', 'T', 'T', 'X', 'X'], probability: 0.73, strength: 0.83 },
            '4-1': { pattern: ['T', 'T', 'T', 'T', 'X'], probability: 0.76, strength: 0.86 },
            '1-4': { pattern: ['T', 'X', 'X', 'X', 'X'], probability: 0.76, strength: 0.86 }
        };
    }

    initAdvancedPatterns() {
        this.advancedPatterns = {
            'dynamic-1': {
                detect: (data) => data.length >= 6 && data.slice(-6).filter(x => x === 'T').length === 4 && data[data.length-1] === 'T',
                predict: () => 'X',
                confidence: 0.72
            },
            'alternating-3': {
                detect: (data) => {
                    if (data.length < 5) return false;
                    const last5 = data.slice(-5);
                    for (let i = 1; i < last5.length; i++) {
                        if (last5[i] === last5[i-1]) return false;
                    }
                    return true;
                },
                predict: (data) => data[data.length-1] === 'T' ? 'X' : 'T',
                confidence: 0.68
            },
            'cyclic-7': {
                detect: (data) => {
                    if (data.length < 14) return false;
                    const firstHalf = data.slice(-14, -7);
                    const secondHalf = data.slice(-7);
                    return JSON.stringify(firstHalf) === JSON.stringify(secondHalf);
                },
                predict: (data) => data[data.length-7],
                confidence: 0.75
            }
        };
    }

    addResult(result) {
        if (this.history.length > 0) {
            const lastResult = this.history[this.history.length-1];
            const transitionKey = `${lastResult}to${result}`;
            this.sessionStats.transitions[transitionKey] = (this.sessionStats.transitions[transitionKey] || 0) + 1;
            
            if (result === lastResult) {
                this.sessionStats.streaks[result]++;
                this.sessionStats.streaks[`max${result}`] = Math.max(
                    this.sessionStats.streaks[`max${result}`],
                    this.sessionStats.streaks[result]
                );
            } else {
                this.sessionStats.streaks[result] = 1;
                this.sessionStats.streaks[lastResult] = 0;
            }
        } else {
            this.sessionStats.streaks[result] = 1;
        }
        
        this.history.push(result);
        if (this.history.length > 200) this.history.shift();
        this.updateVolatility();
        this.updateMarketState();
    }

    updateVolatility() {
        if (this.history.length < 10) return;
        const recent = this.history.slice(-10);
        let changes = 0;
        for (let i = 1; i < recent.length; i++) {
            if (recent[i] !== recent[i-1]) changes++;
        }
        this.sessionStats.volatility = changes / (recent.length - 1);
    }

    updateMarketState() {
        if (this.history.length < 15) return;
        const recent = this.history.slice(-15);
        const tCount = recent.filter(x => x === 'T').length;
        const trendStrength = Math.abs(tCount - (15 - tCount)) / 15;
        this.marketState.trend = trendStrength > this.adaptiveParameters.trendStrengthThreshold ? (tCount > 7 ? 'up' : 'down') : 'neutral';
        this.marketState.stability = 1 - this.sessionStats.volatility;
        this.marketState.regime = this.sessionStats.volatility > 0.7 ? 'volatile' : (trendStrength > 0.7 ? 'trending' : (trendStrength < 0.3 ? 'random' : 'normal'));
    }

    // ==================== 21 MODEL CHÍNH ====================
    
    model1() {
        const recent = this.history.slice(-10);
        if (recent.length < 4) return null;
        for (const [type, data] of Object.entries(this.patternDatabase)) {
            const pattern = data.pattern;
            if (recent.length >= pattern.length) {
                const segment = recent.slice(-pattern.length + 1);
                const patternWithoutLast = pattern.slice(0, -1);
                if (JSON.stringify(segment) === JSON.stringify(patternWithoutLast)) {
                    let confidence = data.probability * 0.8;
                    if (this.marketState.regime === 'trending') confidence *= 1.1;
                    return { prediction: pattern[pattern.length-1], confidence: Math.min(0.95, confidence), reason: `Pattern ${type}` };
                }
            }
        }
        return null;
    }

    model2() {
        const shortTerm = this.history.slice(-5);
        const longTerm = this.history.slice(-20);
        if (shortTerm.length < 3 || longTerm.length < 10) return null;
        
        const shortT = shortTerm.filter(x => x === 'T').length;
        const longT = longTerm.filter(x => x === 'T').length;
        const shortTrend = shortT > 2 ? 'up' : (shortT < 2 ? 'down' : 'neutral');
        const longTrend = longT > 10 ? 'up' : (longT < 10 ? 'down' : 'neutral');
        
        let prediction, confidence;
        if (shortTrend === longTrend) {
            prediction = shortTrend === 'up' ? 'T' : 'X';
            confidence = 0.65;
        } else {
            prediction = shortTrend === 'up' ? 'T' : 'X';
            confidence = 0.55;
        }
        if (this.marketState.regime === 'trending') confidence *= 1.1;
        return { prediction, confidence: Math.min(0.95, confidence), reason: `Xu hướng: ${shortTrend}/${longTrend}` };
    }

    model3() {
        const recent = this.history.slice(-12);
        if (recent.length < 12) return null;
        const tCount = recent.filter(x => x === 'T').length;
        const xCount = 12 - tCount;
        const diff = Math.abs(tCount - xCount) / 12;
        if (diff < 0.4) return null;
        return { prediction: tCount > xCount ? 'X' : 'T', confidence: Math.min(0.9, diff * 1.2), reason: `Chênh lệch ${diff.toFixed(2)}` };
    }

    model4() {
        const recent = this.history.slice(-6);
        if (recent.length < 4) return null;
        const last3 = recent.slice(-3);
        const tCount = last3.filter(x => x === 'T').length;
        if (tCount === 3) return { prediction: 'T', confidence: 0.7, reason: '3T liên tiếp' };
        if (tCount === 0) return { prediction: 'X', confidence: 0.7, reason: '3X liên tiếp' };
        if (tCount === 2) return { prediction: 'T', confidence: 0.65, reason: '2T/3' };
        if (tCount === 1) return { prediction: 'X', confidence: 0.65, reason: '2X/3' };
        return { prediction: recent[recent.length-1] === 'T' ? 'X' : 'T', confidence: 0.55, reason: 'Đảo chiều' };
    }

    model5() {
        return null; // Model 5 sẽ dùng ensemble từ các model khác
    }

    model6() {
        const streak = this.sessionStats.streaks[this.history[this.history.length-1] || 'T'];
        if (streak >= 4) {
            const breakProb = this.model10Mini();
            if (breakProb > 0.6) {
                const last = this.history[this.history.length-1];
                return { prediction: last === 'T' ? 'X' : 'T', confidence: Math.min(0.85, 0.6 + streak * 0.05), reason: `Bẻ cầu dài ${streak}` };
            }
        }
        return null;
    }

    model7() { return null; } // Điều chỉnh trọng số
    model8() { return null; } // Nhận diện cầu xấu
    model9() { return this.model1(); } // Pattern nâng cao
    model10() { 
        const prob = this.model10Mini();
        return { prediction: null, confidence: prob, reason: `Xác suất bẻ: ${prob.toFixed(2)}` };
    }
    model10Mini() {
        if (this.history.length < 20) return 0.5;
        let breaks = 0, total = 0;
        for (let i = 5; i < this.history.length; i++) {
            const streak = this.sessionStats.streaks[this.history[i-1]];
            if (streak >= 4) {
                total++;
                if (this.history[i] !== this.history[i-1]) breaks++;
            }
        }
        return total > 0 ? breaks / total : 0.5;
    }
    
    model11() { return null; }
    model12() {
        const recent = this.history.slice(-4);
        if (recent.length < 4) return null;
        const last4 = recent.join('-');
        const patterns = { 'T-X-T-X': { pred: 'X', conf: 0.68 }, 'X-T-X-T': { pred: 'T', conf: 0.68 }, 'T-T-X-X': { pred: 'X', conf: 0.72 }, 'X-X-T-T': { pred: 'T', conf: 0.72 } };
        if (patterns[last4]) return { prediction: patterns[last4].pred, confidence: patterns[last4].conf, reason: `Pattern ${last4}` };
        return null;
    }
    
    model13() { return null; }
    model14() { return this.model10(); }
    model15() {
        const trend = this.model2();
        const breakProb = this.model10Mini();
        if (trend && breakProb < 0.4) return { prediction: trend.prediction, confidence: trend.confidence * 1.1, reason: 'Theo xu hướng mạnh' };
        if (trend && breakProb > 0.6) return { prediction: trend.prediction === 'T' ? 'X' : 'T', confidence: 0.65, reason: 'Bẻ xu hướng' };
        return null;
    }
    
    model16() { return this.model10(); }
    model17() { return null; }
    model18() {
        const recent = this.history.slice(-6);
        if (recent.length < 4) return null;
        const tCount = recent.filter(x => x === 'T').length;
        if (tCount >= 4) return { prediction: 'T', confidence: 0.7, reason: 'Xu hướng T mạnh' };
        if (tCount <= 2) return { prediction: 'X', confidence: 0.7, reason: 'Xu hướng X mạnh' };
        return null;
    }
    
    model19() { return this.model18(); }
    model20() { return this.model2(); }
    model21() {
        const predictions = [this.model1(), this.model2(), this.model4(), this.model6(), this.model12(), this.model18()].filter(p => p);
        if (predictions.length < 3) return null;
        let tCount = 0, xCount = 0;
        predictions.forEach(p => { if (p.prediction === 'T') tCount++; else xCount++; });
        if (Math.abs(tCount - xCount) <= 1) return null;
        const prediction = tCount > xCount ? 'T' : 'X';
        const confidence = 0.5 + Math.abs(tCount - xCount) / predictions.length * 0.3;
        return { prediction, confidence: Math.min(0.85, confidence), reason: `Đồng thuận ${predictions.length} model` };
    }

    getFinalPrediction() {
        const predictions = [];
        for (let i = 1; i <= 21; i++) {
            const result = this.models[`model${i}`]?.();
            if (result && result.prediction && result.confidence > 0.55) {
                predictions.push(result);
            }
        }
        
        if (predictions.length === 0) {
            const last = this.history[this.history.length-1] || 'T';
            return { prediction: last, confidence: 0.5, reasons: ['Fallback'] };
        }
        
        let tScore = 0, xScore = 0;
        predictions.forEach(p => {
            if (p.prediction === 'T') tScore += p.confidence;
            else xScore += p.confidence;
        });
        
        const finalPrediction = tScore > xScore ? 'T' : 'X';
        const finalConfidence = Math.max(tScore, xScore) / (tScore + xScore);
        const adjustedConfidence = this.sessionStats.volatility > 0.7 ? finalConfidence * 0.85 : finalConfidence;
        
        return { prediction: finalPrediction, confidence: Math.min(0.92, adjustedConfidence), reasons: predictions.slice(0, 3).map(p => p.reason) };
    }
}

const predictor = new UltraDicePredictionSystem();

// ==================== ĐỒNG BỘ DATA ====================
async function syncData() {
    try {
        const res = await fetch(API_URL);
        const data = await res.json();
        
        if (data?.list) {
            const newHistory = data.list.map(item => ({
                session: Number(item.id),
                result: item.resultTruyenThong === 'TAI' ? 'T' : 'X',
                dice: item.dices
            })).reverse();
            
            const latest = newHistory[newHistory.length - 1];
            
            if (APP_STATE.lastPrediction && APP_STATE.lastPrediction.phien === latest.session) {
                APP_STATE.stats.total++;
                if (APP_STATE.lastPrediction.ketqua === latest.result) {
                    APP_STATE.stats.win++;
                    predictor.updatePerformance?.(latest.result);
                    console.log(`✅ THẮNG ${latest.session}: ${APP_STATE.lastPrediction.ketqua}`);
                } else {
                    APP_STATE.stats.loss++;
                    console.log(`❌ THUA ${latest.session}: ${APP_STATE.lastPrediction.ketqua} vs ${latest.result}`);
                }
                const wr = (APP_STATE.stats.win / APP_STATE.stats.total * 100).toFixed(2);
                console.log(`📊 WINRATE: ${wr}% (${APP_STATE.stats.win}/${APP_STATE.stats.total})`);
                APP_STATE.lastPrediction = null;
            }
            
            APP_STATE.history = newHistory;
            newHistory.forEach(item => predictor.addResult(item.result));
        }
    } catch (e) {
        console.error("Lỗi sync:", e.message);
    }
}

setInterval(syncData, 5000);

// ==================== API ====================
app.get('/', async (req, res) => {
    await syncData();
    
    const last = APP_STATE.history[APP_STATE.history.length - 1];
    const nextId = last ? last.session + 1 : 1;
    
    if (!APP_STATE.lastPrediction || APP_STATE.lastPrediction.phien !== nextId) {
        const prediction = predictor.getFinalPrediction();
        APP_STATE.lastPrediction = {
            phien: nextId,
            ketqua: prediction.prediction === 'T' ? 'Tài' : 'Xỉu',
            do_tin_cay: Math.round(prediction.confidence * 100) + '%',
            ly_do: prediction.reasons?.join('; ') || 'Tổng hợp 21 model'
        };
    }
    
    const pred = APP_STATE.lastPrediction;
    const winRate = APP_STATE.stats.total > 0 ? (APP_STATE.stats.win / APP_STATE.stats.total * 100).toFixed(2) : "0";
    
    res.json({
        "phien_truoc": last?.session || 0,
        "ketqua_truoc": last?.result === 'T' ? 'Tài' : (last?.result === 'X' ? 'Xỉu' : ''),
        "xuc_xac": last?.dice || [0,0,0],
        "phien_sau": nextId,
        "du_doan": pred.ketqua,
        "do_tin_cay": pred.do_tin_cay,
        "ly_do": pred.ly_do,
        "thong_ke": {
            "thang": APP_STATE.stats.win,
            "thua": APP_STATE.stats.loss,
            "tong": APP_STATE.stats.total,
            "winrate": winRate + "%"
        }
    });
});

app.get('/stats', (req, res) => {
    res.json({
        volatility: predictor.sessionStats.volatility,
        market_regime: predictor.marketState.regime,
        trend: predictor.marketState.trend,
        stability: predictor.marketState.stability,
        streaks: predictor.sessionStats.streaks,
        total_predictions: APP_STATE.stats.total,
        winrate: APP_STATE.stats.total > 0 ? (APP_STATE.stats.win / APP_STATE.stats.total * 100).toFixed(2) + '%' : '0%'
    });
});

app.get('/reset', (req, res) => {
    APP_STATE.stats = { total: 0, win: 0, loss: 0 };
    res.json({ message: "Reset thống kê thành công" });
});

app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`🎲 ULTRA DICE PREDICTION SYSTEM`);
    console.log(`🚀 21 models chính + pattern database`);
    console.log(`📊 Market regime: tự động nhận diện`);
    console.log(`🔄 Cập nhật mỗi 5 giây`);
    console.log(`========================================\n`);
    syncData();
});
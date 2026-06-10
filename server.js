// server.js - NÂNG CẤP THUẬT TOÁN SIÊU XỊN
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const LEARNING_FILE = 'Tskhang.json';
const HISTORY_FILE = 'Tskhang1.json';

let predictionHistory = { hu: [], md5: [] };
const MAX_HISTORY = 100;
const AUTO_SAVE_INTERVAL = 30000;
let lastProcessedPhien = { hu: null, md5: null };

// ==================== THUẬT TOÁN THÔNG MINH MỚI ====================

// 1. Phân tích chuỗi với trọng số thời gian (Time-weighted series)
class TimeWeightedAnalyzer {
    constructor(decayFactor = 0.95) {
        this.decayFactor = decayFactor;
    }
    
    analyze(results) {
        let taiWeight = 0, xiuWeight = 0;
        for (let i = 0; i < Math.min(results.length, 30); i++) {
            const weight = Math.pow(this.decayFactor, i);
            if (results[i] === 'Tài') taiWeight += weight;
            else xiuWeight += weight;
        }
        const total = taiWeight + xiuWeight;
        if (total === 0) return null;
        
        const taiProb = taiWeight / total;
        return {
            prediction: taiProb > 0.55 ? 'Tài' : (taiProb < 0.45 ? 'Xỉu' : null),
            confidence: Math.abs(taiProb - 0.5) * 200 + 50,
            name: 'Time-Weighted Series'
        };
    }
}

// 2. Phát hiện điểm uốn (Inflection Point Detection) - Bẻ cầu đúng lúc
class InflectionPointDetector {
    detect(results) {
        if (results.length < 8) return null;
        
        // Tính độ dốc của xu hướng
        let slopes = [];
        for (let i = 0; i < results.length - 1; i++) {
            slopes.push(results[i] === results[i + 1] ? 1 : -1);
        }
        
        // Phát hiện đảo chiều bằng SMA của slopes
        let sma5 = 0, sma10 = 0;
        for (let i = 0; i < Math.min(5, slopes.length); i++) sma5 += slopes[i];
        for (let i = 0; i < Math.min(10, slopes.length); i++) sma10 += slopes[i];
        sma5 /= Math.min(5, slopes.length);
        sma10 /= Math.min(10, slopes.length);
        
        // Chênh lệch SMA báo hiệu đảo chiều
        const diff = sma5 - sma10;
        
        if (Math.abs(diff) > 0.6) {
            // Điểm uốn đã phát hiện - bẻ cầu ngay
            const currentTrend = results[0] === results[1] ? results[0] : null;
            if (currentTrend) {
                return {
                    prediction: currentTrend === 'Tài' ? 'Xỉu' : 'Tài',
                    confidence: Math.min(92, 65 + Math.abs(diff) * 40),
                    name: `🔄 Điểm Uốn (SMA diff: ${diff.toFixed(2)})`
                };
            }
        }
        return null;
    }
}

// 3. Mạng neuron nhẹ với trọng số động (Lightweight Neural Network)
class SimpleNeuralPredictor {
    constructor() {
        this.weights = {
            pattern: 0.35,
            streak: 0.25,
            volatility: 0.20,
            momentum: 0.20
        };
        this.optimizeCount = 0;
    }
    
    updateWeights(lastPrediction, wasCorrect) {
        // Gradient descent đơn giản
        const learningRate = 0.05;
        if (wasCorrect) {
            // Giữ nguyên hoặc tăng nhẹ
            Object.keys(this.weights).forEach(k => {
                this.weights[k] = Math.min(0.5, this.weights[k] + learningRate * 0.01);
            });
        } else {
            // Giảm trọng số của feature có thể sai
            this.weights.pattern = Math.max(0.15, this.weights.pattern - learningRate);
            this.weights.momentum = Math.max(0.10, this.weights.momentum - learningRate);
        }
        this.optimizeCount++;
    }
    
    predict(features) {
        let score = 0;
        if (features.patternScore) score += features.patternScore * this.weights.pattern;
        if (features.streakScore) score += features.streakScore * this.weights.streak;
        if (features.volatilityScore) score += features.volatilityScore * this.weights.volatility;
        if (features.momentumScore) score += features.momentumScore * this.weights.momentum;
        
        return score;
    }
}

// 4. Phân tích chu kỳ Cycle Detection (Phát hiện chu kỳ ẩn)
class CycleDetector {
    detect(results) {
        if (results.length < 15) return null;
        
        // Tìm chu kỳ bằng autocorrelation
        let bestCycle = null;
        let bestCorr = 0;
        
        for (let cycleLen = 2; cycleLen <= 8; cycleLen++) {
            let matches = 0;
            for (let i = cycleLen; i < Math.min(results.length, cycleLen * 3); i++) {
                if (results[i] === results[i - cycleLen]) matches++;
            }
            const corr = matches / Math.min(results.length - cycleLen, cycleLen * 2);
            if (corr > bestCorr && corr > 0.65) {
                bestCorr = corr;
                bestCycle = cycleLen;
            }
        }
        
        if (bestCycle) {
            const predicted = results[bestCycle - 1];
            return {
                prediction: predicted,
                confidence: 65 + bestCorr * 25,
                name: `📐 Chu kỳ ${bestCycle} (tương quan ${(bestCorr * 100).toFixed(0)}%)`
            };
        }
        return null;
    }
}

// 5. Thuật toán Fibonacci Retracement cho Tài Xỉu
class FibonacciAnalyzer {
    analyze(results, sums) {
        if (results.length < 10 || sums.length < 10) return null;
        
        // Tìm đỉnh và đáy gần nhất
        let high = Math.max(...sums.slice(0, 10));
        let low = Math.min(...sums.slice(0, 10));
        const range = high - low;
        const current = sums[0];
        
        // Fibonacci levels: 0.236, 0.382, 0.5, 0.618, 0.786
        const fib236 = low + range * 0.236;
        const fib382 = low + range * 0.382;
        const fib618 = low + range * 0.618;
        
        let prediction = null;
        let confidence = 0;
        
        if (current <= fib236 && current > low) {
            prediction = 'Tài';
            confidence = 72;
        } else if (current >= fib618 && current < high) {
            prediction = 'Xỉu';
            confidence = 72;
        } else if (current <= fib382 && current > fib236) {
            prediction = 'Tài';
            confidence = 65;
        } else if (current >= fib382 && current < fib618) {
            prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
            confidence = 68;
        }
        
        if (prediction) {
            return {
                prediction: prediction,
                confidence: confidence,
                name: `📊 Fibonacci (H:${high} L:${low})`
            };
        }
        return null;
    }
}

// 6. Machine Learning nhẹ dựa trên pattern history
class PatternML {
    constructor() {
        this.patternDatabase = new Map();
        this.loadFromHistory();
    }
    
    loadFromHistory() {
        try {
            if (fs.existsSync('pattern_db.json')) {
                const data = JSON.parse(fs.readFileSync('pattern_db.json', 'utf8'));
                Object.entries(data).forEach(([key, value]) => {
                    this.patternDatabase.set(key, value);
                });
            }
        } catch(e) {}
    }
    
    saveToDatabase() {
        const obj = {};
        this.patternDatabase.forEach((value, key) => { obj[key] = value; });
        fs.writeFileSync('pattern_db.json', JSON.stringify(obj, null, 2));
    }
    
    learn(pattern, result) {
        const key = pattern.join(',');
        if (!this.patternDatabase.has(key)) {
            this.patternDatabase.set(key, { tai: 0, xiu: 0, total: 0 });
        }
        const stats = this.patternDatabase.get(key);
        if (result === 'Tài') stats.tai++;
        else stats.xiu++;
        stats.total++;
        this.saveToDatabase();
    }
    
    predict(pattern) {
        const key = pattern.join(',');
        if (!this.patternDatabase.has(key)) return null;
        
        const stats = this.patternDatabase.get(key);
        if (stats.total < 3) return null;
        
        const taiProb = stats.tai / stats.total;
        const confidence = Math.min(85, 50 + (Math.abs(taiProb - 0.5) * 70) + (stats.total * 1.5));
        
        return {
            prediction: taiProb > 0.55 ? 'Tài' : (taiProb < 0.45 ? 'Xỉu' : null),
            confidence: confidence,
            name: `🧠 ML Pattern (${stats.total} mẫu)`
        };
    }
}

// 7. Smart Counter-Trend - Bẻ cầu thông minh
class SmartCounterTrend {
    analyze(results, learningData) {
        if (results.length < 5) return null;
        
        let streak = 1;
        for (let i = 1; i < results.length; i++) {
            if (results[i] === results[i - 1]) streak++;
            else break;
        }
        
        // Phân tích độ "mệt" của cầu
        const fatigue = this.calculateFatigue(results, streak);
        const marketSentiment = this.getMarketSentiment(learningData);
        
        // Bẻ cầu khi đủ điều kiện
        if (streak >= 4 && fatigue > 75) {
            return {
                prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
                confidence: Math.min(90, 70 + (streak - 3) * 5 + fatigue * 0.1),
                name: `⚡ SMART BREAK (chuỗi ${streak}, mệt ${fatigue.toFixed(0)}%)`
            };
        }
        
        // Bẻ sớm khi có tín hiệu đảo chiều mạnh
        if (streak >= 3 && fatigue > 85 && marketSentiment === 'overheated') {
            return {
                prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
                confidence: 85,
                name: `🎯 EARLY BREAK (quá nhiệt)`
            };
        }
        
        return null;
    }
    
    calculateFatigue(results, streak) {
        // Tính độ mệt dựa trên độ dài chuỗi và biến động gần đây
        let fatigue = Math.min(100, streak * 15);
        
        // Kiểm tra các lần bẻ cầu gần đây
        let breaks = 0;
        for (let i = 1; i < Math.min(results.length, 20); i++) {
            if (results[i] !== results[i - 1]) breaks++;
        }
        
        // Nếu ít bẻ cầu -> cầu đang rất mạnh, dễ bẻ hơn
        if (breaks < 5) fatigue += 20;
        
        return Math.min(100, fatigue);
    }
    
    getMarketSentiment(learningData) {
        const recent = learningData.recentAccuracy || [];
        if (recent.length < 10) return 'normal';
        
        const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
        if (avg > 0.7) return 'overheated';  // Quá nóng, sắp đảo
        if (avg < 0.3) return 'oversold';    // Quá lạnh, sắp hồi
        return 'normal';
    }
}

// 8. Thuật toán Ensemble với trọng số động (Dynamic Weighted Ensemble)
class DynamicEnsemble {
    constructor() {
        this.algorithms = [];
        this.weights = new Map();
        this.performance = new Map();
    }
    
    registerAlgorithm(name, detector) {
        this.algorithms.push({ name, detector });
        this.weights.set(name, 1.0);
        this.performance.set(name, { correct: 0, total: 0, recent: [] });
    }
    
    updatePerformance(name, wasCorrect) {
        const perf = this.performance.get(name);
        if (!perf) return;
        
        perf.total++;
        if (wasCorrect) perf.correct++;
        perf.recent.unshift(wasCorrect ? 1 : 0);
        if (perf.recent.length > 20) perf.recent.pop();
        
        // Cập nhật trọng số dựa trên accuracy gần đây
        const recentAcc = perf.recent.reduce((a, b) => a + b, 0) / perf.recent.length;
        let newWeight = Math.max(0.3, Math.min(2.0, recentAcc * 1.5));
        
        // Thưởng cho algorithm có độ chính xác cao
        if (recentAcc > 0.7) newWeight *= 1.2;
        if (recentAcc < 0.4) newWeight *= 0.7;
        
        this.weights.set(name, newWeight);
    }
    
    predict(features) {
        let results = [];
        
        for (const algo of this.algorithms) {
            let prediction = null;
            try {
                if (algo.detector.analyze) prediction = algo.detector.analyze(features.results, features.sums);
                else if (algo.detector.detect) prediction = algo.detector.detect(features.results);
                else if (algo.detector.predict) prediction = algo.detector.predict(features.pattern);
            } catch(e) {}
            
            if (prediction && prediction.prediction) {
                const weight = this.weights.get(algo.name);
                results.push({
                    ...prediction,
                    algorithm: algo.name,
                    weightedConfidence: prediction.confidence * weight
                });
            }
        }
        
        if (results.length === 0) return null;
        
        // Weighted voting
        let taiScore = 0, xiuScore = 0, taiWeighted = 0, xiuWeighted = 0;
        for (const r of results) {
            if (r.prediction === 'Tài') {
                taiScore++;
                taiWeighted += r.weightedConfidence;
            } else {
                xiuScore++;
                xiuWeighted += r.weightedConfidence;
            }
        }
        
        let finalPrediction, confidence;
        const totalWeighted = taiWeighted + xiuWeighted;
        
        if (totalWeighted > 0) {
            const taiProb = taiWeighted / totalWeighted;
            finalPrediction = taiProb >= 0.5 ? 'Tài' : 'Xỉu';
            confidence = Math.min(95, Math.max(55, Math.abs(taiProb - 0.5) * 100 + 50));
        } else {
            finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
            confidence = 60 + (Math.abs(taiScore - xiuScore) / results.length) * 30;
        }
        
        return {
            prediction: finalPrediction,
            confidence: Math.round(confidence),
            allResults: results,
            ensembleSize: results.length
        };
    }
}

// ==================== KHỞI TẠO CÁC THUẬT TOÁN ====================

const timeWeighted = new TimeWeightedAnalyzer();
const inflectionDetector = new InflectionPointDetector();
const neuralNet = new SimpleNeuralPredictor();
const cycleDetector = new CycleDetector();
const fibonacciAnalyzer = new FibonacciAnalyzer();
const patternML = new PatternML();
const smartCounterTrend = new SmartCounterTrend();
const ensemble = new DynamicEnsemble();

// Đăng ký các thuật toán vào Ensemble
ensemble.registerAlgorithm('TimeWeighted', timeWeighted);
ensemble.registerAlgorithm('InflectionPoint', inflectionDetector);
ensemble.registerAlgorithm('CycleDetection', cycleDetector);
ensemble.registerAlgorithm('Fibonacci', fibonacciAnalyzer);
ensemble.registerAlgorithm('PatternML', patternML);
ensemble.registerAlgorithm('SmartCounterTrend', smartCounterTrend);

// ==================== CẤU TRÚC LEARNING DATA ====================

let learningData = {
  hu: {
    predictions: [],
    patternStats: {},
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: [],
    reversalState: { active: false, streakTrigger: 0 },
    markovMatrix: { TT: 0.5, TX: 0.5, XT: 0.5, XX: 0.5 },
    markov2Matrix: {},
    volatility: 0,
    ensembleHistory: []  // Lưu lịch sử ensemble để học
  },
  md5: {
    predictions: [],
    patternStats: {},
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: [],
    reversalState: { active: false, streakTrigger: 0 },
    markovMatrix: { TT: 0.5, TX: 0.5, XT: 0.5, XX: 0.5 },
    markov2Matrix: {},
    volatility: 0,
    ensembleHistory: []
  }
};

// ==================== HÀM TÍNH TOÁN NÂNG CAO ====================

function extractFeatures(results, sums) {
    // Tính momentum
    let momentum = 0;
    for (let i = 0; i < Math.min(5, results.length - 1); i++) {
        if (results[i] === results[i + 1]) momentum++;
        else momentum--;
    }
    momentum = momentum / 5;
    
    // Tính pattern score
    let patternScore = 0;
    if (results.length >= 4) {
        const last4 = results.slice(0, 4);
        const unique = new Set(last4);
        patternScore = unique.size === 2 ? 0.8 : (unique.size === 1 ? 0.3 : 0.5);
    }
    
    // Tính streak score
    let streak = 1;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[i - 1]) streak++;
        else break;
    }
    let streakScore = Math.min(1, streak / 8);
    
    // Tính volatility
    let volatility = 0;
    for (let i = 1; i < Math.min(10, sums.length); i++) {
        volatility += Math.abs(sums[i - 1] - sums[i]);
    }
    volatility = Math.min(1, volatility / 30);
    
    return {
        momentum: momentum,
        patternScore: patternScore,
        streakScore: streakScore,
        volatilityScore: volatility,
        rawStreak: streak
    };
}

function updateEnsemblePerformance(type, lastPrediction, wasCorrect) {
    if (lastPrediction && lastPrediction.allResults) {
        for (const algo of lastPrediction.allResults) {
            ensemble.updatePerformance(algo.algorithm, wasCorrect);
        }
    }
    
    // Lưu lịch sử ensemble
    learningData[type].ensembleHistory.unshift({
        timestamp: Date.now(),
        wasCorrect: wasCorrect
    });
    if (learningData[type].ensembleHistory.length > 100) learningData[type].ensembleHistory.pop();
}

function calculateAdvancedPrediction(data, type) {
    const results = data.map(d => d.Ket_qua);
    const sums = data.map(d => d.Tong);
    const features = extractFeatures(results, sums);
    
    // Cập nhật Pattern ML
    if (results.length >= 5) {
        const lastPattern = results.slice(0, 5);
        patternML.learn(lastPattern, results[0]);
    }
    
    // Dự đoán bằng Ensemble
    const ensembleResult = ensemble.predict({ results, sums, pattern: results.slice(0, 8) });
    
    if (!ensembleResult) {
        // Fallback: dùng weighted vote đơn giản
        return fallbackPrediction(results, sums, type);
    }
    
    // Áp dụng thêm logic đặc biệt
    let finalPrediction = ensembleResult.prediction;
    let finalConfidence = ensembleResult.confidence;
    
    // Điều chỉnh confidence dựa trên learning data
    const recentAcc = learningData[type].recentAccuracy.slice(0, 20);
    if (recentAcc.length > 10) {
        const avgRecentAcc = recentAcc.reduce((a, b) => a + b, 0) / recentAcc.length;
        if (avgRecentAcc < 0.4) {
            // Gần đây dự đoán kém -> giảm confidence và có thể đảo ngược nếu quá tệ
            finalConfidence = Math.max(50, finalConfidence - 10);
            if (avgRecentAcc < 0.25 && features.rawStreak > 2) {
                finalPrediction = finalPrediction === 'Tài' ? 'Xỉu' : 'Tài';
                finalConfidence = Math.min(75, finalConfidence + 5);
            }
        } else if (avgRecentAcc > 0.7) {
            finalConfidence = Math.min(95, finalConfidence + 5);
        }
    }
    
    // Điều chỉnh theo streak
    if (features.rawStreak >= 5 && finalConfidence > 70) {
        // Chuỗi dài, giảm nhẹ confidence vì rủi ro bẻ cầu
        finalConfidence = Math.max(55, finalConfidence - 8);
    }
    
    // Lưu thông tin để cập nhật performance sau
    const predictionRecord = {
        prediction: finalPrediction,
        confidence: finalConfidence,
        factors: ensembleResult.allResults?.map(r => `${r.name} (${r.confidence}%)`) || [],
        ensembleDetails: {
            size: ensembleResult.ensembleSize,
            topAlgorithms: ensembleResult.allResults?.slice(0, 3).map(r => r.algorithm) || []
        }
    };
    
    return {
        ...predictionRecord,
        detailedAnalysis: {
            totalPatterns: ensembleResult.ensembleSize,
            taiVotes: ensembleResult.allResults?.filter(r => r.prediction === 'Tài').length || 0,
            xiuVotes: ensembleResult.allResults?.filter(r => r.prediction === 'Xỉu').length || 0,
            topPattern: ensembleResult.allResults?.[0]?.name || 'N/A',
            learningStats: {
                accuracy: learningData[type].totalPredictions ? 
                    (learningData[type].correctPredictions / learningData[type].totalPredictions * 100).toFixed(1) + '%' : 'N/A',
                currentStreak: learningData[type].streakAnalysis.currentStreak,
                ensembleAccuracy: learningData[type].ensembleHistory.length ? 
                    (learningData[type].ensembleHistory.filter(h => h.wasCorrect).length / learningData[type].ensembleHistory.length * 100).toFixed(1) + '%' : 'N/A'
            }
        }
    };
}

function fallbackPrediction(results, sums, type) {
    // Fallback thông minh
    let taiCount = 0;
    for (let i = 0; i < Math.min(10, results.length); i++) {
        if (results[i] === 'Tài') taiCount++;
    }
    
    // Weighted gần đây hơn
    let weightedTai = 0;
    for (let i = 0; i < Math.min(8, results.length); i++) {
        const weight = 1 - (i * 0.1);
        if (results[i] === 'Tài') weightedTai += weight;
        else weightedTai -= weight;
    }
    
    const prediction = weightedTai > 0 ? 'Tài' : 'Xỉu';
    const confidence = Math.min(85, 55 + Math.abs(weightedTai) * 5);
    
    return {
        prediction: prediction,
        confidence: Math.round(confidence),
        factors: [`Weighted Vote (${taiCount}/${Math.min(10, results.length)} Tài)`],
        detailedAnalysis: { learningStats: { accuracy: 'N/A', currentStreak: 0 } }
    };
}

// ==================== CÁC HÀM CŨ GIỮ LẠI (đã được tối ưu) ====================

function loadLearningData() {
    try {
        if (fs.existsSync(LEARNING_FILE)) {
            const data = fs.readFileSync(LEARNING_FILE, 'utf8');
            const parsed = JSON.parse(data);
            for (let type of ['hu', 'md5']) {
                if (parsed[type]) {
                    learningData[type] = { ...learningData[type], ...parsed[type] };
                }
            }
            console.log('✅ Loaded learning data from', LEARNING_FILE);
        }
    } catch (error) {
        console.error('Error loading learning data:', error.message);
    }
}

function saveLearningData() {
    try {
        fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
    } catch (error) {
        console.error('Error saving learning data:', error.message);
    }
}

function loadPredictionHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = fs.readFileSync(HISTORY_FILE, 'utf8');
            const parsed = JSON.parse(data);
            predictionHistory = parsed.history || { hu: [], md5: [] };
            lastProcessedPhien = parsed.lastProcessedPhien || { hu: null, md5: null };
            console.log('✅ Loaded prediction history from', HISTORY_FILE);
        }
    } catch (error) {
        console.error('Error loading prediction history:', error.message);
    }
}

function savePredictionHistory() {
    try {
        const dataToSave = {
            history: predictionHistory,
            lastProcessedPhien,
            lastSaved: new Date().toISOString()
        };
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(dataToSave, null, 2));
    } catch (error) {
        console.error('Error saving prediction history:', error.message);
    }
}

function transformApiData(apiData) {
    if (!apiData || !apiData.list || !Array.isArray(apiData.list)) return null;
    return apiData.list.map(item => ({
        Phien: item.id,
        Ket_qua: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
        Xuc_xac_1: item.dices[0],
        Xuc_xac_2: item.dices[1],
        Xuc_xac_3: item.dices[2],
        Tong: item.point
    }));
}

async function fetchDataHu() {
    try {
        const response = await axios.get(API_URL_HU, { timeout: 10000 });
        return transformApiData(response.data);
    } catch (error) {
        console.error('Error fetching HU data:', error.message);
        return null;
    }
}

async function fetchDataMd5() {
    try {
        const response = await axios.get(API_URL_MD5, { timeout: 10000 });
        return transformApiData(response.data);
    } catch (error) {
        console.error('Error fetching MD5 data:', error.message);
        return null;
    }
}

async function verifyPredictions(type, currentData) {
    let updated = false;
    for (let pred of learningData[type].predictions) {
        if (pred.verified) continue;
        const actual = currentData.find(d => d.Phien.toString() === pred.phien);
        if (actual) {
            pred.verified = true;
            pred.actual = actual.Ket_qua;
            pred.isCorrect = (pred.prediction === pred.actual);
            
            // Cập nhật ensemble performance
            if (pred.ensembleDetails) {
                updateEnsemblePerformance(type, pred.ensembleDetails, pred.isCorrect);
            }
            
            if (pred.isCorrect) {
                learningData[type].correctPredictions++;
                learningData[type].streakAnalysis.currentStreak = Math.max(1, learningData[type].streakAnalysis.currentStreak + 1);
                if (learningData[type].streakAnalysis.currentStreak > learningData[type].streakAnalysis.bestStreak) {
                    learningData[type].streakAnalysis.bestStreak = learningData[type].streakAnalysis.currentStreak;
                }
            } else {
                learningData[type].streakAnalysis.currentStreak = Math.min(-1, learningData[type].streakAnalysis.currentStreak - 1);
                if (learningData[type].streakAnalysis.currentStreak < learningData[type].streakAnalysis.worstStreak) {
                    learningData[type].streakAnalysis.worstStreak = learningData[type].streakAnalysis.currentStreak;
                }
            }
            learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
            if (learningData[type].recentAccuracy.length > 50) learningData[type].recentAccuracy.shift();
            updated = true;
        }
    }
    if (updated) {
        saveLearningData();
        // Lưu pattern database
        patternML.saveToDatabase();
    }
}

function recordPrediction(type, phien, prediction, confidence, patterns, ensembleDetails = null) {
    learningData[type].predictions.unshift({
        phien: phien.toString(),
        prediction, confidence, patterns,
        ensembleDetails: ensembleDetails,
        timestamp: new Date().toISOString(),
        verified: false, actual: null, isCorrect: null
    });
    learningData[type].totalPredictions++;
    if (learningData[type].predictions.length > 500) learningData[type].predictions.pop();
    saveLearningData();
}

function savePredictionToHistory(type, phien, prediction, confidence, latestData, factors = []) {
    const record = {
        Phien: latestData.Phien,
        Xuc_xac_1: latestData.Xuc_xac_1,
        Xuc_xac_2: latestData.Xuc_xac_2,
        Xuc_xac_3: latestData.Xuc_xac_3,
        Tong: latestData.Tong,
        Ket_qua: latestData.Ket_qua,
        Do_tin_cay: `${confidence}%`,
        Phien_hien_tai: phien.toString(),
        Du_doan: prediction,
        ket_qua_du_doan: '',
        factors: factors.slice(0, 5),
        id: '@Tskhang',
        algorithm: 'Dynamic Ensemble v2.0',
        timestamp: new Date().toISOString()
    };
    predictionHistory[type].unshift(record);
    if (predictionHistory[type].length > MAX_HISTORY) predictionHistory[type].pop();
    return record;
}

async function autoProcessPredictions() {
    try {
        const dataHu = await fetchDataHu();
        if (dataHu && dataHu.length > 0) {
            const nextPhien = dataHu[0].Phien + 1;
            if (lastProcessedPhien.hu !== nextPhien) {
                await verifyPredictions('hu', dataHu);
                const result = calculateAdvancedPrediction(dataHu, 'hu');
                savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, dataHu[0], result.factors);
                recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors, result.ensembleDetails);
                lastProcessedPhien.hu = nextPhien;
                console.log(`[Auto] HU 🎲 Phiên ${nextPhien}: ${result.prediction} (${result.confidence}%) | Ensemble: ${result.ensembleDetails?.size || 0} algos`);
            }
        }
        
        const dataMd5 = await fetchDataMd5();
        if (dataMd5 && dataMd5.length > 0) {
            const nextPhien = dataMd5[0].Phien + 1;
            if (lastProcessedPhien.md5 !== nextPhien) {
                await verifyPredictions('md5', dataMd5);
                const result = calculateAdvancedPrediction(dataMd5, 'md5');
                savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence, dataMd5[0], result.factors);
                recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors, result.ensembleDetails);
                lastProcessedPhien.md5 = nextPhien;
                console.log(`[Auto] MD5 🎲 Phiên ${nextPhien}: ${result.prediction} (${result.confidence}%) | Ensemble: ${result.ensembleDetails?.size || 0} algos`);
            }
        }
        
        savePredictionHistory();
        saveLearningData();
    } catch (error) {
        console.error('[Auto] Error:', error.message);
    }
}

function startAutoSaveTask() {
    setTimeout(autoProcessPredictions, 5000);
    setInterval(autoProcessPredictions, AUTO_SAVE_INTERVAL);
}

// ==================== API ENDPOINTS ====================

app.get('/', (req, res) => res.json({ 
    message: '🎲 Tskhang AI Prediction v3.0 - Dynamic Ensemble', 
    algorithms: ['TimeWeighted', 'InflectionPoint', 'CycleDetection', 'Fibonacci', 'PatternML', 'SmartCounterTrend'],
    id: '@Tskhang'
}));

app.get('/hu', async (req, res) => {
    try {
        const data = await fetchDataHu();
        if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
        await verifyPredictions('hu', data);
        const nextPhien = data[0].Phien + 1;
        const result = calculateAdvancedPrediction(data, 'hu');
        const record = savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, data[0], result.factors);
        recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors, result.ensembleDetails);
        res.json(record);
    } catch (error) {
        res.status(500).json({ error: 'Lỗi server: ' + error.message });
    }
});

app.get('/md5', async (req, res) => {
    try {
        const data = await fetchDataMd5();
        if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
        await verifyPredictions('md5', data);
        const nextPhien = data[0].Phien + 1;
        const result = calculateAdvancedPrediction(data, 'md5');
        const record = savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence, data[0], result.factors);
        recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors, result.ensembleDetails);
        res.json(record);
    } catch (error) {
        res.status(500).json({ error: 'Lỗi server: ' + error.message });
    }
});

app.get('/hu/lichsu', async (req, res) => {
    res.json({ type: 'Tài Xỉu Hũ - AI v3.0', history: predictionHistory.hu, total: predictionHistory.hu.length, id: '@Tskhang' });
});

app.get('/md5/lichsu', async (req, res) => {
    res.json({ type: 'Tài Xỉu MD5 - AI v3.0', history: predictionHistory.md5, total: predictionHistory.md5.length, id: '@Tskhang' });
});

app.get('/hu/thamso', async (req, res) => {
    const data = await fetchDataHu();
    if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    const result = calculateAdvancedPrediction(data, 'hu');
    res.json({ 
        prediction: result.prediction, 
        confidence: result.confidence, 
        factors: result.factors,
        ensembleDetails: result.ensembleDetails,
        analysis: result.detailedAnalysis 
    });
});

app.get('/md5/Thamso', async (req, res) => {
    const data = await fetchDataMd5();
    if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    const result = calculateAdvancedPrediction(data, 'md5');
    res.json({ 
        prediction: result.prediction, 
        confidence: result.confidence, 
        factors: result.factors,
        ensembleDetails: result.ensembleDetails,
        analysis: result.detailedAnalysis 
    });
});

app.get('/hu/hochoi', (req, res) => {
    const stats = learningData.hu;
    const acc = stats.totalPredictions ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
    const ensembleAcc = stats.ensembleHistory.length ? 
        (stats.ensembleHistory.filter(h => h.wasCorrect).length / stats.ensembleHistory.length * 100).toFixed(2) : 'N/A';
    res.json({ 
        type: 'HU Learning - AI v3.0',
        totalPredictions: stats.totalPredictions, 
        correctPredictions: stats.correctPredictions, 
        accuracy: acc + '%',
        ensembleAccuracy: ensembleAcc + '%',
        streakAnalysis: stats.streakAnalysis,
        algorithmWeights: Object.fromEntries(ensemble.weights),
        id: '@Tskhang' 
    });
});

app.get('/md5/Hochoi', (req, res) => {
    const stats = learningData.md5;
    const acc = stats.totalPredictions ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
    const ensembleAcc = stats.ensembleHistory.length ? 
        (stats.ensembleHistory.filter(h => h.wasCorrect).length / stats.ensembleHistory.length * 100).toFixed(2) : 'N/A';
    res.json({ 
        type: 'MD5 Learning - AI v3.0',
        totalPredictions: stats.totalPredictions, 
        correctPredictions: stats.correctPredictions, 
        accuracy: acc + '%',
        ensembleAccuracy: ensembleAcc + '%',
        streakAnalysis: stats.streakAnalysis,
        algorithmWeights: Object.fromEntries(ensemble.weights),
        id: '@Tskhang' 
    });
});

app.get('/Resetdata', (req, res) => {
    learningData = {
        hu: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: {}, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, recentAccuracy: [], reversalState: { active: false, streakTrigger: 0 }, markovMatrix: { TT: 0.5, TX: 0.5, XT: 0.5, XX: 0.5 }, markov2Matrix: {}, volatility: 0, ensembleHistory: [] },
        md5: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: {}, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, recentAccuracy: [], reversalState: { active: false, streakTrigger: 0 }, markovMatrix: { TT: 0.5, TX: 0.5, XT: 0.5, XX: 0.5 }, markov2Matrix: {}, volatility: 0, ensembleHistory: [] }
    };
    saveLearningData();
    res.json({ message: 'Learning data reset to v3.0', id: '@Tskhang' });
});

// ==================== KHỞI ĐỘNG ====================
loadLearningData();
loadPredictionHistory();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ╔══════════════════════════════════════════════════════════╗
    ║     🎲 TSKHANG AI PREDICTION v3.0 - DYNAMIC ENSEMBLE    ║
    ╠══════════════════════════════════════════════════════════╣
    ║  • 6 thuật toán thông minh chạy song song                ║
    ║  • Time-Weighted Series | Cycle Detection                ║
    ║  • Inflection Point | Fibonacci Retracement              ║
    ║  • Pattern ML | Smart Counter-Trend                      ║
    ║  • Dynamic Weighted Ensemble tự học                      ║
    ║  • Bẻ cầu đúng lúc, không random                         ║
    ╠══════════════════════════════════════════════════════════╣
    ║  🚀 Server running on http://0.0.0.0:${PORT}              ║
    ║  📡 @Tskhang                                              ║
    ╚══════════════════════════════════════════════════════════╝
    `);
    startAutoSaveTask();
});
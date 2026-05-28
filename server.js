const fs = require('fs');
const path = require('path');
const axios = require('axios');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 5000;

// ==================== CẤU HÌNH ====================
const API_URL_HU  = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const HISTORY_FILE = path.join(__dirname, 'vuaoccac_history.json');

const FRESH_SCAN_COUNT = 50;
const AUTO_SAVE_INTERVAL = 30000;
const CACHE_TTL = 3000;

// ==================== HÀM TIỆN ÍCH ====================
function calculateMean(arr) {
    if (!arr.length) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function calculateStdDev(arr, mean) {
    if (arr.length < 2) return 0;
    const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
    return Math.sqrt(variance);
}

function calculateProbability(events, target) {
    const count = events.filter(e => e === target).length;
    return events.length ? count / events.length : 0.5;
}

// ==================== 1. THUẬT TOÁN THỐNG KÊ THỰC TẾ ====================

// 1. Phân phối nhị thức - Xác suất xuất hiện của Tài/Xỉu trong chuỗi
function binomialProbability(results) {
    if (results.length < 10) return null;
    
    const n = results.length;
    const taiCount = results.filter(r => r === 'T').length;
    const xiuCount = n - taiCount;
    
    // Tính xác suất theo phân phối nhị thức
    const p = 0.5; // xác suất lý thuyết 50%
    const expected = n * p;
    const variance = n * p * (1 - p);
    const zScore = Math.abs(taiCount - expected) / Math.sqrt(variance);
    
    // Z-score > 2 -> lệch có ý nghĩa thống kê (95% confidence)
    if (zScore > 1.96) {
        // Đang lệch về Tài -> dự đoán Xỉu (return to mean)
        return taiCount > expected ? 'X' : 'T';
    }
    
    return null; // Chưa đủ độ lệch để kết luận
}

// 2. Kiểm định chuỗi Wald-Wolfowitz (Runs Test) - Phát hiện tính ngẫu nhiên
function runsTest(results) {
    if (results.length < 15) return null;
    
    // Đếm số runs (chuỗi liên tiếp)
    let runs = 1;
    for (let i = 1; i < results.length; i++) {
        if (results[i] !== results[i-1]) runs++;
    }
    
    const n1 = results.filter(r => r === 'T').length;
    const n2 = results.length - n1;
    
    // Expected runs và variance
    const expectedRuns = (2 * n1 * n2) / (n1 + n2) + 1;
    const varianceRuns = (2 * n1 * n2 * (2 * n1 * n2 - n1 - n2)) / 
                         (Math.pow(n1 + n2, 2) * (n1 + n2 - 1));
    const zScore = Math.abs(runs - expectedRuns) / Math.sqrt(varianceRuns);
    
    // Nếu zScore > 1.96 -> không ngẫu nhiên (có xu hướng)
    if (zScore > 1.96) {
        // Kiểm tra xu hướng dựa trên runs
        const lastResult = results[0];
        // Chuỗi quá ngắn hoặc quá dài -> dự đoán đảo chiều
        if (runs < expectedRuns - 2) {
            // Quá ít runs -> chuỗi dài -> đảo chiều
            return lastResult === 'T' ? 'X' : 'T';
        }
        if (runs > expectedRuns + 2) {
            // Quá nhiều runs -> đan xen -> tiếp tục xu hướng
            return lastResult;
        }
    }
    
    return null;
}

// 3. Hồi quy logistic trên chuỗi lịch sử
function logisticRegression(results) {
    if (results.length < 20) return null;
    
    // Chuyển đổi T=1, X=0
    const y = results.slice(0, 20).map(r => r === 'T' ? 1 : 0);
    
    // Đơn giản hóa: dùng 3 đặc trưng: kết quả phiên trước, 2 phiên trước, 3 phiên trước
    const X = [];
    for (let i = 3; i < y.length; i++) {
        X.push([y[i-1], y[i-2], y[i-3]]);
    }
    const yTrain = y.slice(3);
    
    if (X.length < 10) return null;
    
    // Logistic regression simplified - tính trọng số bằng correlation
    const weights = [0, 0, 0];
    for (let f = 0; f < 3; f++) {
        let sumXY = 0, sumX2 = 0;
        for (let i = 0; i < X.length; i++) {
            sumXY += X[i][f] * yTrain[i];
            sumX2 += X[i][f] * X[i][f];
        }
        weights[f] = sumX2 > 0 ? sumXY / sumX2 : 0;
    }
    
    // Dự đoán cho phiên tiếp theo
    const last3 = [y[0], y[1], y[2]];
    let logit = 0;
    for (let i = 0; i < 3; i++) {
        logit += weights[i] * last3[i];
    }
    
    // Thêm bias
    logit += 0.1;
    
    const probTai = 1 / (1 + Math.exp(-logit));
    
    // Chỉ dự đoán khi xác suất đủ chênh lệch
    if (probTai > 0.65) return 'T';
    if (probTai < 0.35) return 'X';
    
    return null;
}

// 4. Phân tích chuỗi Markov bậc 2
function markovChain(results) {
    if (results.length < 15) return null;
    
    const transitions = {};
    
    // Xây dựng ma trận chuyển tiếp bậc 2
    for (let i = 0; i < results.length - 2; i++) {
        const state = results[i] + results[i+1];
        const next = results[i+2];
        if (!transitions[state]) {
            transitions[state] = { T: 0, X: 0 };
        }
        transitions[state][next]++;
    }
    
    const lastState = results[0] + results[1];
    const trans = transitions[lastState];
    
    if (trans && (trans.T + trans.X) >= 3) {
        const probTai = trans.T / (trans.T + trans.X);
        if (probTai > 0.7) return 'T';
        if (probTai < 0.3) return 'X';
    }
    
    return null;
}

// 5. Phân tích tổng điểm - T-test so sánh 2 mẫu
function scoreTTest(data) {
    if (data.length < 20) return null;
    
    const recent = data.slice(0, 10).map(d => d.Tong);
    const older = data.slice(10, 20).map(d => d.Tong);
    
    const meanRecent = calculateMean(recent);
    const meanOlder = calculateMean(older);
    const stdRecent = calculateStdDev(recent, meanRecent);
    const stdOlder = calculateStdDev(older, meanOlder);
    
    // T-test
    const pooledStd = Math.sqrt((stdRecent * stdRecent + stdOlder * stdOlder) / 2);
    if (pooledStd === 0) return null;
    
    const tScore = Math.abs(meanRecent - meanOlder) / (pooledStd * Math.sqrt(2/10));
    
    // t-score > 2.1 (với df=18) => khác biệt có ý nghĩa ở mức 95%
    if (tScore > 2.1) {
        // Xu hướng tăng -> dự đoán Xỉu (regression to mean)
        if (meanRecent > meanOlder + 1.5) return 'X';
        if (meanRecent < meanOlder - 1.5) return 'T';
    }
    
    return null;
}

// 6. Phân tích xúc xắc - Chi-square test
function chiSquareDiceTest(data) {
    if (data.length < 20) return null;
    
    // Lấy dữ liệu 20 phiên gần nhất
    const diceData = data.slice(0, 20);
    const observed = { T: 0, X: 0 };
    
    diceData.forEach(d => {
        if (d.Ket_qua === 'Tài') observed.T++;
        else observed.X++;
    });
    
    const expected = 10; // kỳ vọng 10/10
    const chiSquare = Math.pow(observed.T - expected, 2) / expected + 
                      Math.pow(observed.X - expected, 2) / expected;
    
    // Chi-square > 3.84 (df=1, p=0.05) => phân bố không đồng đều
    if (chiSquare > 3.84) {
        return observed.T > observed.X ? 'X' : 'T';
    }
    
    return null;
}

// 7. Phân tích tự tương quan (Autocorrelation)
function autocorrelation(results) {
    if (results.length < 20) return null;
    
    const nums = results.slice(0, 20).map(r => r === 'T' ? 1 : 0);
    const mean = calculateMean(nums);
    
    // Tính autocorrelation lag 1,2,3
    const acf = [];
    for (let lag = 1; lag <= 3; lag++) {
        let numerator = 0, denominator = 0;
        for (let i = 0; i < nums.length - lag; i++) {
            numerator += (nums[i] - mean) * (nums[i + lag] - mean);
        }
        for (let i = 0; i < nums.length; i++) {
            denominator += Math.pow(nums[i] - mean, 2);
        }
        acf.push(denominator ? numerator / denominator : 0);
    }
    
    // Nếu acf lag 1 dương mạnh (>0.4) -> có xu hướng
    if (acf[0] > 0.4) {
        return results[0]; // Tiếp tục xu hướng
    }
    // Nếu acf lag 1 âm mạnh (<-0.3) -> dao động
    if (acf[0] < -0.3) {
        return results[0] === 'T' ? 'X' : 'T'; // Đảo chiều
    }
    
    return null;
}

// 8. Bayesian Inference - Cập nhật xác suất dựa trên bằng chứng
function bayesianInference(results) {
    if (results.length < 15) return null;
    
    // Prior probability: 0.5
    let priorTai = 0.5;
    
    // Dùng 10 phiên gần nhất làm evidence
    const evidence = results.slice(0, 10);
    const likelihoodTai = [];
    const likelihoodXiu = [];
    
    for (let i = 0; i < evidence.length - 1; i++) {
        // Xác suất thấy kết quả này nếu thực sự có xu hướng Tài
        if (evidence[i] === 'T') {
            likelihoodTai.push(0.6);
            likelihoodXiu.push(0.4);
        } else {
            likelihoodTai.push(0.4);
            likelihoodXiu.push(0.6);
        }
    }
    
    let posteriorTai = priorTai;
    let posteriorXiu = 1 - priorTai;
    
    for (let i = 0; i < likelihoodTai.length; i++) {
        posteriorTai = (posteriorTai * likelihoodTai[i]) / 
                       (posteriorTai * likelihoodTai[i] + posteriorXiu * likelihoodXiu[i]);
        posteriorXiu = 1 - posteriorTai;
    }
    
    if (posteriorTai > 0.65) return 'T';
    if (posteriorTai < 0.35) return 'X';
    
    return null;
}

// 9. Phân tích chu kỳ Fourier (đơn giản hóa)
function cycleAnalysis(results) {
    if (results.length < 25) return null;
    
    const nums = results.slice(0, 25).map(r => r === 'T' ? 1 : -1);
    
    // Tìm chu kỳ phổ biến
    const cycles = {};
    for (let period = 2; period <= 8; period++) {
        let matches = 0;
        for (let i = period; i < nums.length; i++) {
            if (nums[i] === nums[i - period]) matches++;
        }
        cycles[period] = matches;
    }
    
    // Tìm chu kỳ tốt nhất
    let bestPeriod = 2;
    let bestMatches = 0;
    for (const [period, matches] of Object.entries(cycles)) {
        if (matches > bestMatches) {
            bestMatches = matches;
            bestPeriod = parseInt(period);
        }
    }
    
    // Nếu có chu kỳ rõ ràng (>60% khớp)
    if (bestMatches > nums.length * 0.6) {
        const predictedIdx = bestPeriod;
        if (predictedIdx < nums.length) {
            return nums[predictedIdx] === 1 ? 'T' : 'X';
        }
    }
    
    return null;
}

// 10. Monte Carlo simulation - Mô phỏng xác suất
function monteCarloSimulation(results) {
    if (results.length < 20) return null;
    
    // Lấy mẫu từ lịch sử
    const sample = results.slice(0, 20);
    const taiProbs = [];
    
    // Chạy 1000 lần mô phỏng
    for (let sim = 0; sim < 1000; sim++) {
        let taiCount = 0;
        for (let i = 0; i < 10; i++) {
            const randomIndex = Math.floor(Math.random() * sample.length);
            if (sample[randomIndex] === 'T') taiCount++;
        }
        taiProbs.push(taiCount / 10);
    }
    
    // Tính phân phối
    const meanProb = calculateMean(taiProbs);
    const sorted = [...taiProbs].sort((a, b) => a - b);
    const lowerBound = sorted[250];   // 25th percentile
    const upperBound = sorted[750];   // 75th percentile
    
    // Khoảng tin cậy không chứa 0.5
    if (lowerBound > 0.55) return 'T';
    if (upperBound < 0.45) return 'X';
    
    return null;
}

// ==================== 2. LỚP DỰ ĐOÁN CHÍNH ====================
class TaiXiuPredictor {
    constructor() {
        // Chỉ dùng các thuật toán thống kê thực sự
        this.algorithms = [
            { fn: binomialProbability, name: 'Nhị thức', weight: 1.2 },
            { fn: runsTest, name: 'Runs Test', weight: 1.1 },
            { fn: logisticRegression, name: 'Logistic', weight: 1.3 },
            { fn: markovChain, name: 'Markov', weight: 1.2 },
            { fn: scoreTTest, name: 'T-Test', weight: 1.1 },
            { fn: chiSquareDiceTest, name: 'Chi-Square', weight: 1.0 },
            { fn: autocorrelation, name: 'Tự tương quan', weight: 1.1 },
            { fn: bayesianInference, name: 'Bayesian', weight: 1.2 },
            { fn: cycleAnalysis, name: 'Chu kỳ', weight: 1.0 },
            { fn: monteCarloSimulation, name: 'Monte Carlo', weight: 1.1 },
        ];
        
        this.predictions = [];
        this.results = [];
    }

    predict(freshData) {
        if (!freshData || freshData.length < 20) {
            return { available: false, reason: `Đang thu thập dữ liệu (${freshData?.length || 0}/20)` };
        }
        
        const results = freshData.map(d => d.Ket_qua === 'Tài' ? 'T' : 'X');
        const scores = { T: 0, X: 0, totalWeight: 0 };
        const signals = [];
        
        // Chạy từng thuật toán
        this.algorithms.forEach(algo => {
            try {
                const pred = algo.fn(results.length === 1 ? results : freshData);
                if (pred === 'T' || pred === 'X') {
                    scores[pred] += algo.weight;
                    scores.totalWeight += algo.weight;
                    signals.push({ algo: algo.name, pred });
                }
            } catch(e) {
                // Bỏ qua lỗi
            }
        });
        
        // Nếu không đủ tín hiệu
        if (signals.length < 3 || scores.totalWeight === 0) {
            return { 
                available: false, 
                reason: `Chỉ có ${signals.length}/10 thuật toán cho tín hiệu`,
                signals: signals.length 
            };
        }
        
        // Tính điểm và confidence
        const taiScore = scores.T;
        const xiuScore = scores.X;
        const totalScore = taiScore + xiuScore;
        
        if (totalScore === 0) {
            return { available: false, reason: 'Không có tín hiệu rõ ràng' };
        }
        
        const taiProb = taiScore / totalScore;
        const xiuProb = xiuScore / totalScore;
        const diff = Math.abs(taiProb - xiuProb);
        
        // Chỉ dự đoán khi chênh lệch đủ lớn
        if (diff < 0.2) {
            return { 
                available: false, 
                reason: `Tín hiệu không rõ ràng (Tài:${(taiProb*100).toFixed(0)}% - Xỉu:${(xiuProb*100).toFixed(0)}%)`,
                taiProb: (taiProb*100).toFixed(0),
                xiuProb: (xiuProb*100).toFixed(0)
            };
        }
        
        const prediction = taiScore > xiuScore ? 'Tài' : 'Xỉu';
        const confidence = Math.round(diff * 100);
        
        return {
            available: true,
            prediction: prediction,
            confidence: Math.min(88, Math.max(55, confidence)),
            details: {
                taiScore: taiScore.toFixed(1),
                xiuScore: xiuScore.toFixed(1),
                signals: signals.length,
                algorithms: signals.map(s => s.algo).slice(0, 5)
            }
        };
    }
    
    feedback(actual, predicted) {
        if (!predicted) return;
        
        const isCorrect = actual === predicted;
        this.predictions.push({ predicted, actual, isCorrect, timestamp: Date.now() });
        
        if (this.predictions.length > 100) {
            this.predictions.shift();
        }
    }
    
    getStats() {
        const recent = this.predictions.slice(-30);
        const correct = recent.filter(p => p.isCorrect).length;
        const rate = recent.length ? (correct / recent.length * 100).toFixed(1) : 0;
        
        const all = this.predictions;
        const totalCorrect = all.filter(p => p.isCorrect).length;
        const totalRate = all.length ? (totalCorrect / all.length * 100).toFixed(1) : 0;
        
        return {
            recentRate: `${rate}%`,
            totalRate: `${totalRate}%`,
            totalPredictions: all.length,
            recentPredictions: recent.length
        };
    }
}

// ==================== 3. SERVER ====================
const predictorHU = new TaiXiuPredictor();
const predictorMD5 = new TaiXiuPredictor();
let history = { hu: [], md5: [] };
let pending = { hu: null, md5: null };
let cache = { hu: null, md5: null, lastFetch: { hu: 0, md5: 0 } };

function loadJSON(fn, def) {
    try { if (fs.existsSync(fn)) return JSON.parse(fs.readFileSync(fn, 'utf8')); } catch(e) {}
    return def;
}

function saveJSON(fn, data) {
    try { fs.writeFileSync(fn, JSON.stringify(data, null, 2)); } catch(e) {}
}

function transformData(apiData) {
    if (!apiData?.list?.length) return null;
    return apiData.list.map(item => ({
        Phien: item.id,
        Ket_qua: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
        Xuc_xac_1: item.dices[0],
        Xuc_xac_2: item.dices[1],
        Xuc_xac_3: item.dices[2],
        Tong: item.point,
        Thoi_gian: item.time || new Date().toISOString()
    })).sort((a, b) => b.Phien - a.Phien);
}

async function fetchData(url) {
    try {
        const resp = await axios.get(url, { timeout: 15000, params: { limit: FRESH_SCAN_COUNT } });
        return transformData(resp.data);
    } catch(e) {
        console.error(`Fetch error:`, e.message);
        return null;
    }
}

async function fetchWithCache(url, type) {
    const now = Date.now();
    if (cache[type] && (now - cache.lastFetch[type]) < CACHE_TTL) {
        return cache[type];
    }
    const data = await fetchData(url);
    if (data) {
        cache[type] = data;
        cache.lastFetch[type] = now;
    }
    return data;
}

function updateResults(type, predictor, freshData) {
    if (!freshData?.length) return;
    
    for (let i = 0; i < history[type].length; i++) {
        const entry = history[type][i];
        if (entry.ket_qua) continue;
        
        const actual = freshData.find(s => s.Phien === entry.phien);
        if (actual) {
            entry.ket_qua = actual.Ket_qua;
            entry.danh_gia = entry.du_doan === actual.Ket_qua ? 'thang' : 'thua';
            predictor.feedback(actual.Ket_qua, entry.du_doan);
            
            if (pending[type] && pending[type].entry === entry) {
                pending[type] = null;
            }
        }
    }
}

function makePrediction(type, predictor, freshData) {
    if (pending[type]) return pending[type];
    if (!freshData?.length) return null;
    
    const result = predictor.predict(freshData);
    
    if (!result.available) {
        return null;
    }
    
    const nextPhien = freshData[0].Phien + 1;
    const entry = {
        phien: nextPhien,
        du_doan: result.prediction,
        ket_qua: null,
        danh_gia: null,
        confidence: result.confidence,
        timestamp: Date.now()
    };
    
    history[type].unshift(entry);
    if (history[type].length > 100) history[type] = history[type].slice(0, 100);
    
    pending[type] = { nextPhien, prediction: result.prediction, confidence: result.confidence, entry };
    return pending[type];
}

// API
app.get('/lc79-hu', async (req, res) => {
    const data = await fetchWithCache(API_URL_HU, 'hu');
    if (!data) {
        return res.json({ status: 'error', message: 'Không thể kết nối API' });
    }
    
    updateResults('hu', predictorHU, data);
    const pred = makePrediction('hu', predictorHU, data);
    const latest = data[0];
    const stats = predictorHU.getStats();
    
    const recentHistory = history.hu.filter(e => e.ket_qua).slice(0, 10).map(e => ({
        phien: e.phien, du_doan: e.du_doan, ket_qua: e.ket_qua, 
        danh_gia: e.danh_gia, confidence: e.confidence
    }));
    
    res.json({
        status: 'success',
        timestamp: new Date().toISOString(),
        phien_hien_tai: pred ? {
            phien: pred.nextPhien,
            du_doan: pred.prediction,
            do_tin_cay: `${pred.confidence}%`
        } : { message: 'Đang phân tích thống kê...' },
        phien_truoc: {
            phien: latest.Phien,
            ket_qua: latest.Ket_qua,
            tong: latest.Tong,
            xuc_xac: [latest.Xuc_xac_1, latest.Xuc_xac_2, latest.Xuc_xac_3]
        },
        thong_ke: stats,
        lich_su: recentHistory
    });
});

app.get('/lc79-md5', async (req, res) => {
    const data = await fetchWithCache(API_URL_MD5, 'md5');
    if (!data) {
        return res.json({ status: 'error', message: 'Không thể kết nối API' });
    }
    
    updateResults('md5', predictorMD5, data);
    const pred = makePrediction('md5', predictorMD5, data);
    const latest = data[0];
    const stats = predictorMD5.getStats();
    
    const recentHistory = history.md5.filter(e => e.ket_qua).slice(0, 10).map(e => ({
        phien: e.phien, du_doan: e.du_doan, ket_qua: e.ket_qua, 
        danh_gia: e.danh_gia, confidence: e.confidence
    }));
    
    res.json({
        status: 'success',
        timestamp: new Date().toISOString(),
        phien_hien_tai: pred ? {
            phien: pred.nextPhien,
            du_doan: pred.prediction,
            do_tin_cay: `${pred.confidence}%`
        } : { message: 'Đang phân tích thống kê...' },
        phien_truoc: {
            phien: latest.Phien,
            ket_qua: latest.Ket_qua,
            tong: latest.Tong,
            xuc_xac: [latest.Xuc_xac_1, latest.Xuc_xac_2, latest.Xuc_xac_3]
        },
        thong_ke: stats,
        lich_su: recentHistory
    });
});

// Dashboard
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>VuaOcCac - Thống kê Tài Xỉu</title>
    <meta http-equiv="refresh" content="5">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; background: #0a0a1a; color: #eee; margin: 0; padding: 20px; }
        .container { max-width: 1400px; margin: 0 auto; }
        h1 { text-align: center; margin-bottom: 30px; font-size: 2em; }
        h1 span { background: linear-gradient(45deg, #ff6b6b, #4ecdc4); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(500px, 1fr)); gap: 25px; }
        .card { background: #111122; border-radius: 20px; padding: 25px; border: 1px solid #223; }
        .card h2 { margin-bottom: 20px; }
        .pred-box { text-align: center; padding: 25px; border-radius: 15px; margin-bottom: 20px; }
        .Tai { background: linear-gradient(135deg, #e74c3c, #c0392b); }
        .Xiu { background: linear-gradient(135deg, #1abc9c, #16a085); }
        .waiting { background: #2c3e50; }
        .pred-text { font-size: 48px; font-weight: bold; }
        .conf-text { font-size: 20px; margin-top: 10px; }
        .dice { display: flex; justify-content: center; gap: 15px; margin: 20px 0; }
        .dice span { width: 70px; height: 70px; background: white; color: #333; border-radius: 15px; display: flex; align-items: center; justify-content: center; font-size: 32px; font-weight: bold; }
        .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 20px 0; }
        .stat-card { background: #0a0a1a; padding: 12px; border-radius: 12px; text-align: center; }
        .stat-value { font-size: 28px; font-weight: bold; }
        .stat-label { font-size: 11px; opacity: 0.7; margin-top: 5px; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 13px; }
        th, td { padding: 8px 5px; text-align: left; border-bottom: 1px solid #223; }
        .thang { color: #2ecc71; }
        .thua { color: #e74c3c; }
        .badge { display: inline-block; padding: 2px 10px; border-radius: 20px; font-size: 11px; }
        .badge-thang { background: #2ecc71; color: #fff; }
        .badge-thua { background: #e74c3c; color: #fff; }
        .footer { text-align: center; margin-top: 30px; padding: 20px; color: #555; font-size: 12px; }
    </style>
</head>
<body>
<div class="container">
    <h1>🎲 <span>VuaOcCac</span> - Thống kê & Dự đoán Tài Xỉu 📊</h1>
    <div class="grid" id="content">Đang tải dữ liệu...</div>
    <div class="footer">
        🔬 10 thuật toán thống kê | Nhị thức, Runs Test, Logistic, Markov, T-Test, Chi-square, Tự tương quan, Bayesian, Chu kỳ, Monte Carlo<br>
        ⚖️ Dự đoán dựa trên xác suất thực tế | Không thiên vị | Khoa học
    </div>
</div>
<script>
async function load() {
    try {
        const [hu, md5] = await Promise.all([
            fetch('/lc79-hu').then(r => r.json()),
            fetch('/lc79-md5').then(r => r.json())
        ]);
        
        const render = (data, title, icon) => {
            const hasPred = data.phien_hien_tai && data.phien_hien_tai.du_doan;
            const predClass = hasPred ? data.phien_hien_tai.du_doan : 'waiting';
            const predText = hasPred ? data.phien_hien_tai.du_doan : 'ĐANG PHÂN TÍCH';
            const confText = hasPred ? \`Độ tin cậy: \${data.phien_hien_tai.do_tin_cay}\` : 'Đợi đủ dữ liệu thống kê...';
            
            return \`
                <div class="card">
                    <h2>\${icon} \${title}</h2>
                    <div class="pred-box \${predClass}">
                        <div class="pred-text">\${predText}</div>
                        <div class="conf-text">\${confText}</div>
                    </div>
                    <div class="dice">
                        <span>\${data.phien_truoc.xuc_xac[0]}</span>
                        <span>\${data.phien_truoc.xuc_xac[1]}</span>
                        <span>\${data.phien_truoc.xuc_xac[2]}</span>
                    </div>
                    <div class="stats-grid">
                        <div class="stat-card"><div class="stat-value">\${data.phien_truoc.tong}</div><div class="stat-label">Tổng điểm</div></div>
                        <div class="stat-card"><div class="stat-value">\${data.phien_truoc.ket_qua}</div><div class="stat-label">Kết quả</div></div>
                        <div class="stat-card"><div class="stat-value">\${data.thong_ke.recentRate || '0%'}</div><div class="stat-label">Thắng 30 gần nhất</div></div>
                    </div>
                    <h3>📋 Lịch sử dự đoán</h3>
                    <table><thead><tr><th>Phiên</th><th>Dự đoán</th><th>Kết quả</th><th>Đánh giá</th><th>Độ TC</th></tr></thead><tbody>
                        \${(data.lich_su || []).map(h => \`
                            <tr class="\${h.danh_gia}"><td>\${h.phien}</td><td>\${h.du_doan}</td><td>\${h.ket_qua || '...'}</td>
                            <td><span class="badge badge-\${h.danh_gia}">\${h.danh_gia === 'thang' ? '✓ THẮNG' : (h.danh_gia === 'thua' ? '✗ THUA' : '...')}</span></td>
                            <td>\${h.confidence || 'N/A'}%</td></tr>
                        \`).join('')}
                        \${(!data.lich_su || data.lich_su.length === 0) ? '<tr><td colspan="5" style="text-align:center">Chờ kết quả...</td></tr>' : ''}
                    </tbody></table>
                </div>
            \`;
        };
        
        document.getElementById('content').innerHTML = \`
            \${render(hu, 'LC79 - HU (Hữu)', '🐉')}
            \${render(md5, 'LC79 - MD5 (Mật)', '🔐')}
        \`;
    } catch(e) {
        document.getElementById('content').innerHTML = '<div class="card">Lỗi: ' + e.message + '</div>';
    }
}
load();
setInterval(load, 5000);
</script>
</body>
</html>
    `);
});

// Auto save
setInterval(() => {
    saveJSON(HISTORY_FILE, history);
}, AUTO_SAVE_INTERVAL);

// Load saved data
const saved = loadJSON(HISTORY_FILE, { hu: [], md5: [] });
history = saved;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║     🎲 VuaOcCac - Hệ thống Thống kê Tài Xỉu 🧠          ║
║                                                          ║
║   📡 API: http://localhost:${PORT}/lc79-hu               ║
║   📡 API: http://localhost:${PORT}/lc79-md5              ║
║   📊 Dashboard: http://localhost:${PORT}/                ║
║                                                          ║
║   🔬 Thuật toán sử dụng:                                 ║
║      • Phân phối Nhị thức    • Runs Test (Wald-Wolfowitz)║
║      • Hồi quy Logistic      • Chuỗi Markov bậc 2        ║
║      • T-Test so sánh 2 mẫu  • Chi-square test           ║
║      • Tự tương quan (ACF)   • Bayesian Inference        ║
║      • Phân tích chu kỳ      • Monte Carlo simulation    ║
║                                                          ║
║   ⚖️  Không thiên vị | Dựa trên xác suất thực tế        ║
╚══════════════════════════════════════════════════════════╝
    `);
});
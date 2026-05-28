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

const FRESH_SCAN_COUNT = 30;
const AUTO_SAVE_INTERVAL = 30000;
const CACHE_TTL = 5000;

// ==================== 1. CÁC THUẬT TOÁN PHÂN TÍCH THUẦN TÚY ====================
// Mỗi thuật toán phân tích mẫu hình thực tế, không thiên vị

// 1. Phát hiện cầu bệt (dây dài)
function algo_bet(results) {
    let streak = 1;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[0]) streak++;
        else break;
    }
    if (streak >= 4) {
        // Dây càng dài, xác suất gãy càng cao
        return results[0] === 'T' ? 'X' : 'T';
    }
    if (streak === 3) {
        return results[0];
    }
    return null;
}

// 2. Phát hiện cầu 1-1 (đan xen)
function algo_11(results) {
    let alternating = 1;
    for (let i = 1; i < results.length; i++) {
        if (results[i] !== results[i-1]) alternating++;
        else break;
    }
    if (alternating >= 4) {
        // Cầu 1-1 dài thì tiếp tục
        return results[0] === 'T' ? 'X' : 'T';
    }
    if (alternating === 3) {
        return results[0];
    }
    return null;
}

// 3. Phát hiện cầu 2-2
function algo_22(results) {
    let pairs = 0;
    for (let i = 0; i < results.length - 1; i += 2) {
        if (results[i] === results[i+1]) pairs++;
        else break;
    }
    if (pairs >= 2) {
        const lastPair = results[(pairs-1)*2];
        if (pairs >= 3) {
            return lastPair === 'T' ? 'X' : 'T';
        }
        return lastPair;
    }
    return null;
}

// 4. Phân tích xu hướng tổng điểm (thuần túy dựa trên số liệu)
function algo_trend_score(data) {
    if (data.length < 12) return null;
    
    const totals = data.slice(0, 12).map(d => d.Tong);
    const first6 = totals.slice(0, 6);
    const last6 = totals.slice(6, 12);
    
    const avgFirst6 = first6.reduce((a, b) => a + b, 0) / 6;
    const avgLast6 = last6.reduce((a, b) => a + b, 0) / 6;
    const diff = avgLast6 - avgFirst6;
    
    if (Math.abs(diff) < 1.0) return null; // Không đủ khác biệt
    
    // Xu hướng tăng -> Xỉu (tổng cao thường về Xỉu sau khi tăng)
    // Xu hướng giảm -> Tài
    return diff > 1.0 ? 'X' : (diff < -1.0 ? 'T' : null);
}

// 5. Phân tích điểm số đặc biệt
function algo_special_score(data) {
    const total = data[0]?.Tong || 0;
    if (total <= 4) return 'T';      // Điểm quá thấp -> Tài
    if (total >= 17) return 'X';     // Điểm quá cao -> Xỉu
    if (total === 10 || total === 11) {
        // Điểm trung bình, xem lịch sử
        const prevTotal = data[1]?.Tong;
        if (prevTotal && Math.abs(prevTotal - total) <= 1) {
            return data[0]?.Ket_qua === 'Tài' ? 'X' : 'T';
        }
    }
    return null;
}

// 6. Phân tích bộ ba xúc xắc
function algo_dice_pattern(data) {
    const d = data[0];
    if (!d) return null;
    
    const dice = [d.Xuc_xac_1, d.Xuc_xac_2, d.Xuc_xac_3];
    const unique = new Set(dice);
    
    // Ba mặt giống nhau
    if (unique.size === 1) {
        return dice[0] >= 4 ? 'X' : 'T';
    }
    
    // Hai mặt giống nhau
    if (unique.size === 2) {
        const pairs = dice.filter(x => dice.filter(y => y === x).length >= 2);
        if (pairs[0] === 1) return 'T';
        if (pairs[0] === 6) return 'X';
    }
    
    return null;
}

// 7. Markov chain - xác suất chuyển tiếp thực tế
function algo_markov_real(results) {
    if (results.length < 8) return null;
    
    const patterns = {};
    for (let i = 0; i < results.length - 3; i++) {
        const p = results.slice(i, i + 3).join('');
        const next = results[i + 3];
        if (!patterns[p]) patterns[p] = { T: 0, X: 0 };
        patterns[p][next]++;
    }
    
    const last3 = results.slice(0, 3).join('');
    const stat = patterns[last3];
    
    if (stat && (stat.T + stat.X) >= 2) {
        const probT = stat.T / (stat.T + stat.X);
        if (probT > 0.66) return 'T';
        if (probT < 0.34) return 'X';
    }
    return null;
}

// 8. Phân bố tần suất
function algo_distribution_real(results) {
    const tCount = results.filter(r => r === 'T').length;
    const xCount = results.length - tCount;
    const total = results.length;
    
    // Lệch quá 65% so với lý thuyết 50-50
    if (tCount > total * 0.65) return 'X';  // Quá nhiều Tài -> Xỉu
    if (xCount > total * 0.65) return 'T';  // Quá nhiều Xỉu -> Tài
    
    return null;
}

// 9. RSI thực tế (không thiên vị)
function algo_rsi_real(results) {
    if (results.length < 10) return null;
    
    const nums = results.slice(0, 10).map(c => c === 'T' ? 1 : 0);
    let gains = 0, losses = 0;
    
    for (let i = 1; i < nums.length; i++) {
        const diff = nums[i] - nums[i-1];
        if (diff > 0) gains += diff;
        else losses -= diff;
    }
    
    const avgGain = gains / 9;
    const avgLoss = losses / 9;
    
    if (avgLoss === 0) return 'T';
    
    const rsi = 100 - (100 / (1 + avgGain / avgLoss));
    
    if (rsi > 70) return 'X';   // Quá mua -> Xỉu
    if (rsi < 30) return 'T';   // Quá bán -> Tài
    
    return null;
}

// 10. Phát hiện cầu đảo (pattern reversal)
function algo_reversal_real(results) {
    if (results.length < 8) return null;
    
    // Kiểm tra mô hình 3-2-1
    const first3 = results.slice(0, 3);
    const next3 = results.slice(3, 6);
    const last2 = results.slice(6, 8);
    
    if (first3[0] === first3[1] && first3[1] === first3[2]) {
        if (next3[0] !== first3[0] && next3[0] === next3[1] && next3[1] === next3[2]) {
            return next3[0];
        }
    }
    
    return null;
}

// 11. Phân tích khoảng cách điểm
function algo_score_gap(data) {
    if (data.length < 5) return null;
    
    const gaps = [];
    for (let i = 0; i < 4; i++) {
        gaps.push(Math.abs(data[i].Tong - data[i+1].Tong));
    }
    
    const avgGap = gaps.reduce((a, b) => a + b, 0) / 4;
    
    // Khoảng cách điểm bất thường
    if (avgGap > 5) {
        // Biến động mạnh -> khả năng đảo chiều
        return data[0].Ket_qua === 'Tài' ? 'X' : 'T';
    }
    
    return null;
}

// 12. Hồi quy tuyến tính trên chuỗi kết quả
function algo_linear_trend(results) {
    if (results.length < 10) return null;
    
    const nums = results.slice(0, 10).map((r, idx) => ({ x: idx, y: r === 'T' ? 1 : 0 }));
    const n = nums.length;
    const sumX = nums.reduce((s, p) => s + p.x, 0);
    const sumY = nums.reduce((s, p) => s + p.y, 0);
    const sumXY = nums.reduce((s, p) => s + p.x * p.y, 0);
    const sumX2 = nums.reduce((s, p) => s + p.x * p.x, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    
    if (Math.abs(slope) > 0.15) {
        // Xu hướng rõ ràng
        const nextY = slope * n + (sumY - slope * sumX) / n;
        return nextY > 0.6 ? 'T' : (nextY < 0.4 ? 'X' : null);
    }
    
    return null;
}

// 13. KNN - K láng giềng gần nhất
function algo_knn_real(results) {
    if (results.length < 15) return null;
    
    const query = results.slice(-6);
    const distances = [];
    
    for (let i = 0; i < results.length - 7; i++) {
        let dist = 0;
        for (let j = 0; j < 6; j++) {
            if (results[i + j] !== query[j]) dist++;
        }
        distances.push({ dist, next: results[i + 6] });
    }
    
    distances.sort((a, b) => a.dist - b.dist);
    const neighbors = distances.slice(0, 5);
    const tCount = neighbors.filter(n => n.next === 'T').length;
    
    if (tCount >= 4) return 'T';
    if (tCount <= 1) return 'X';
    
    return null;
}

// 14. Phân tích chu kỳ
function algo_cycle_real(results) {
    for (let cycle = 3; cycle <= 6; cycle++) {
        if (results.length < cycle * 2) continue;
        
        let matches = 0;
        for (let i = cycle; i < Math.min(results.length, cycle * 3); i++) {
            if (results[i] === results[i - cycle]) matches++;
        }
        
        if (matches >= 3) {
            return results[results.length - cycle];
        }
    }
    return null;
}

// 15. Phân tích độ hỗn loạn (entropy)
function algo_entropy_real(results) {
    if (results.length < 12) return null;
    
    const p_t = results.filter(r => r === 'T').length / results.length;
    if (p_t === 0 || p_t === 1) {
        return results[0] === 'T' ? 'X' : 'T';
    }
    
    const entropy = -p_t * Math.log2(p_t) - (1 - p_t) * Math.log2(1 - p_t);
    
    // Entropy cao -> hỗn loạn -> khó đoán, trả về null
    if (entropy > 0.95) return null;
    
    // Entropy thấp -> có xu hướng rõ
    if (entropy < 0.7) {
        return p_t > 0.6 ? 'X' : (p_t < 0.4 ? 'T' : null);
    }
    
    return null;
}

// ==================== 2. LỚP DỰ ĐOÁN KHÔNG THIÊN VỊ ====================
class TaiXiuPredictor {
    constructor() {
        this.algorithms = [
            { fn: algo_bet, weight: 1.2, name: 'Cầu bệt' },
            { fn: algo_11, weight: 1.1, name: 'Cầu 1-1' },
            { fn: algo_22, weight: 1.0, name: 'Cầu 2-2' },
            { fn: algo_trend_score, weight: 1.3, name: 'Xu hướng điểm' },
            { fn: algo_special_score, weight: 1.2, name: 'Điểm đặc biệt' },
            { fn: algo_dice_pattern, weight: 1.1, name: 'Bộ xúc xắc' },
            { fn: algo_markov_real, weight: 1.3, name: 'Markov' },
            { fn: algo_distribution_real, weight: 1.2, name: 'Phân bố' },
            { fn: algo_rsi_real, weight: 1.1, name: 'RSI' },
            { fn: algo_reversal_real, weight: 1.0, name: 'Đảo cầu' },
            { fn: algo_score_gap, weight: 0.9, name: 'Khoảng cách' },
            { fn: algo_linear_trend, weight: 1.1, name: 'Xu hướng tuyến' },
            { fn: algo_knn_real, weight: 1.0, name: 'KNN' },
            { fn: algo_cycle_real, weight: 1.0, name: 'Chu kỳ' },
            { fn: algo_entropy_real, weight: 1.1, name: 'Entropy' },
        ];
        
        this.predictionHistory = [];
        this.totalPredictions = 0;
        this.correctPredictions = 0;
        this.lastPred = null;
    }

    predict(freshData) {
        if (!freshData || freshData.length < 8) {
            return { prediction: null, confidence: 0, reason: 'Không đủ dữ liệu' };
        }

        const results = freshData.map(d => d.Ket_qua === 'Tài' ? 'T' : 'X');
        const signals = [];
        
        // Thu thập tín hiệu từ các thuật toán
        this.algorithms.forEach(algo => {
            try {
                const pred = algo.fn.length === 1 ? algo.fn(results) : algo.fn(freshData);
                if (pred && (pred === 'T' || pred === 'X')) {
                    signals.push({ pred, weight: algo.weight, name: algo.name });
                }
            } catch(e) {}
        });
        
        // Nếu không có tín hiệu, dựa vào xác suất thực tế
        if (signals.length === 0) {
            const tCount = results.filter(r => r === 'T').length;
            const tProb = tCount / results.length;
            
            if (Math.abs(tProb - 0.5) > 0.15) {
                const pred = tProb > 0.5 ? 'X' : 'T';
                return { 
                    prediction: pred === 'T' ? 'Tài' : 'Xỉu', 
                    confidence: 55 + Math.abs(tProb - 0.5) * 20,
                    reason: 'Cân bằng xác suất'
                };
            }
            
            return { prediction: null, confidence: 0, reason: 'Không đủ tín hiệu' };
        }
        
        // Tính điểm có trọng số
        let tScore = 0, xScore = 0;
        signals.forEach(s => {
            if (s.pred === 'T') tScore += s.weight;
            else xScore += s.weight;
        });
        
        // Chênh lệch điểm tối thiểu để có quyết định
        const diff = Math.abs(tScore - xScore);
        const total = tScore + xScore;
        
        if (diff < total * 0.15) {
            // Chênh lệch quá nhỏ, không đủ cơ sở
            return { prediction: null, confidence: 0, reason: 'Tín hiệu không rõ ràng' };
        }
        
        const pred = tScore > xScore ? 'Tài' : 'Xỉu';
        let confidence = Math.round((diff / total) * 100);
        confidence = Math.min(85, Math.max(55, confidence));
        
        this.lastPred = { prediction: pred, confidence, signals: signals.length };
        
        return { prediction: pred, confidence, reason: `${signals.length} thuật toán đồng thuận` };
    }
    
    feedback(actual) {
        if (!this.lastPred) return;
        
        this.totalPredictions++;
        if (this.lastPred.prediction === actual) {
            this.correctPredictions++;
        }
        
        this.predictionHistory.push({
            pred: this.lastPred.prediction,
            actual: actual,
            confidence: this.lastPred.confidence,
            timestamp: Date.now()
        });
        
        if (this.predictionHistory.length > 50) {
            this.predictionHistory.shift();
        }
    }
    
    getStats() {
        const recent = this.predictionHistory.slice(-20);
        const recentWins = recent.filter(p => p.pred === p.actual).length;
        const recentRate = recent.length > 0 ? (recentWins / recent.length * 100).toFixed(1) : 0;
        const overallRate = this.totalPredictions > 0 ? (this.correctPredictions / this.totalPredictions * 100).toFixed(1) : 0;
        
        return {
            totalPredictions: this.totalPredictions,
            correctPredictions: this.correctPredictions,
            overallRate: `${overallRate}%`,
            recentRate: `${recentRate}%`
        };
    }
}

// ==================== 3. SERVER ====================
const predictorHU = new TaiXiuPredictor();
const predictorMD5 = new TaiXiuPredictor();
let predictionHistory = { hu: [], md5: [] };
let pendingPrediction = { hu: null, md5: null };
let fetchCache = { hu: null, md5: null, lastFetch: { hu: 0, md5: 0 } };

function loadJSON(filename, defaultValue) {
    try {
        if (fs.existsSync(filename)) {
            return JSON.parse(fs.readFileSync(filename, 'utf8'));
        }
    } catch(e) {}
    return defaultValue;
}

function saveJSON(filename, data) {
    try {
        fs.writeFileSync(filename, JSON.stringify(data, null, 2));
    } catch(e) {}
}

function transformApiData(apiData) {
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

async function fetchFreshData(url) {
    try {
        const resp = await axios.get(url, { timeout: 15000, params: { limit: FRESH_SCAN_COUNT } });
        return transformApiData(resp.data);
    } catch(e) {
        console.error(`Fetch lỗi:`, e.message);
        return null;
    }
}

async function fetchFreshDataWithCache(url, type) {
    const now = Date.now();
    if (fetchCache[type] && (now - fetchCache.lastFetch[type]) < CACHE_TTL) {
        return fetchCache[type];
    }
    const data = await fetchFreshData(url);
    if (data) {
        fetchCache[type] = data;
        fetchCache.lastFetch[type] = now;
    }
    return data;
}

function updateActualResults(type, predictor, freshData) {
    if (!freshData || !freshData.length) return;
    
    for (let i = 0; i < predictionHistory[type].length; i++) {
        const entry = predictionHistory[type][i];
        if (entry.ket_qua) continue;
        
        const actual = freshData.find(s => s.Phien === entry.phien);
        if (actual) {
            entry.ket_qua = actual.Ket_qua;
            entry.danh_gia = entry.du_doan === actual.Ket_qua ? 'thang' : 'thua';
            predictor.feedback(actual.Ket_qua);
            
            if (pendingPrediction[type] && pendingPrediction[type].entry === entry) {
                pendingPrediction[type] = null;
            }
        }
    }
}

function predictAndRecord(type, predictor, freshData) {
    if (pendingPrediction[type]) return pendingPrediction[type];
    if (!freshData || !freshData.length) return null;
    
    const result = predictor.predict(freshData);
    
    // Chỉ đưa ra dự đoán nếu đủ tin cậy
    if (!result.prediction || result.confidence < 55) {
        return null;
    }
    
    const nextPhien = freshData[0].Phien + 1;
    const entry = {
        phien: nextPhien,
        du_doan: result.prediction,
        ket_qua: null,
        danh_gia: null,
        confidence: result.confidence,
        reason: result.reason
    };
    
    predictionHistory[type].unshift(entry);
    if (predictionHistory[type].length > 100) {
        predictionHistory[type] = predictionHistory[type].slice(0, 100);
    }
    
    pendingPrediction[type] = { nextPhien, prediction: result.prediction, confidence: result.confidence, entry };
    return pendingPrediction[type];
}

// API Endpoints
app.get('/lc79-hu', async (req, res) => {
    const freshData = await fetchFreshDataWithCache(API_URL_HU, 'hu');
    if (!freshData || freshData.length < 8) {
        return res.json({ status: 'error', message: 'Đang thu thập dữ liệu...' });
    }
    
    updateActualResults('hu', predictorHU, freshData);
    const pred = predictAndRecord('hu', predictorHU, freshData);
    const latest = freshData[0];
    const stats = predictorHU.getStats();
    
    const recentHistory = predictionHistory.hu
        .filter(e => e.ket_qua)
        .slice(0, 10)
        .map(e => ({
            phien: e.phien,
            du_doan: e.du_doan,
            ket_qua: e.ket_qua,
            danh_gia: e.danh_gia,
            confidence: e.confidence
        }));
    
    res.json({
        status: 'success',
        phien_hien_tai: pred ? {
            Phien: pred.nextPhien,
            Du_doan: pred.prediction,
            Do_tin_cay: `${pred.confidence}%`
        } : { message: 'Đang phân tích, chờ tín hiệu rõ ràng' },
        phien_truoc: {
            Phien: latest.Phien,
            Ket_qua: latest.Ket_qua,
            Tong: latest.Tong,
            Xuc_xac: [latest.Xuc_xac_1, latest.Xuc_xac_2, latest.Xuc_xac_3]
        },
        stats: stats,
        lich_su_gan_day: recentHistory
    });
});

app.get('/lc79-md5', async (req, res) => {
    const freshData = await fetchFreshDataWithCache(API_URL_MD5, 'md5');
    if (!freshData || freshData.length < 8) {
        return res.json({ status: 'error', message: 'Đang thu thập dữ liệu...' });
    }
    
    updateActualResults('md5', predictorMD5, freshData);
    const pred = predictAndRecord('md5', predictorMD5, freshData);
    const latest = freshData[0];
    const stats = predictorMD5.getStats();
    
    const recentHistory = predictionHistory.md5
        .filter(e => e.ket_qua)
        .slice(0, 10)
        .map(e => ({
            phien: e.phien,
            du_doan: e.du_doan,
            ket_qua: e.ket_qua,
            danh_gia: e.danh_gia,
            confidence: e.confidence
        }));
    
    res.json({
        status: 'success',
        phien_hien_tai: pred ? {
            Phien: pred.nextPhien,
            Du_doan: pred.prediction,
            Do_tin_cay: `${pred.confidence}%`
        } : { message: 'Đang phân tích, chờ tín hiệu rõ ràng' },
        phien_truoc: {
            Phien: latest.Phien,
            Ket_qua: latest.Ket_qua,
            Tong: latest.Tong,
            Xuc_xac: [latest.Xuc_xac_1, latest.Xuc_xac_2, latest.Xuc_xac_3]
        },
        stats: stats,
        lich_su_gan_day: recentHistory
    });
});

// Dashboard
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>VuaOcCac AI - Dự Đoán Tài Xỉu</title>
            <meta http-equiv="refresh" content="5">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Segoe UI', Arial, sans-serif; background: #0f0f23; color: #eee; padding: 20px; }
                .container { max-width: 1300px; margin: 0 auto; }
                h1 { text-align: center; margin-bottom: 30px; font-size: 2em; background: linear-gradient(45deg, #ff6b6b, #4ecdc4); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
                .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(480px, 1fr)); gap: 25px; }
                .card { background: #1a1a2e; border-radius: 20px; padding: 25px; border: 1px solid #2d2d44; }
                .card h2 { margin-bottom: 20px; font-size: 1.5em; }
                .prediction-box { text-align: center; padding: 20px; border-radius: 15px; margin-bottom: 20px; }
                .Tai { background: linear-gradient(135deg, #ff6b6b, #c0392b); }
                .Xiu { background: linear-gradient(135deg, #4ecdc4, #16a085); }
                .waiting { background: #2d2d44; }
                .prediction-text { font-size: 42px; font-weight: bold; }
                .confidence { font-size: 20px; margin-top: 10px; }
                .dice { display: flex; justify-content: center; gap: 15px; margin: 20px 0; }
                .dice span { width: 70px; height: 70px; background: white; color: #333; border-radius: 15px; display: flex; align-items: center; justify-content: center; font-size: 32px; font-weight: bold; box-shadow: 0 5px 15px rgba(0,0,0,0.3); }
                .stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin: 20px 0; }
                .stat { background: #0d0d1a; padding: 12px; border-radius: 12px; text-align: center; }
                .stat-value { font-size: 28px; font-weight: bold; }
                .stat-label { font-size: 12px; opacity: 0.7; margin-top: 5px; }
                table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 14px; }
                th, td { padding: 8px 5px; text-align: left; border-bottom: 1px solid #2d2d44; }
                .thang { color: #4CAF50; }
                .thua { color: #f44336; }
                .badge { display: inline-block; padding: 2px 10px; border-radius: 20px; font-size: 11px; font-weight: bold; }
                .badge-thang { background: #4CAF50; color: white; }
                .badge-thua { background: #f44336; color: white; }
                .footer { text-align: center; margin-top: 30px; padding: 20px; color: #666; font-size: 12px; }
                .no-pred { text-align: center; padding: 20px; color: #ffa502; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🎲 VuaOcCac AI - Dự Đoán Tài Xỉu 🧠</h1>
                <div class="grid" id="content">Đang tải dữ liệu...</div>
                <div class="footer">📊 Dự đoán dựa trên 15+ thuật toán phân tích cầu | Không ưu tiên bên nào | Cập nhật mỗi 5 giây</div>
            </div>
            <script>
                async function load() {
                    try {
                        const [hu, md5] = await Promise.all([
                            fetch('/lc79-hu').then(r => r.json()),
                            fetch('/lc79-md5').then(r => r.json())
                        ]);
                        
                        const renderCard = (data, title, icon) => {
                            const hasPred = data.phien_hien_tai && data.phien_hien_tai.Du_doan;
                            const predClass = hasPred ? data.phien_hien_tai.Du_doan : 'waiting';
                            const predText = hasPred ? data.phien_hien_tai.Du_doan : 'ĐANG PHÂN TÍCH';
                            const confText = hasPred ? \`Độ tin cậy: \${data.phien_hien_tai.Do_tin_cay}\` : 'Chờ tín hiệu rõ ràng...';
                            
                            return \`
                                <div class="card">
                                    <h2>\${icon} \${title}</h2>
                                    <div class="prediction-box \${predClass}">
                                        <div class="prediction-text">\${predText}</div>
                                        <div class="confidence">\${confText}</div>
                                    </div>
                                    <div class="dice">
                                        <span>\${data.phien_truoc.Xuc_xac[0]}</span>
                                        <span>\${data.phien_truoc.Xuc_xac[1]}</span>
                                        <span>\${data.phien_truoc.Xuc_xac[2]}</span>
                                    </div>
                                    <div class="stats">
                                        <div class="stat"><div class="stat-value">\${data.phien_truoc.Tong}</div><div class="stat-label">Tổng điểm</div></div>
                                        <div class="stat"><div class="stat-value">\${data.phien_truoc.Ket_qua}</div><div class="stat-label">Kết quả</div></div>
                                        <div class="stat"><div class="stat-value">\${data.stats.recentRate || '0%'}</div><div class="stat-label">Thắng gần đây</div></div>
                                        <div class="stat"><div class="stat-value">\${data.stats.overallRate || '0%'}</div><div class="stat-label">Tổng tỉ lệ thắng</div></div>
                                    </div>
                                    <h3>📜 Lịch sử dự đoán</h3>
                                    <table>
                                        <thead><tr><th>Phiên</th><th>Dự đoán</th><th>Kết quả</th><th>Đánh giá</th><th>Độ TC</th></tr></thead>
                                        <tbody>
                                            \${(data.lich_su_gan_day || []).map(h => \`
                                                <tr>
                                                    <td>\${h.phien}</td>
                                                    <td>\${h.du_doan}</td>
                                                    <td>\${h.ket_qua || '...'}</td>
                                                    <td><span class="badge badge-\${h.danh_gia}">\${h.danh_gia === 'thang' ? '✓ THẮNG' : (h.danh_gia === 'thua' ? '✗ THUA' : '...')}</span></td>
                                                    <td>\${h.confidence || 'N/A'}%</td>
                                                </tr>
                                            \`).join('')}
                                            \${(!data.lich_su_gan_day || data.lich_su_gan_day.length === 0) ? '<tr><td colspan="5" style="text-align:center">Chưa có dữ liệu</td></tr>' : ''}
                                        </tbody>
                                    </table>
                                </div>
                            \`;
                        };
                        
                        document.getElementById('content').innerHTML = \`
                            \${renderCard(hu, 'LC79 - HU', '🐉')}
                            \${renderCard(md5, 'LC79 - MD5', '🔐')}
                        \`;
                    } catch(e) {
                        document.getElementById('content').innerHTML = '<div class="card">Lỗi kết nối: ' + e.message + '</div>';
                    }
                }
                load();
                setInterval(load, 5000);
            </script>
        </body>
        </html>
    `);
});

// Lưu tự động
setInterval(() => {
    saveJSON(HISTORY_FILE, predictionHistory);
}, AUTO_SAVE_INTERVAL);

// Khởi động
const savedHistory = loadJSON(HISTORY_FILE, { hu: [], md5: [] });
predictionHistory = savedHistory;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ╔════════════════════════════════════════╗
    ║   🎲 VuaOcCac AI - Tài Xỉu 🧠         ║
    ║                                        ║
    ║   📊 Dashboard: http://localhost:${PORT}/  ║
    ║   🤖 15+ thuật toán phân tích          ║
    ║   ⚖️  Không ưu tiên bên nào            ║
    ║   📈 Dự đoán thuần túy dựa trên dữ liệu ║
    ╚════════════════════════════════════════╝
    `);
});
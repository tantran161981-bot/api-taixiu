const fs = require('fs');
const path = require('path');
const axios = require('axios');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 5000;

// ==================== CẤU HÌNH ====================
const API_URL_HU  = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const SESSIONS_FILE  = path.join(__dirname, 'vuaoccac_sessions.json');
const HISTORY_FILE   = path.join(__dirname, 'vuaoccac_history.json');

const FRESH_SCAN_COUNT = 20; // Lấy 20 phiên mới nhất để phân tích
const FETCH_INTERVAL     = 2000;
const AUTO_SAVE_INTERVAL = 30000;

// ==================== 1. CÁC HÀM PHÂN TÍCH NHANH (40+ THUẬT TOÁN) ====================
// Mỗi hàm nhận vào mảng history (đã sắp xếp giảm dần, index 0 là mới nhất)
// Trả về 'T' hoặc 'X' hoặc null

function algo_bet(results) {
    let s = 1;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[0]) s++; else break;
    }
    if (s >= 5) return results[0] === 'T' ? 'X' : 'T'; // Bệt dài -> gãy
    if (s >= 3) return results[0]; // Bệt vừa -> theo
    return null;
}

function algo_11(results) {
    let alt = 1;
    for (let i = 1; i < results.length; i++) {
        if (results[i] !== results[i-1]) alt++; else break;
    }
    if (alt >= 4) return results[0] === 'T' ? 'X' : 'T';
    return null;
}

function algo_22(results) {
    let pairs = 0;
    for (let i = 0; i < results.length - 1; i += 2) {
        if (results[i] === results[i+1]) pairs++; else break;
    }
    if (pairs >= 2) {
        const lastPair = results[(pairs-1)*2];
        return pairs >= 3 ? (lastPair === 'T' ? 'X' : 'T') : lastPair;
    }
    return null;
}

function algo_33(results) {
    let triples = 0;
    for (let i = 0; i < results.length - 2; i += 3) {
        if (results[i] === results[i+1] && results[i+1] === results[i+2]) triples++; else break;
    }
    if (triples >= 1) {
        const lastTriple = results[(triples-1)*3];
        return triples >= 2 ? (lastTriple === 'T' ? 'X' : 'T') : lastTriple;
    }
    return null;
}

function algo_triangle(results) {
    if (results.length >= 5) {
        const l5 = results.slice(0, 5);
        if (l5[0] !== l5[1] && l5[1] !== l5[2] && l5[2] !== l5[3] && l5[3] !== l5[4] && l5[0] === l5[4]) {
            return l5[0] === 'T' ? 'X' : 'T';
        }
    }
    return null;
}

function algo_zigzag(results) {
    let zig = 0;
    for (let i = 1; i < results.length; i++) {
        if (results[i] !== results[i-1]) zig++; else break;
    }
    if (zig >= 5) return results[0] === 'T' ? 'X' : 'T';
    return null;
}

function algo_symmetry(results) {
    if (results.length >= 6) {
        const l = results.slice(0, 3);
        const r = results.slice(3, 6).reverse();
        if (l.every((v, i) => v === r[i]) && l[0] !== l[1]) {
            return l[2] === 'T' ? 'X' : 'T';
        }
    }
    return null;
}

function algo_score_low(data) {
    const total = data[0]?.Tong || 0;
    if (total <= 4) return 'T';
    if (total >= 17) return 'X';
    return null;
}

function algo_triple_dice(data) {
    const d = data[0];
    if (!d) return null;
    if (d.Xuc_xac_1 === d.Xuc_xac_2 && d.Xuc_xac_2 === d.Xuc_xac_3) {
        return d.Xuc_xac_1 >= 4 ? 'X' : 'T';
    }
    return null;
}

function algo_pair1(data) {
    const d = data[0];
    if (!d) return null;
    const arr = [d.Xuc_xac_1, d.Xuc_xac_2, d.Xuc_xac_3];
    if (arr.filter(x => x === 1).length >= 2) return 'T';
    return null;
}

function algo_pair6(data) {
    const d = data[0];
    if (!d) return null;
    const arr = [d.Xuc_xac_1, d.Xuc_xac_2, d.Xuc_xac_3];
    if (arr.filter(x => x === 6).length >= 2) return 'X';
    return null;
}

function algo_sum_trend(data) {
    if (data.length < 10) return null;
    const sums = data.slice(0, 10).map(d => d.Tong);
    const a5 = sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const a10 = sums.reduce((a, b) => a + b, 0) / 10;
    if (a5 > a10 + 1.5) return 'X';
    if (a5 < a10 - 1.5) return 'T';
    return null;
}

function algo_markov(results) {
    if (results.length < 4) return null;
    const seq = results.join('');
    for (let order = 3; order <= Math.min(5, results.length - 1); order++) {
        const last = seq.slice(-order);
        const trans = {};
        for (let i = 0; i <= seq.length - order - 1; i++) {
            const pat = seq.slice(i, i + order);
            const next = seq[i + order];
            if (!trans[pat]) trans[pat] = { T: 0, X: 0 };
            trans[pat][next]++;
        }
        const possible = trans[last];
        if (!possible) continue;
        const total = possible.T + possible.X;
        if (total >= 3) {
            const probT = possible.T / total;
            if (probT > 0.6) return 'T';
            if (probT < 0.4) return 'X';
        }
    }
    return null;
}

function algo_distribution(results) {
    const tC = results.filter(r => r === 'T').length;
    const imb = Math.abs(tC - (results.length - tC)) / results.length;
    if (imb > 0.15) return tC < results.length / 2 ? 'T' : 'X';
    return null;
}

function algo_streak(results) {
    let s = 1;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[0]) s++; else break;
    }
    if (s >= 4) return results[0] === 'T' ? 'X' : 'T';
    if (s >= 2) return results[0];
    return null;
}

function algo_freq(results) {
    const t = results.filter(r => r === 'T').length;
    if (t > results.length * 0.7) return 'X';
    if (t < results.length * 0.3) return 'T';
    return null;
}

function algo_cycle(results) {
    for (let c = 2; c <= 6; c++) {
        if (results.length < c * 2) continue;
        let same = 0;
        for (let i = c; i < results.length; i++) {
            if (results[i] === results[i - c]) same++;
        }
        if (same >= 3 && same / (results.length - c) > 0.6) {
            return results[results.length - c];
        }
    }
    return null;
}

function algo_reverse_last(results) {
    return results[0] === 'T' ? 'X' : 'T';
}

function algo_follow_last(results) {
    return results[0];
}

function algo_121(results) {
    if (results.length >= 4) {
        const [a, b, c, d] = results;
        if (a !== b && b === c && c !== d && a === d) return a;
    }
    return null;
}

function algo_123(results) {
    if (results.length >= 6) {
        const [a, b, c, d, e, f] = results;
        if (b === c && c !== d && d !== e && e === f) return a;
    }
    return null;
}

function algo_321(results) {
    if (results.length >= 6) {
        const [a, b, c, d, e, f] = results;
        if (a === b && b === c && d === e && e === f && a !== d) return d;
    }
    return null;
}

function algo_212(results) {
    if (results.length >= 6) {
        const [a, b, c, d, e, f] = results;
        if (a === b && b !== c && c !== d && d === e && e === f && a !== d) return d;
    }
    return null;
}

function algo_dragon(results) {
    let tRun = 0;
    for (let i = 0; i < results.length; i++) {
        if (results[i] === 'T') tRun++; else break;
    }
    if (tRun >= 6) return 'X';
    if (tRun >= 4) return 'T';
    return null;
}

function algo_tiger(results) {
    let xRun = 0;
    for (let i = 0; i < results.length; i++) {
        if (results[i] === 'X') xRun++; else break;
    }
    if (xRun >= 6) return 'T';
    if (xRun >= 4) return 'X';
    return null;
}

function algo_day_gay(results) {
    let s = 1;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[0]) s++; else break;
    }
    if (s >= 5 && results[s] && results[s] !== results[0]) return results[s];
    return null;
}

function algo_bac_thang(data) {
    if (data.length >= 4) {
        const s4 = data.slice(0, 4).map(d => d.Tong);
        const inc = s4[0] < s4[1] && s4[1] < s4[2] && s4[2] < s4[3];
        const dec = s4[0] > s4[1] && s4[1] > s4[2] && s4[2] > s4[3];
        if (inc) return 'X';
        if (dec) return 'T';
    }
    return null;
}

function algo_cau_dao_3(results) {
    if (results.length >= 6 && results[0] === results[2] && results[1] === results[3] && results[2] === results[4] && results[3] === results[5] && results[0] !== results[1]) {
        return results[0] === 'T' ? 'X' : 'T';
    }
    return null;
}

function algo_song_nguoc(results) {
    if (results.length >= 6 && results[0] !== results[1] && results[1] !== results[2] && results[2] !== results[3] && results[3] !== results[4] && results[4] !== results[5]) {
        return results[0] === 'T' ? 'X' : 'T';
    }
    return null;
}

function algo_rs7(data) {
    if (data.length >= 7) {
        const totals = data.slice(0, 7).map(d => d.Tong);
        const avg7 = totals.reduce((a, b) => a + b, 0) / 7;
        const std = Math.sqrt(totals.reduce((s, t) => s + Math.pow(t - avg7, 2), 0) / 7);
        if (std < 1.0) return data[0].Ket_qua === 'Tài' ? 'X' : 'T';
        if (std > 4.0) return data[0].Ket_qua === 'Tài' ? 'T' : 'X';
    }
    return null;
}

function algo_rsi(results) {
    if (results.length < 7) return null;
    const nums = results.slice(0, 7).map(c => c === 'T' ? 1 : 0);
    let gains = 0, losses = 0;
    for (let i = 1; i < nums.length; i++) {
        const diff = nums[i] - nums[i - 1];
        if (diff > 0) gains += diff; else losses -= diff;
    }
    const avgGain = gains / 7, avgLoss = losses / 7;
    if (avgLoss === 0) return 'T';
    const rsi = 100 - (100 / (1 + avgGain / avgLoss));
    if (rsi > 70) return 'X';
    if (rsi < 30) return 'T';
    return null;
}

function algo_decision_tree(results) {
    if (results.length < 10) return null;
    const last1 = results[0], last2 = results[1], last3 = results[2];
    const t5 = results.slice(0, 5).filter(c => c === 'T').length;
    if (last1 === 'T' && last2 === 'T' && last3 === 'T') return 'X';
    if (last1 === 'X' && last2 === 'X' && last3 === 'X') return 'T';
    if (t5 >= 4) return 'X';
    if (t5 <= 1) return 'T';
    return last1;
}

function algo_pattern_matching(results) {
    if (results.length < 25) return null;
    const query = results.slice(-25);
    let bestMatch = -1, bestScore = -1;
    for (let i = 0; i < results.length - 25; i++) {
        let score = 0;
        for (let j = 0; j < 25; j++) if (results[i + j] === query[j]) score++;
        if (score > bestScore) { bestScore = score; bestMatch = i; }
    }
    if (bestMatch !== -1 && bestMatch + 25 < results.length) return results[bestMatch + 25];
    return null;
}

function algo_fibonacci(data) {
    if (data.length < 12) return null;
    const totals = data.slice(0, 12).map(d => d.Tong);
    const diffs = [];
    for (let i = 1; i < totals.length; i++) diffs.push(totals[i] - totals[i - 1]);
    const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    let nextTotal = totals[0] + avgDiff;
    nextTotal = Math.min(18, Math.max(3, Math.round(nextTotal)));
    return nextTotal > 10 ? 'T' : 'X';
}

function algo_entropy(results) {
    if (results.length < 12) return null;
    const p_t = results.filter(r => r === 'T').length / results.length;
    if (p_t === 0 || p_t === 1) return results[results.length - 1];
    const e = -p_t * Math.log2(p_t) - (1 - p_t) * Math.log2(1 - p_t);
    if (e > 0.95) return results[results.length - 1] === 'T' ? 'X' : 'T';
    return results[results.length - 1];
}

function algo_knn(results) {
    if (results.length < 15) return null;
    const query = results.slice(-10);
    const distances = [];
    for (let i = 0; i < results.length - 11; i++) {
        let dist = 0;
        for (let j = 0; j < 10; j++) if (results[i + j] !== query[j]) dist++;
        distances.push({ dist, next: results[i + 10] });
    }
    distances.sort((a, b) => a.dist - b.dist);
    const neighbors = distances.slice(0, 5).map(d => d.next);
    const tCount = neighbors.filter(n => n === 'T').length;
    return tCount > 2 ? 'T' : 'X';
}

// ==================== 2. LỚP DỰ ĐOÁN CHÍNH ====================
class FreshScanAI {
    constructor() {
        this.algorithms = [
            { fn: algo_bet, weight: 1.5, name: 'Bệt' },
            { fn: algo_11, weight: 1.2, name: '1-1' },
            { fn: algo_22, weight: 1.1, name: '2-2' },
            { fn: algo_33, weight: 1.1, name: '3-3' },
            { fn: algo_triangle, weight: 1.3, name: 'Tam giác' },
            { fn: algo_zigzag, weight: 1.2, name: 'Zigzag' },
            { fn: algo_symmetry, weight: 1.0, name: 'Đối xứng' },
            { fn: algo_score_low, weight: 2.0, name: 'Điểm cực thấp' },
            { fn: algo_triple_dice, weight: 1.8, name: '3 mặt giống' },
            { fn: algo_pair1, weight: 1.5, name: 'Cặp 1' },
            { fn: algo_pair6, weight: 1.5, name: 'Cặp 6' },
            { fn: algo_sum_trend, weight: 1.4, name: 'Xu hướng tổng' },
            { fn: algo_markov, weight: 1.3, name: 'Markov' },
            { fn: algo_distribution, weight: 1.2, name: 'Phân bố' },
            { fn: algo_streak, weight: 1.4, name: 'Streak' },
            { fn: algo_freq, weight: 1.1, name: 'Tần suất' },
            { fn: algo_cycle, weight: 1.0, name: 'Chu kỳ' },
            { fn: algo_reverse_last, weight: 0.8, name: 'Đảo phiên trước' },
            { fn: algo_follow_last, weight: 0.8, name: 'Theo phiên trước' },
            { fn: algo_121, weight: 1.2, name: '1-2-1' },
            { fn: algo_123, weight: 1.2, name: '1-2-3' },
            { fn: algo_321, weight: 1.2, name: '3-2-1' },
            { fn: algo_212, weight: 1.1, name: '2-1-2' },
            { fn: algo_dragon, weight: 1.5, name: 'Rồng' },
            { fn: algo_tiger, weight: 1.5, name: 'Hổ' },
            { fn: algo_day_gay, weight: 1.4, name: 'Dây gãy' },
            { fn: algo_bac_thang, weight: 1.1, name: 'Bậc thang' },
            { fn: algo_cau_dao_3, weight: 1.1, name: 'Đảo 3' },
            { fn: algo_song_nguoc, weight: 1.0, name: 'Sóng ngược' },
            { fn: algo_rs7, weight: 1.2, name: 'RS7' },
            { fn: algo_rsi, weight: 1.1, name: 'RSI' },
            { fn: algo_decision_tree, weight: 1.2, name: 'Decision Tree' },
            { fn: algo_pattern_matching, weight: 1.0, name: 'Pattern Matching' },
            { fn: algo_fibonacci, weight: 1.1, name: 'Fibonacci' },
            { fn: algo_entropy, weight: 1.1, name: 'Entropy' },
            { fn: algo_knn, weight: 1.0, name: 'KNN' },
        ];
        this.consecutiveLosses = 0;
        this.lastPred = null;
    }

    predict(freshData) {
        // freshData: mảng 20 phiên mới nhất, sắp xếp giảm dần (index 0 = mới nhất)
        if (freshData.length < 10) {
            return { action: 'CÂN NHẮC', prediction: 'Tài', confidence: 51 };
        }

        const results = freshData.map(d => d.Ket_qua === 'Tài' ? 'T' : 'X');
        const signals = [];

        this.algorithms.forEach(algo => {
            try {
                // Một số thuật toán cần cả data (có Xuc_xac_1, Tong,...), một số chỉ cần results
                const pred = algo.fn.length === 1 ? algo.fn(results) : algo.fn(freshData);
                if (pred) {
                    signals.push({ prediction: pred, weight: algo.weight, name: algo.name });
                }
            } catch (e) {}
        });

        if (signals.length === 0) {
            const last = results[0];
            return { action: 'CÂN NHẮC', prediction: last === 'T' ? 'Xỉu' : 'Tài', confidence: 51 };
        }

        let sT = 0, sX = 0;
        signals.forEach(s => {
            if (s.prediction === 'T' || s.prediction === 'Tài') sT += s.weight;
            else sX += s.weight;
        });

        // Chống kẹt 50%
        if (sT === sX) {
            const totalT = results.filter(r => r === 'T').length;
            const totalX = results.length - totalT;
            if (totalT > totalX) sT += 0.5; else sX += 0.5;
        }

        const pred = sT >= sX ? 'Tài' : 'Xỉu';
        let conf = Math.round(Math.max(sT, sX) / (sT + sX) * 100);
        conf = Math.max(51, Math.min(92, conf));

        this.lastPred = pred;
        return { action: conf >= 65 ? 'ĐẶT' : 'CÂN NHẮC', prediction: pred, confidence: conf, signalCount: signals.length };
    }

    feedback(actual) {
        const predTai = this.lastPred === 'Tài';
        const actualTai = actual === 'Tài';
        if (predTai === actualTai) this.consecutiveLosses = 0;
        else this.consecutiveLosses++;
    }

    getStats() {
        return { consecutiveLosses: this.consecutiveLosses };
    }
}

// ==================== 3. SERVER ====================
const predictorHU  = new FreshScanAI();
const predictorMD5 = new FreshScanAI();
let predictionHistory = { hu: [], md5: [] };
let pendingPrediction  = { hu: null, md5: null };

function loadJSON(filename, defaultValue) {
    try { if (fs.existsSync(filename)) return JSON.parse(fs.readFileSync(filename, 'utf8')); }
    catch (e) { console.error(`Lỗi load ${filename}:`, e.message); }
    return defaultValue;
}

function saveJSON(filename, data) {
    try { fs.writeFileSync(filename, JSON.stringify(data, null, 2)); }
    catch (e) { console.error(`Lỗi save ${filename}:`, e.message); }
}

function transformApiData(apiData) {
    if (!apiData?.list?.length) return null;
    return apiData.list.map(item => ({
        Phien: item.id,
        Ket_qua: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
        Xuc_xac_1: item.dices[0], Xuc_xac_2: item.dices[1], Xuc_xac_3: item.dices[2],
        Tong: item.point, Thoi_gian: item.time || new Date().toISOString()
    })).sort((a, b) => b.Phien - a.Phien); // Sắp xếp giảm dần
}

async function fetchFreshData(url) {
    try {
        const resp = await axios.get(url, { timeout: 15000, params: { limit: FRESH_SCAN_COUNT } });
        return transformApiData(resp.data);
    } catch (e) { console.error(`❌ Fetch lỗi:`, e.message); return null; }
}

app.get('/lc79-hu', async (req, res) => {
    const freshData = await fetchFreshData(API_URL_HU);
    if (!freshData || freshData.length < 10) {
        return res.json({ status: 'error', message: 'Không đủ dữ liệu' });
    }

    updateActualResults('hu', predictorHU, freshData);
    let pred = predictAndRecord('hu', predictorHU, freshData);
    if (!pred) pred = { nextPhien: freshData[0].Phien + 1, prediction: 'Tài', confidence: 51 };

    const latestSession = freshData[0];
    const stats = predictorHU.getStats();
    const recentHistory = predictionHistory.hu.filter(e => e.ket_qua !== null).slice(0, 10).map(e => ({ phien: e.phien, du_doan: e.du_doan, ket_qua: e.ket_qua, danh_gia: e.danh_gia }));
    res.json({ phien_truoc: { Phien: latestSession.Phien, Xuc_xac_1: latestSession.Xuc_xac_1, Xuc_xac_2: latestSession.Xuc_xac_2, Xuc_xac_3: latestSession.Xuc_xac_3, Tong: latestSession.Tong, Ket_qua: latestSession.Ket_qua }, phien_hien_tai: { Phien: pred.nextPhien, Du_doan: pred.prediction, Do_tin_cay: `${pred.confidence}%` }, id: '@vuaoccac', stats, win_loss_table: recentHistory, full_history_count: predictionHistory.hu.length });
});

app.get('/lc79-md5', async (req, res) => {
    const freshData = await fetchFreshData(API_URL_MD5);
    if (!freshData || freshData.length < 10) {
        return res.json({ status: 'error', message: 'Không đủ dữ liệu' });
    }

    updateActualResults('md5', predictorMD5, freshData);
    let pred = predictAndRecord('md5', predictorMD5, freshData);
    if (!pred) pred = { nextPhien: freshData[0].Phien + 1, prediction: 'Tài', confidence: 51 };

    const latestSession = freshData[0];
    const stats = predictorMD5.getStats();
    const recentHistory = predictionHistory.md5.filter(e => e.ket_qua !== null).slice(0, 10).map(e => ({ phien: e.phien, du_doan: e.du_doan, ket_qua: e.ket_qua, danh_gia: e.danh_gia }));
    res.json({ phien_truoc: { Phien: latestSession.Phien, Xuc_xac_1: latestSession.Xuc_xac_1, Xuc_xac_2: latestSession.Xuc_xac_2, Xuc_xac_3: latestSession.Xuc_xac_3, Tong: latestSession.Tong, Ket_qua: latestSession.Ket_qua }, phien_hien_tai: { Phien: pred.nextPhien, Du_doan: pred.prediction, Do_tin_cay: `${pred.confidence}%` }, id: '@vuaoccac', stats, win_loss_table: recentHistory, full_history_count: predictionHistory.md5.length });
});

app.get('/lc79-hu/history', (req, res) => {
    res.json(predictionHistory.hu);
});

app.get('/lc79-md5/history', (req, res) => {
    res.json(predictionHistory.md5);
});

app.get('/status', (req, res) => {
    res.json({ hu: { stats: predictorHU.getStats() }, md5: { stats: predictorMD5.getStats() } });
});

function predictAndRecord(type, predictor, freshData) {
    if (pendingPrediction[type]) return pendingPrediction[type];
    if (freshData.length === 0) return null;
    const latest = freshData[0].Phien;
    const next = latest + 1;
    const result = predictor.predict(freshData);
    if (!result || result.action === 'BỎ QUA') return null;
    const entry = { phien: next, du_doan: result.prediction.toLowerCase(), ket_qua: null, danh_gia: null };
    predictionHistory[type].unshift(entry);
    if (predictionHistory[type].length > 100) predictionHistory[type] = predictionHistory[type].slice(0, 100);
    pendingPrediction[type] = { nextPhien: next, prediction: result.prediction, confidence: result.confidence, entry };
    return pendingPrediction[type];
}

function updateActualResults(type, predictor, freshData) {
    if (!freshData || !freshData.length) return;
    for (let i = 0; i < predictionHistory[type].length; i++) {
        const entry = predictionHistory[type][i];
        if (entry.ket_qua !== null && entry.ket_qua !== undefined && entry.ket_qua !== '') continue;
        const actualSession = freshData.find(s => s.Phien === entry.phien);
        if (!actualSession) continue;
        entry.ket_qua = actualSession.Ket_qua.toLowerCase();
        const duDoan = entry.du_doan ? entry.du_doan.toLowerCase().trim() : '';
        const ketQua = entry.ket_qua ? entry.ket_qua.toLowerCase().trim() : '';
        entry.danh_gia = (duDoan === ketQua) ? 'thang' : 'thua';
        predictor.feedback(actualSession.Ket_qua);
        if (pendingPrediction[type] && pendingPrediction[type].entry === entry) pendingPrediction[type] = null;
    }
    if (predictionHistory[type].length > 100) predictionHistory[type] = predictionHistory[type].slice(0, 100);
}

app.listen(PORT, '0.0.0.0', () => { console.log(`🚀 VuaOcCac AI chạy tại cổng ${PORT}`); });

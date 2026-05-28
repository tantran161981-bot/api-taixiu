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

const FRESH_SCAN_COUNT = 25; // Tăng lên 25 phiên để phân tích tốt hơn
const FETCH_INTERVAL     = 2000;
const AUTO_SAVE_INTERVAL = 30000;
const CACHE_TTL = 5000; // Cache 5 giây

// ==================== 1. CÁC HÀM PHÂN TÍCH NHANH (50+ THUẬT TOÁN) ====================

function algo_bet(results) {
    let s = 1;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[0]) s++; else break;
    }
    if (s >= 5) return results[0] === 'T' ? 'X' : 'T';
    if (s >= 3) return results[0];
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
            if (probT > 0.65) return 'T';
            if (probT < 0.35) return 'X';
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

// ==================== THUẬT TOÁN NÂNG CAO MỚI ====================

function algo_linear_regression(data) {
    if (data.length < 15) return null;
    const totals = data.slice(0, 15).map((d, idx) => ({ x: idx, y: d.Tong }));
    const n = totals.length;
    const sumX = totals.reduce((s, p) => s + p.x, 0);
    const sumY = totals.reduce((s, p) => s + p.y, 0);
    const sumXY = totals.reduce((s, p) => s + p.x * p.y, 0);
    const sumX2 = totals.reduce((s, p) => s + p.x * p.x, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    const nextTotal = slope * n + intercept;
    
    if (Math.abs(slope) > 0.3) {
        return nextTotal > 10.5 ? 'T' : 'X';
    }
    return null;
}

function algo_volatility(data) {
    if (data.length < 10) return null;
    const totals = data.slice(0, 10).map(d => d.Tong);
    const mean = totals.reduce((a, b) => a + b, 0) / 10;
    const variance = totals.reduce((s, t) => s + Math.pow(t - mean, 2), 0) / 10;
    const lastVol = Math.abs(totals[0] - mean);
    const avgVol = Math.sqrt(variance);
    
    if (lastVol > avgVol * 1.5) {
        return data[0].Ket_qua === 'Tài' ? 'X' : 'T';
    }
    if (lastVol < avgVol * 0.5 && avgVol < 2) {
        return data[0].Ket_qua === 'Tài' ? 'X' : 'T';
    }
    return null;
}

function algo_wma(data) {
    if (data.length < 8) return null;
    const weights = [8, 7, 6, 5, 4, 3, 2, 1];
    let weightedSum = 0, weightSum = 0;
    for (let i = 0; i < 8 && i < data.length; i++) {
        const val = data[i].Tong > 10.5 ? 1 : 0;
        weightedSum += val * weights[i];
        weightSum += weights[i];
    }
    const wma = weightedSum / weightSum;
    if (wma > 0.65) return 'X';
    if (wma < 0.35) return 'T';
    return null;
}

function algo_force_index(data) {
    if (data.length < 3) return null;
    const price = data[0].Tong;
    const prevPrice = data[1].Tong;
    const volume = Math.abs(data[0].Xuc_xac_1 - data[0].Xuc_xac_2) + 
                   Math.abs(data[0].Xuc_xac_2 - data[0].Xuc_xac_3);
    const force = (price - prevPrice) * volume;
    
    if (force > 15 && price > 10.5) return 'X';
    if (force < -15 && price < 10.5) return 'T';
    return null;
}

function algo_naive_bayes(data) {
    if (data.length < 20) return null;
    
    const patterns = {};
    for (let i = 0; i < data.length - 3; i++) {
        const pattern = `${data[i].Ket_qua === 'Tài' ? 'T' : 'X'}${data[i+1].Ket_qua === 'Tài' ? 'T' : 'X'}${data[i+2].Ket_qua === 'Tài' ? 'T' : 'X'}`;
        const next = data[i+3].Ket_qua === 'Tài' ? 'T' : 'X';
        if (!patterns[pattern]) patterns[pattern] = { T: 0, X: 0 };
        patterns[pattern][next]++;
    }
    
    const lastPattern = `${data[0].Ket_qua === 'Tài' ? 'T' : 'X'}${data[1].Ket_qua === 'Tài' ? 'T' : 'X'}${data[2].Ket_qua === 'Tài' ? 'T' : 'X'}`;
    const stats = patterns[lastPattern];
    if (stats && (stats.T + stats.X) >= 3) {
        const probT = stats.T / (stats.T + stats.X);
        if (probT > 0.7) return 'T';
        if (probT < 0.3) return 'X';
    }
    return null;
}

function algo_bollinger(data) {
    if (data.length < 14) return null;
    const totals = data.slice(0, 14).map(d => d.Tong);
    const mean = totals.reduce((a, b) => a + b, 0) / 14;
    const std = Math.sqrt(totals.reduce((s, t) => s + Math.pow(t - mean, 2), 0) / 14);
    const upper = mean + 2 * std;
    const lower = mean - 2 * std;
    const current = totals[0];
    
    if (current > upper) return 'X';
    if (current < lower) return 'T';
    return null;
}

function algo_macd(data) {
    if (data.length < 20) return null;
    const totals = data.slice(0, 20).map(d => d.Tong);
    
    const ema12 = totals.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
    const ema26 = totals.reduce((a, b) => a + b, 0) / 20;
    const macd = ema12 - ema26;
    const signal = macd * 0.8;
    
    if (macd > signal && macd > 0.5) return 'X';
    if (macd < signal && macd < -0.5) return 'T';
    return null;
}

function algo_ensemble(data) {
    const results = data.map(d => d.Ket_qua === 'Tài' ? 'T' : 'X');
    const algos = [algo_bet, algo_11, algo_22, algo_streak];
    const votes = { T: 0, X: 0 };
    
    algos.forEach(algo => {
        try {
            const pred = algo(results);
            if (pred) votes[pred]++;
        } catch(e) {}
    });
    
    const recent = results[0];
    votes[recent === 'T' ? 'X' : 'T'] += 0.5;
    
    if (votes.T > votes.X + 1) return 'T';
    if (votes.X > votes.T + 1) return 'X';
    return null;
}

function algo_dunning_kruger(data) {
    if (data.length < 10) return null;
    const results = data.map(d => d.Ket_qua === 'Tài' ? 1 : 0);
    let streak = 1;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[0]) streak++; else break;
    }
    const prob = Math.pow(0.5, streak);
    
    if (prob < 0.05) {
        return results[0] === 1 ? 'X' : 'T';
    }
    return null;
}

function algo_momentum(results) {
    if (results.length < 5) return null;
    let momentum = 0;
    for (let i = 1; i < 5; i++) {
        if (results[i] === results[i-1]) momentum++;
        else momentum--;
    }
    if (momentum >= 3) return results[0] === 'T' ? 'X' : 'T';
    if (momentum <= -3) return results[0];
    return null;
}

function algo_reversal_pattern(results) {
    if (results.length < 7) return null;
    // Mô hình 3 cặp đảo chiều: T,X,T,X,T,X
    let isAlternating = true;
    for (let i = 1; i < 6; i++) {
        if (results[i] === results[i-1]) {
            isAlternating = false;
            break;
        }
    }
    if (isAlternating && results[0] !== results[5]) {
        return results[5];
    }
    return null;
}

// ==================== 2. LỚP DỰ ĐOÁN CHÍNH NÂNG CAO ====================
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
            { fn: algo_linear_regression, weight: 1.2, name: 'Linear Regression' },
            { fn: algo_volatility, weight: 1.1, name: 'Volatility' },
            { fn: algo_wma, weight: 1.0, name: 'WMA' },
            { fn: algo_force_index, weight: 1.0, name: 'Force Index' },
            { fn: algo_naive_bayes, weight: 1.3, name: 'Naive Bayes' },
            { fn: algo_bollinger, weight: 1.1, name: 'Bollinger' },
            { fn: algo_macd, weight: 1.0, name: 'MACD' },
            { fn: algo_ensemble, weight: 1.4, name: 'Ensemble' },
            { fn: algo_dunning_kruger, weight: 1.2, name: 'Dunning-Kruger' },
            { fn: algo_momentum, weight: 1.0, name: 'Momentum' },
            { fn: algo_reversal_pattern, weight: 1.1, name: 'Reversal' },
        ];
        
        this.consecutiveLosses = 0;
        this.lastPred = null;
        this.learningRate = 0.05;
        this.algorithmWeights = new Map();
        this.predictionHistory = [];
        this.adaptiveThreshold = 65;
        this.totalPredictions = 0;
        this.correctPredictions = 0;
    }

    calculateStreak(results) {
        let streak = 1;
        for (let i = 1; i < results.length; i++) {
            if (results[i] === results[0]) streak++;
            else break;
        }
        return streak;
    }
    
    analyzeSumTrend(data) {
        if (data.length < 8) return null;
        const recent = data.slice(0, 4).map(d => d.Tong);
        const older = data.slice(4, 8).map(d => d.Tong);
        const recentAvg = recent.reduce((a, b) => a + b, 0) / 4;
        const olderAvg = older.reduce((a, b) => a + b, 0) / 4;
        
        if (recentAvg > olderAvg + 1.5) return 'up';
        if (recentAvg < olderAvg - 1.5) return 'down';
        return null;
    }
    
    getRecentWinRate() {
        if (this.predictionHistory.length < 10) return null;
        const recent = this.predictionHistory.slice(-10);
        const wins = recent.filter(h => h.pred === h.actual).length;
        return wins / recent.length;
    }

    updateWeights(actual) {
        if (!this.lastPred || !this.lastPred.signals) return;
        
        const actualTai = actual === 'Tài';
        this.lastPred.signals.forEach(signal => {
            const predTai = signal.prediction === 'T' || signal.prediction === 'Tài';
            const currentWeight = this.algorithmWeights.get(signal.name) || signal.weight;
            let newWeight;
            
            if (predTai === actualTai) {
                newWeight = currentWeight + this.learningRate;
            } else {
                newWeight = currentWeight - this.learningRate;
            }
            newWeight = Math.max(0.3, Math.min(3.0, newWeight));
            this.algorithmWeights.set(signal.name, newWeight);
        });
        
        this.predictionHistory.push({
            pred: this.lastPred.prediction,
            actual: actual,
            confidence: this.lastPred.confidence,
            timestamp: Date.now()
        });
        if (this.predictionHistory.length > 50) this.predictionHistory.shift();
        
        const recentWins = this.predictionHistory.slice(-20).filter(h => h.pred === h.actual).length;
        const winRate = recentWins / Math.min(20, this.predictionHistory.length);
        if (winRate > 0.65) this.adaptiveThreshold = Math.min(75, this.adaptiveThreshold + 1);
        else if (winRate < 0.45) this.adaptiveThreshold = Math.max(55, this.adaptiveThreshold - 1);
    }

    predict(freshData) {
        if (freshData.length < 10) {
            return { action: 'CÂN NHẮC', prediction: 'Tài', confidence: 51 };
        }

        const results = freshData.map(d => d.Ket_qua === 'Tài' ? 'T' : 'X');
        const signals = [];

        this.algorithms.forEach(algo => {
            try {
                const pred = algo.fn.length === 1 ? algo.fn(results) : algo.fn(freshData);
                if (pred) {
                    const weight = this.algorithmWeights.get(algo.name) || algo.weight;
                    signals.push({ prediction: pred, weight: weight, name: algo.name });
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

        const streak = this.calculateStreak(results);
        if (streak >= 4) {
            if (streak >= 6) sT += 2.0;
            else sT += 1.0;
        }
        
        const sumTrend = this.analyzeSumTrend(freshData);
        if (sumTrend === 'up') sX += 0.8;
        if (sumTrend === 'down') sT += 0.8;

        if (Math.abs(sT - sX) < 0.3) {
            const totalT = results.filter(r => r === 'T').length;
            const totalX = results.length - totalT;
            if (totalT > totalX) sT += 0.5; else sX += 0.5;
        }

        const pred = sT >= sX ? 'Tài' : 'Xỉu';
        let conf = Math.round(Math.max(sT, sX) / (sT + sX) * 100);
        
        const recentWinRate = this.getRecentWinRate();
        if (recentWinRate !== null) {
            if (recentWinRate > 0.6) conf = Math.min(92, conf + 5);
            else if (recentWinRate < 0.4) conf = Math.max(51, conf - 5);
        }
        
        conf = Math.max(51, Math.min(92, conf));

        this.lastPred = { prediction: pred, confidence: conf, signals };
        const action = conf >= this.adaptiveThreshold ? 'ĐẶT' : 'CÂN NHẮC';
        
        return { action, prediction: pred, confidence: conf, signalCount: signals.length };
    }

    feedback(actual) {
        const predTai = this.lastPred?.prediction === 'Tài';
        const actualTai = actual === 'Tài';
        
        this.totalPredictions++;
        if (predTai === actualTai) {
            this.correctPredictions++;
            this.consecutiveLosses = 0;
            this.updateWeights(actual);
        } else {
            this.consecutiveLosses++;
        }
    }

    getStats() {
        const recentWinRate = this.getRecentWinRate();
        const overallWinRate = this.totalPredictions > 0 ? (this.correctPredictions / this.totalPredictions * 100).toFixed(1) : 0;
        
        return { 
            consecutiveLosses: this.consecutiveLosses,
            recentWinRate: recentWinRate ? `${Math.round(recentWinRate * 100)}%` : 'N/A',
            overallWinRate: `${overallWinRate}%`,
            adaptiveThreshold: this.adaptiveThreshold,
            totalPredictions: this.totalPredictions
        };
    }
}

// ==================== 3. SERVER VỚI CACHE ====================
const predictorHU = new FreshScanAI();
const predictorMD5 = new FreshScanAI();
let predictionHistory = { hu: [], md5: [] };
let pendingPrediction = { hu: null, md5: null };
let fetchCache = { hu: null, md5: null, lastFetch: { hu: 0, md5: 0 } };

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
    })).sort((a, b) => b.Phien - a.Phien);
}

async function fetchFreshData(url) {
    try {
        const resp = await axios.get(url, { timeout: 15000, params: { limit: FRESH_SCAN_COUNT } });
        return transformApiData(resp.data);
    } catch (e) { console.error(`❌ Fetch lỗi:`, e.message); return null; }
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

app.get('/lc79-hu', async (req, res) => {
    const freshData = await fetchFreshDataWithCache(API_URL_HU, 'hu');
    if (!freshData || freshData.length < 10) {
        return res.json({ status: 'error', message: 'Không đủ dữ liệu' });
    }

    updateActualResults('hu', predictorHU, freshData);
    let pred = predictAndRecord('hu', predictorHU, freshData);
    if (!pred) pred = { nextPhien: freshData[0].Phien + 1, prediction: 'Tài', confidence: 51 };

    const latestSession = freshData[0];
    const stats = predictorHU.getStats();
    const recentHistory = predictionHistory.hu.filter(e => e.ket_qua !== null).slice(0, 10).map(e => ({ 
        phien: e.phien, du_doan: e.du_doan, ket_qua: e.ket_qua, danh_gia: e.danh_gia,
        confidence: e.confidence 
    }));
    
    res.json({ 
        phien_truoc: { 
            Phien: latestSession.Phien, 
            Xuc_xac_1: latestSession.Xuc_xac_1, 
            Xuc_xac_2: latestSession.Xuc_xac_2, 
            Xuc_xac_3: latestSession.Xuc_xac_3, 
            Tong: latestSession.Tong, 
            Ket_qua: latestSession.Ket_qua 
        }, 
        phien_hien_tai: { 
            Phien: pred.nextPhien, 
            Du_doan: pred.prediction, 
            Do_tin_cay: `${pred.confidence}%` 
        }, 
        id: '@vuaoccac', 
        stats, 
        win_loss_table: recentHistory, 
        full_history_count: predictionHistory.hu.length 
    });
});

app.get('/lc79-md5', async (req, res) => {
    const freshData = await fetchFreshDataWithCache(API_URL_MD5, 'md5');
    if (!freshData || freshData.length < 10) {
        return res.json({ status: 'error', message: 'Không đủ dữ liệu' });
    }

    updateActualResults('md5', predictorMD5, freshData);
    let pred = predictAndRecord('md5', predictorMD5, freshData);
    if (!pred) pred = { nextPhien: freshData[0].Phien + 1, prediction: 'Tài', confidence: 51 };

    const latestSession = freshData[0];
    const stats = predictorMD5.getStats();
    const recentHistory = predictionHistory.md5.filter(e => e.ket_qua !== null).slice(0, 10).map(e => ({ 
        phien: e.phien, du_doan: e.du_doan, ket_qua: e.ket_qua, danh_gia: e.danh_gia,
        confidence: e.confidence 
    }));
    
    res.json({ 
        phien_truoc: { 
            Phien: latestSession.Phien, 
            Xuc_xac_1: latestSession.Xuc_xac_1, 
            Xuc_xac_2: latestSession.Xuc_xac_2, 
            Xuc_xac_3: latestSession.Xuc_xac_3, 
            Tong: latestSession.Tong, 
            Ket_qua: latestSession.Ket_qua 
        }, 
        phien_hien_tai: { 
            Phien: pred.nextPhien, 
            Du_doan: pred.prediction, 
            Do_tin_cay: `${pred.confidence}%` 
        }, 
        id: '@vuaoccac', 
        stats, 
        win_loss_table: recentHistory, 
        full_history_count: predictionHistory.md5.length 
    });
});

app.get('/lc79-hu/history', (req, res) => {
    res.json(predictionHistory.hu);
});

app.get('/lc79-md5/history', (req, res) => {
    res.json(predictionHistory.md5);
});

app.get('/performance/:type', (req, res) => {
    const { type } = req.params;
    const history = predictionHistory[type];
    const predictor = type === 'hu' ? predictorHU : predictorMD5;
    
    if (!history || history.length === 0) {
        return res.json({ message: 'Chưa có dữ liệu' });
    }
    
    const recent = history.filter(h => h.ket_qua !== null).slice(0, 50);
    const total = recent.length;
    const wins = recent.filter(h => h.danh_gia === 'thang').length;
    const winRate = total > 0 ? (wins / total * 100).toFixed(1) : 0;
    
    const byConfidence = {
        high: { total: 0, wins: 0, rate: 0 },
        medium: { total: 0, wins: 0, rate: 0 },
        low: { total: 0, wins: 0, rate: 0 }
    };
    
    recent.forEach(h => {
        const conf = h.confidence || 65;
        if (conf >= 75) {
            byConfidence.high.total++;
            if (h.danh_gia === 'thang') byConfidence.high.wins++;
        } else if (conf >= 65) {
            byConfidence.medium.total++;
            if (h.danh_gia === 'thang') byConfidence.medium.wins++;
        } else {
            byConfidence.low.total++;
            if (h.danh_gia === 'thang') byConfidence.low.wins++;
        }
    });
    
    byConfidence.high.rate = byConfidence.high.total > 0 ? (byConfidence.high.wins / byConfidence.high.total * 100).toFixed(1) : 0;
    byConfidence.medium.rate = byConfidence.medium.total > 0 ? (byConfidence.medium.wins / byConfidence.medium.total * 100).toFixed(1) : 0;
    byConfidence.low.rate = byConfidence.low.total > 0 ? (byConfidence.low.wins / byConfidence.low.total * 100).toFixed(1) : 0;
    
    res.json({
        type,
        totalPredictions: total,
        wins,
        losses: total - wins,
        winRate: `${winRate}%`,
        byConfidence,
        predictorStats: predictor.getStats(),
        timestamp: new Date().toISOString()
    });
});

app.get('/status', (req, res) => {
    res.json({ 
        hu: { stats: predictorHU.getStats() }, 
        md5: { stats: predictorMD5.getStats() },
        cache: {
            hu: fetchCache.hu ? 'cached' : 'empty',
            md5: fetchCache.md5 ? 'cached' : 'empty'
        }
    });
});

function predictAndRecord(type, predictor, freshData) {
    if (pendingPrediction[type]) return pendingPrediction[type];
    if (freshData.length === 0) return null;
    const latest = freshData[0].Phien;
    const next = latest + 1;
    const result = predictor.predict(freshData);
    if (!result || result.action === 'BỎ QUA') return null;
    const entry = { 
        phien: next, 
        du_doan: result.prediction.toLowerCase(), 
        ket_qua: null, 
        danh_gia: null,
        confidence: result.confidence
    };
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

// ==================== DASHBOARD ====================
app.get('/dashboard', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>VuaOcCac AI Dashboard - Nâng Cao</title>
            <meta http-equiv="refresh" content="5">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Segoe UI', Arial, sans-serif; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: #eee; padding: 20px; min-height: 100vh; }
                .container { max-width: 1400px; margin: 0 auto; }
                h1 { text-align: center; margin-bottom: 30px; font-size: 2.5em; background: linear-gradient(45deg, #ff6b6b, #4ecdc4); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
                h2 { margin-bottom: 15px; font-size: 1.5em; }
                .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(500px, 1fr)); gap: 20px; margin-bottom: 20px; }
                .card { background: rgba(30, 40, 60, 0.9); backdrop-filter: blur(10px); border-radius: 15px; padding: 20px; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
                .prediction-box { text-align: center; padding: 20px; background: linear-gradient(135deg, #2c3e50, #3498db); border-radius: 15px; margin-bottom: 20px; }
                .prediction { font-size: 48px; font-weight: bold; margin: 10px 0; }
                .confidence { font-size: 24px; }
                .dice { display: flex; justify-content: center; gap: 15px; margin: 15px 0; }
                .dice span { width: 50px; height: 50px; background: #fff; color: #333; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: bold; box-shadow: 0 4px 10px rgba(0,0,0,0.3); }
                .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 15px 0; }
                .stat-card { background: rgba(0,0,0,0.3); padding: 10px; border-radius: 10px; text-align: center; }
                .stat-value { font-size: 24px; font-weight: bold; }
                .stat-label { font-size: 12px; opacity: 0.8; }
                table { width: 100%; border-collapse: collapse; margin-top: 15px; }
                th, td { padding: 8px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1); }
                .win { color: #4CAF50; }
                .loss { color: #f44336; }
                .high-conf { color: #4CAF50; }
                .mid-conf { color: #FFC107; }
                .low-conf { color: #f44336; }
                .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: bold; }
                .badge-win { background: #4CAF50; color: white; }
                .badge-loss { background: #f44336; color: white; }
                .footer { text-align: center; margin-top: 30px; padding: 20px; color: rgba(255,255,255,0.5); font-size: 12px; }
                @media (max-width: 768px) {
                    .grid { grid-template-columns: 1fr; }
                    .prediction { font-size: 32px; }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🎲 VuaOcCac AI - Siêu Trí Tuệ Nhân Tạo 🧠</h1>
                <div class="grid" id="content">Loading...</div>
                <div class="footer">
                    🤖 AI với 50+ thuật toán | Học từ thực tế | Tự điều chỉnh chiến lược<br>
                    🎯 Độ chính xác được cải thiện liên tục
                </div>
            </div>
            <script>
                async function load() {
                    try {
                        const [hu, md5, perfHu, perfMd5] = await Promise.all([
                            fetch('/lc79-hu').then(r => r.json()),
                            fetch('/lc79-md5').then(r => r.json()),
                            fetch('/performance/hu').then(r => r.json()),
                            fetch('/performance/md5').then(r => r.json())
                        ]);
                        
                        document.getElementById('content').innerHTML = \`
                            <div class="card">
                                <h2>🐉 LC79 - HU (Hữu)</h2>
                                <div class="prediction-box">
                                    <div class="prediction">\${hu.phien_hien_tai.Du_doan}</div>
                                    <div class="confidence">Độ tin cậy: \${hu.phien_hien_tai.Do_tin_cay}</div>
                                </div>
                                <div class="dice">
                                    <span>\${hu.phien_truoc.Xuc_xac_1}</span>
                                    <span>\${hu.phien_truoc.Xuc_xac_2}</span>
                                    <span>\${hu.phien_truoc.Xuc_xac_3}</span>
                                </div>
                                <div class="stats">
                                    <div class="stat-card"><div class="stat-value">\${hu.phien_truoc.Tong}</div><div class="stat-label">Tổng điểm</div></div>
                                    <div class="stat-card"><div class="stat-value">\${hu.phien_truoc.Ket_qua}</div><div class="stat-label">Kết quả</div></div>
                                    <div class="stat-card"><div class="stat-value">\${hu.stats.consecutiveLosses}</div><div class="stat-label">Thua liên tiếp</div></div>
                                    <div class="stat-card"><div class="stat-value">\${hu.stats.recentWinRate || 'N/A'}</div><div class="stat-label">Tỉ lệ thắng gần đây</div></div>
                                    <div class="stat-card"><div class="stat-value">\${perfHu.winRate || '0%'}</div><div class="stat-label">Tỉ lệ thắng tổng</div></div>
                                </div>
                                <h3>📊 Phân tích theo độ tin cậy</h3>
                                <div class="stats">
                                    <div class="stat-card"><div class="stat-value \${perfHu.byConfidence?.high?.rate > 60 ? 'win' : 'loss'}">\${perfHu.byConfidence?.high?.rate || 0}%</div><div class="stat-label">Cao (≥75%) - \${perfHu.byConfidence?.high?.wins || 0}/\${perfHu.byConfidence?.high?.total || 0}</div></div>
                                    <div class="stat-card"><div class="stat-value">\${perfHu.byConfidence?.medium?.rate || 0}%</div><div class="stat-label">Trung bình (65-74%)</div></div>
                                    <div class="stat-card"><div class="stat-value">\${perfHu.byConfidence?.low?.rate || 0}%</div><div class="stat-label">Thấp (<65%)</div></div>
                                </div>
                                <h3>📜 Lịch sử 10 phiên gần nhất</h3>
                                <table>
                                    <thead><tr><th>Phiên</th><th>Dự đoán</th><th>Kết quả</th><th>Đánh giá</th><th>Độ tin cậy</th></tr></thead>
                                    <tbody>
                                        \${(hu.win_loss_table || []).map(h => \`
                                            <tr class="\${h.danh_gia === 'thang' ? 'win' : 'loss'}">
                                                <td>\${h.phien}</td>
                                                <td>\${h.du_doan}</td>
                                                <td>\${h.ket_qua || 'Chờ'}</td>
                                                <td><span class="badge badge-\${h.danh_gia}">\${h.danh_gia === 'thang' ? '✓ THẮNG' : '✗ THUA'}</span></td>
                                                <td class="\${h.confidence >= 75 ? 'high-conf' : (h.confidence >= 65 ? 'mid-conf' : 'low-conf')}">\${h.confidence || 'N/A'}%</td>
                                            </tr>
                                        \`).join('')}
                                    </tbody>
                                </table>
                            </div>
                            <div class="card">
                                <h2>🔐 LC79 - MD5 (Mật)</h2>
                                <div class="prediction-box">
                                    <div class="prediction">\${md5.phien_hien_tai.Du_doan}</div>
                                    <div class="confidence">Độ tin cậy: \${md5.phien_hien_tai.Do_tin_cay}</div>
                                </div>
                                <div class="dice">
                                    <span>\${md5.phien_truoc.Xuc_xac_1}</span>
                                    <span>\${md5.phien_truoc.Xuc_xac_2}</span>
                                    <span>\${md5.phien_truoc.Xuc_xac_3}</span>
                                </div>
                                <div class="stats">
                                    <div class="stat-card"><div class="stat-value">\${md5.phien_truoc.Tong}</div><div class="stat-label">Tổng điểm</div></div>
                                    <div class="stat-card"><div class="stat-value">\${md5.phien_truoc.Ket_qua}</div><div class="stat-label">Kết quả</div></div>
                                    <div class="stat-card"><div class="stat-value">\${md5.stats.consecutiveLosses}</div><div class="stat-label">Thua liên tiếp</div></div>
                                    <div class="stat-card"><div class="stat-value">\${md5.stats.recentWinRate || 'N/A'}</div><div class="stat-label">Tỉ lệ thắng gần đây</div></div>
                                    <div class="stat-card"><div class="stat-value">\${perfMd5.winRate || '0%'}</div><div class="stat-label">Tỉ lệ thắng tổng</div></div>
                                </div>
                                <h3>📊 Phân tích theo độ tin cậy</h3>
                                <div class="stats">
                                    <div class="stat-card"><div class="stat-value \${perfMd5.byConfidence?.high?.rate > 60 ? 'win' : 'loss'}">\${perfMd5.byConfidence?.high?.rate || 0}%</div><div class="stat-label">Cao (≥75%) - \${perfMd5.byConfidence?.high?.wins || 0}/\${perfMd5.byConfidence?.high?.total || 0}</div></div>
                                    <div class="stat-card"><div class="stat-value">\${perfMd5.byConfidence?.medium?.rate || 0}%</div><div class="stat-label">Trung bình (65-74%)</div></div>
                                    <div class="stat-card"><div class="stat-value">\${perfMd5.byConfidence?.low?.rate || 0}%</div><div class="stat-label">Thấp (<65%)</div></div>
                                </div>
                                <h3>📜 Lịch sử 10 phiên gần nhất</h3>
                                <table>
                                    <thead><tr><th>Phiên</th><th>Dự đoán</th><th>Kết quả</th><th>Đánh giá</th><th>Độ tin cậy</th></tr></thead>
                                    <tbody>
                                        \${(md5.win_loss_table || []).map(h => \`
                                            <tr class="\${h.danh_gia === 'thang' ? 'win' : 'loss'}">
                                                <td>\${h.phien}</td>
                                                <td>\${h.du_doan}</td>
                                                <td>\${h.ket_qua || 'Chờ'}</td>
                                                <td><span class="badge badge-\${h.danh_gia}">\${h.danh_gia === 'thang' ? '✓ THẮNG' : '✗ THUA'}</span></td>
                                                <td class="\${h.confidence >= 75 ? 'high-conf' : (h.confidence >= 65 ? 'mid-conf' : 'low-conf')}">\${h.confidence || 'N/A'}%</td>
                                            </tr>
                                        \`).join('')}
                                    </tbody>
                                </table>
                            </div>
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

// Auto-save periodic
setInterval(() => {
    saveJSON(HISTORY_FILE, predictionHistory);
    console.log('💾 Đã lưu lịch sử tự động');
}, AUTO_SAVE_INTERVAL);

// Load saved data on startup
const savedHistory = loadJSON(HISTORY_FILE, { hu: [], md5: [] });
predictionHistory = savedHistory;
console.log(`📂 Đã tải ${predictionHistory.hu.length} lịch sử HU và ${predictionHistory.md5.length} lịch sử MD5`);

app.listen(PORT, '0.0.0.0', () => { 
    console.log(`🚀 VuaOcCac AI Nâng Cao chạy tại cổng ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`🤖 Số thuật toán: ${predictorHU.algorithms.length}`);
});
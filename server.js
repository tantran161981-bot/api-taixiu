const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const HISTORY_FILE = 'real_history.json';

let predictionHistory = { hu: [], md5: [] };
let lastProcessedPhien = { hu: null, md5: null };

// ==================== HỆ THỐNG DỰ ĐOÁN CHUYÊN NGHIỆP ====================

class RealPredictor {
    constructor(type) {
        this.type = type;
        
        // Dữ liệu thống kê
        this.stats = {
            total: 0,
            correct: 0,
            winStreak: 0,
            lossStreak: 0,
            bestStreak: 0,
            accuracy: 0.5
        };
        
        // Bộ nhớ pattern (học từ thực tế)
        this.patternDB = new Map();
        this.sequenceMemory = [];
        
        // Phân tích chu kỳ
        this.cycles = {
            length: 0,
            phase: 0,
            confidence: 0
        };
        
        // Trọng số động
        this.weights = {
            pattern: 1.0,
            trend: 1.0,
            cycle: 1.0,
            volatility: 1.0,
            reversal: 1.0
        };
    }

    // ========== 1. PHÂN TÍCH PATTERN REAL ==========
    analyzeRealPatterns(results) {
        let score = 0.5;
        let confidence = 0;
        
        // Lấy 20 phiên gần nhất
        const recent = results.slice(0, 20);
        
        // === CẦU BỆT (STREAK) ===
        let streak = 1;
        for (let i = 1; i < recent.length; i++) {
            if (recent[i] === recent[0]) streak++;
            else break;
        }
        
        if (streak >= 5) {
            // Bệt 5+ -> bẻ cầu rất cao
            score = recent[0] === 'Tài' ? 0.25 : 0.75;
            confidence = 0.85;
        } else if (streak >= 4) {
            score = recent[0] === 'Tài' ? 0.3 : 0.7;
            confidence = 0.75;
        } else if (streak >= 3) {
            score = recent[0] === 'Tài' ? 0.4 : 0.6;
            confidence = 0.65;
        } else if (streak === 2) {
            score = recent[0] === 'Tài' ? 0.48 : 0.52;
            confidence = 0.55;
        }
        
        // === CẦU 1-1 (ALTERNATING) ===
        let altLength = 1;
        for (let i = 1; i < Math.min(recent.length, 15); i++) {
            if (recent[i] !== recent[i-1]) altLength++;
            else break;
        }
        
        if (altLength >= 6) {
            // Đảo 6+ -> bẻ
            score = recent[0] === 'Tài' ? 0.7 : 0.3;
            confidence = Math.max(confidence, 0.8);
        } else if (altLength >= 4) {
            score = recent[0] === 'Tài' ? 0.6 : 0.4;
            confidence = Math.max(confidence, 0.7);
        } else if (altLength >= 3) {
            score = recent[0] === 'Tài' ? 0.55 : 0.45;
            confidence = Math.max(confidence, 0.6);
        }
        
        // === CẦU 2-2 ===
        let pairCount = 0;
        for (let i = 0; i < recent.length - 1; i += 2) {
            if (recent[i] === recent[i+1]) pairCount++;
            else break;
        }
        
        if (pairCount >= 3) {
            score = recent[0] === 'Tài' ? 0.3 : 0.7;
            confidence = Math.max(confidence, 0.8);
        } else if (pairCount >= 2) {
            score = recent[0] === 'Tài' ? 0.4 : 0.6;
            confidence = Math.max(confidence, 0.7);
        }
        
        // === PATTERN ĐẶC BIỆT: 1-2-1 ===
        if (recent.length >= 4) {
            if (recent[0] !== recent[1] && 
                recent[1] === recent[2] && 
                recent[2] !== recent[3] &&
                recent[0] === recent[3]) {
                score = recent[0] === 'Tài' ? 0.65 : 0.35;
                confidence = Math.max(confidence, 0.75);
            }
        }
        
        // === PATTERN 1-2-3 ===
        if (recent.length >= 4) {
            if (recent[0] !== recent[1] && 
                recent[1] !== recent[2] && 
                recent[2] !== recent[3]) {
                score = recent[3] === 'Tài' ? 0.6 : 0.4;
                confidence = Math.max(confidence, 0.7);
            }
        }
        
        // === PATTERN 3-2-1 ===
        if (recent.length >= 6) {
            const first3Same = recent[0] === recent[1] && recent[1] === recent[2];
            const next2Same = recent[3] === recent[4];
            if (first3Same && next2Same && recent[0] !== recent[3]) {
                score = recent[3] === 'Tài' ? 0.65 : 0.35;
                confidence = Math.max(confidence, 0.75);
            }
        }
        
        return { score, confidence, pattern: 'pattern_analysis' };
    }

    // ========== 2. PHÂN TÍCH XU HƯỚNG THỰC ==========
    analyzeRealTrend(sums, results) {
        if (sums.length < 5) return { score: 0.5, confidence: 0.5 };
        
        // Xu hướng tổng điểm
        const recent10 = sums.slice(0, 10);
        const avgSum = recent10.reduce((a, b) => a + b, 0) / recent10.length;
        
        // Xu hướng tăng/giảm
        let trend = 0;
        for (let i = 0; i < recent10.length - 1; i++) {
            trend += recent10[i] - recent10[i+1];
        }
        
        let score = 0.5;
        let confidence = 0.6;
        
        if (avgSum > 11.5) {
            // Tổng cao -> xu hướng Xỉu
            score = 0.4;
            confidence = 0.65;
        } else if (avgSum < 9.5) {
            // Tổng thấp -> xu hướng Tài
            score = 0.6;
            confidence = 0.65;
        }
        
        // Điều chỉnh theo trend
        if (trend > 5) {
            // Tổng đang giảm mạnh -> Tài
            score = Math.max(score, 0.65);
        } else if (trend < -5) {
            // Tổng đang tăng mạnh -> Xỉu
            score = Math.min(score, 0.35);
        }
        
        return { score, confidence, trend: trend };
    }

    // ========== 3. PHÂN TÍCH CHU KỲ ==========
    analyzeCycle(results) {
        if (results.length < 30) return { score: 0.5, confidence: 0.4 };
        
        // Tìm chu kỳ lặp lại
        const sequence = results.map(r => r === 'Tài' ? 1 : 0);
        let bestPeriod = 0;
        let bestCorrelation = 0;
        
        for (let period = 3; period <= 15; period++) {
            let correlation = 0;
            let count = 0;
            for (let i = period; i < Math.min(sequence.length, 50); i++) {
                correlation += sequence[i] === sequence[i - period] ? 1 : 0;
                count++;
            }
            const corrRate = correlation / count;
            if (corrRate > bestCorrelation && corrRate > 0.6) {
                bestCorrelation = corrRate;
                bestPeriod = period;
            }
        }
        
        if (bestPeriod > 0 && bestCorrelation > 0.65) {
            const nextIndex = bestPeriod;
            const predictedValue = results[nextIndex - 1];
            const score = predictedValue === 'Tài' ? 0.65 : 0.35;
            return { score, confidence: 0.7, period: bestPeriod };
        }
        
        return { score: 0.5, confidence: 0.4 };
    }

    // ========== 4. PHÂN TÍCH BIẾN ĐỘNG ==========
    analyzeVolatility(sums) {
        if (sums.length < 10) return { score: 0.5, confidence: 0.4 };
        
        const recent = sums.slice(0, 10);
        const mean = recent.reduce((a, b) => a + b, 0) / 10;
        const variance = recent.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / 10;
        const volatility = Math.sqrt(variance);
        
        let score = 0.5;
        let confidence = 0.5;
        
        if (volatility > 3.5) {
            // Biến động cao -> dễ đảo chiều
            score = 0.45;
            confidence = 0.65;
        } else if (volatility < 1.5) {
            // Biến động thấp -> dễ bệt
            score = 0.55;
            confidence = 0.6;
        }
        
        return { score, confidence, volatility };
    }

    // ========== 5. TÍN HIỆU ĐẢO CHIỀU ==========
    analyzeReversal(results, sums) {
        if (results.length < 10) return { score: 0.5, confidence: 0.4 };
        
        let reversalSignal = 0;
        
        // Kiểm tra oversold/overbought
        const taiCount = results.slice(0, 10).filter(r => r === 'Tài').length;
        if (taiCount >= 8) {
            reversalSignal = -0.3; // Quá nhiều Tài -> đảo Xỉu
        } else if (taiCount <= 2) {
            reversalSignal = 0.3; // Quá nhiều Xỉu -> đảo Tài
        }
        
        // Kiểm tra cầu cực đoan
        let streak = 1;
        for (let i = 1; i < results.length; i++) {
            if (results[i] === results[0]) streak++;
            else break;
        }
        
        if (streak >= 6) {
            reversalSignal = results[0] === 'Tài' ? -0.35 : 0.35;
        } else if (streak >= 4) {
            reversalSignal = results[0] === 'Tài' ? -0.2 : 0.2;
        }
        
        const score = 0.5 + reversalSignal;
        const confidence = 0.7 + Math.abs(reversalSignal) * 0.3;
        
        return { score, confidence, signal: reversalSignal };
    }

    // ========== 6. HỌC TỪ DỮ LIỆU LỊCH SỬ ==========
    learnFromHistory(results) {
        if (results.length < 20) return { score: 0.5, confidence: 0.3 };
        
        // Lưu pattern vào database
        for (let i = 0; i < results.length - 4; i++) {
            const pattern = results.slice(i, i + 4).join(',');
            const next = results[i + 4];
            
            if (!this.patternDB.has(pattern)) {
                this.patternDB.set(pattern, { Tai: 0, Xiu: 0, total: 0 });
            }
            const entry = this.patternDB.get(pattern);
            if (next === 'Tài') entry.Tai++;
            else entry.Xiu++;
            entry.total++;
        }
        
        // Tìm pattern khớp với 4 phiên gần nhất
        const last4 = results.slice(0, 4).join(',');
        const match = this.patternDB.get(last4);
        
        if (match && match.total >= 3) {
            const taiProb = match.Tai / match.total;
            const score = taiProb;
            const confidence = Math.min(0.85, 0.5 + match.total / 50);
            return { score, confidence, sampleSize: match.total };
        }
        
        return { score: 0.5, confidence: 0.3 };
    }

    // ========== DỰ ĐOÁN CHÍNH ==========
    predict(data) {
        const results = data.map(d => d.Ket_qua);
        const sums = data.map(d => d.Tong);
        
        // Lấy dự đoán từ từng phương pháp
        const pattern = this.analyzeRealPatterns(results);
        const trend = this.analyzeRealTrend(sums, results);
        const cycle = this.analyzeCycle(results);
        const volatility = this.analyzeVolatility(sums);
        const reversal = this.analyzeReversal(results, sums);
        const history = this.learnFromHistory(results);
        
        // Tổng hợp với trọng số
        let totalTaiProb = 0;
        let totalWeight = 0;
        
        const predictions = [
            { ...pattern, weight: this.weights.pattern },
            { ...trend, weight: this.weights.trend },
            { ...cycle, weight: this.weights.cycle },
            { ...volatility, weight: this.weights.volatility },
            { ...reversal, weight: this.weights.reversal },
            { ...history, weight: 0.8 }
        ];
        
        for (const p of predictions) {
            totalTaiProb += p.score * p.weight;
            totalWeight += p.weight;
        }
        
        let finalProb = totalTaiProb / totalWeight;
        
        // Điều chỉnh dựa trên độ chính xác gần đây
        if (this.stats.accuracy > 0.6) {
            finalProb = finalProb * 1.05;
        } else if (this.stats.accuracy < 0.45) {
            finalProb = finalProb * 0.95;
        }
        
        // Giới hạn
        finalProb = Math.min(0.88, Math.max(0.12, finalProb));
        
        const prediction = finalProb > 0.5 ? 'Tài' : 'Xỉu';
        let confidence = Math.round(60 + Math.abs(finalProb - 0.5) * 60);
        confidence = Math.min(92, Math.max(65, confidence));
        
        // Tính toán độ tin cậy tổng
        const avgConfidence = predictions.reduce((a, p) => a + p.confidence, 0) / predictions.length;
        
        return {
            prediction,
            confidence,
            probability: finalProb,
            details: {
                pattern: { score: pattern.score, confidence: pattern.confidence },
                trend: { score: trend.score, confidence: trend.confidence },
                cycle: { score: cycle.score, confidence: cycle.confidence },
                reversal: { score: reversal.score, confidence: reversal.confidence },
                history: { score: history.score, confidence: history.confidence }
            },
            overallConfidence: avgConfidence
        };
    }

    // ========== CẬP NHẬT KẾT QUẢ ==========
    update(actual, predicted, wasCorrect) {
        this.stats.total++;
        if (wasCorrect) {
            this.stats.correct++;
            this.stats.winStreak++;
            this.stats.lossStreak = 0;
            if (this.stats.winStreak > this.stats.bestStreak) {
                this.stats.bestStreak = this.stats.winStreak;
            }
        } else {
            this.stats.lossStreak++;
            this.stats.winStreak = 0;
        }
        
        // Cập nhật accuracy
        this.stats.accuracy = this.stats.correct / this.stats.total;
        
        // Điều chỉnh trọng số dựa trên performance
        if (wasCorrect) {
            // Tăng trọng số của các phương pháp
            for (const key in this.weights) {
                this.weights[key] = Math.min(1.3, this.weights[key] + 0.01);
            }
        } else {
            // Giảm nhẹ
            for (const key in this.weights) {
                this.weights[key] = Math.max(0.7, this.weights[key] - 0.005);
            }
        }
        
        // Lưu vào bộ nhớ
        this.sequenceMemory.unshift({
            actual,
            predicted,
            wasCorrect,
            timestamp: Date.now()
        });
        
        if (this.sequenceMemory.length > 200) {
            this.sequenceMemory.pop();
        }
    }
}

// ==================== KHỞI TẠO ====================
const predictors = {
    hu: new RealPredictor('hu'),
    md5: new RealPredictor('md5')
};

// ==================== API FUNCTIONS ====================
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
        const response = await axios.get(API_URL_HU, { timeout: 10000 });
        return transformApiData(response.data);
    } catch (error) {
        console.error('❌ HU fetch error:', error.message);
        return null;
    }
}

async function fetchDataMd5() {
    try {
        const response = await axios.get(API_URL_MD5, { timeout: 10000 });
        return transformApiData(response.data);
    } catch (error) {
        console.error('❌ MD5 fetch error:', error.message);
        return null;
    }
}

function saveHistory() {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify({
            history: predictionHistory,
            lastProcessedPhien,
            stats: {
                hu: predictors.hu.stats,
                md5: predictors.md5.stats
            },
            weights: {
                hu: predictors.hu.weights,
                md5: predictors.md5.weights
            },
            lastSaved: new Date().toISOString()
        }, null, 2));
    } catch (e) {
        console.error('Save error:', e.message);
    }
}

function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
            predictionHistory = data.history || { hu: [], md5: [] };
            lastProcessedPhien = data.lastProcessedPhien || { hu: null, md5: null };
            if (data.stats) {
                predictors.hu.stats = { ...predictors.hu.stats, ...data.stats.hu };
                predictors.md5.stats = { ...predictors.md5.stats, ...data.stats.md5 };
            }
            if (data.weights) {
                predictors.hu.weights = { ...predictors.hu.weights, ...data.weights.hu };
                predictors.md5.weights = { ...predictors.md5.weights, ...data.weights.md5 };
            }
            console.log('✅ Loaded history successfully');
        }
    } catch (e) {
        console.error('Load error:', e.message);
    }
}

// ==================== AUTO PROCESS ====================
async function autoProcess() {
    try {
        for (const type of ['hu', 'md5']) {
            const data = type === 'hu' ? await fetchDataHu() : await fetchDataMd5();
            if (!data?.length) continue;
            
            const latestPhien = data[0].Phien;
            const nextPhien = latestPhien + 1;
            
            // Verify previous prediction
            const lastRecord = predictionHistory[type].find(r => r.Phien_hien_tai === latestPhien.toString());
            if (lastRecord && !lastRecord.ket_qua_du_doan) {
                const wasCorrect = lastRecord.Du_doan === data[0].Ket_qua;
                lastRecord.ket_qua_du_doan = wasCorrect ? 'Đúng ✅' : 'Sai ❌';
                predictors[type].update(data[0].Ket_qua, lastRecord.Du_doan, wasCorrect);
                
                console.log(`\n📊 ${type.toUpperCase()} | Phiên ${latestPhien}:`);
                console.log(`   Dự đoán: ${lastRecord.Du_doan} → Thực tế: ${data[0].Ket_qua} → ${wasCorrect ? 'ĐÚNG ✅' : 'SAI ❌'}`);
                console.log(`   Accuracy: ${(predictors[type].stats.accuracy * 100).toFixed(1)}% (${predictors[type].stats.correct}/${predictors[type].stats.total})`);
                console.log(`   Win streak: ${predictors[type].stats.winStreak} | Best: ${predictors[type].stats.bestStreak}`);
                
                saveHistory();
            }
            
            // Make new prediction
            if (lastProcessedPhien[type] !== nextPhien) {
                const result = predictors[type].predict(data);
                
                const record = {
                    Phien: data[0].Phien,
                    Tong: data[0].Tong,
                    Ket_qua: data[0].Ket_qua,
                    Xuc_xac: `${data[0].Xuc_xac_1},${data[0].Xuc_xac_2},${data[0].Xuc_xac_3}`,
                    Phien_hien_tai: nextPhien,
                    Du_doan: result.prediction,
                    Do_tin_cay: `${result.confidence}%`,
                    Xac_suat: `${(result.probability * 100).toFixed(1)}%`,
                    timestamp: new Date().toISOString(),
                    id: '@tiendataox'
                };
                
                predictionHistory[type].unshift(record);
                if (predictionHistory[type].length > 500) predictionHistory[type].pop();
                
                lastProcessedPhien[type] = nextPhien;
                
                console.log(`\n🎯 ${type.toUpperCase()} | Dự đoán phiên ${nextPhien}:`);
                console.log(`   Kết quả: ${result.prediction} | Độ tin cậy: ${result.confidence}%`);
                console.log(`   Xác suất: ${(result.probability * 100).toFixed(1)}%`);
                
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
        name: 'REAL TAI XIU PREDICTOR',
        version: '5.0 - Professional',
        author: '@tiendataox',
        description: 'Hệ thống dự đoán dựa trên phân tích pattern thực tế',
        accuracy_hu: `${(predictors.hu.stats.accuracy * 100).toFixed(1)}%`,
        accuracy_md5: `${(predictors.md5.stats.accuracy * 100).toFixed(1)}%`,
        total_predictions: predictors.hu.stats.total + predictors.md5.stats.total
    });
});

app.get('/lc79-hu', async (req, res) => {
    try {
        const data = await fetchDataHu();
        if (!data?.length) {
            return res.status(500).json({ error: 'Cannot fetch data', message: 'Vui lòng thử lại sau' });
        }
        
        const result = predictors.hu.predict(data);
        const nextPhien = data[0].Phien + 1;
        
        const response = {
            success: true,
            phien_hien_tai: nextPhien,
            du_doan: result.prediction,
            do_tin_cay: `${result.confidence}%`,
            xac_suat_tai: `${((result.prediction === 'Tài' ? result.probability : 1 - result.probability) * 100).toFixed(1)}%`,
            xac_suat_xiu: `${((result.prediction === 'Xỉu' ? result.probability : 1 - result.probability) * 100).toFixed(1)}%`,
            phan_tich: {
                pattern: `${(result.details.pattern.score * 100).toFixed(0)}% nghiêng về ${result.details.pattern.score > 0.5 ? 'Tài' : 'Xỉu'}`,
                xu_huong: `${(result.details.trend.score * 100).toFixed(0)}% nghiêng về ${result.details.trend.score > 0.5 ? 'Tài' : 'Xỉu'}`,
                dao_chieu: result.details.reversal.signal !== 0 ? `Có tín hiệu đảo chiều` : 'Không có tín hiệu đảo chiều',
                lich_su: result.details.history.sampleSize ? `Dựa trên ${result.details.history.sampleSize} mẫu tương tự` : 'Chưa đủ dữ liệu lịch sử'
            },
            thong_ke: {
                accuracy: `${(predictors.hu.stats.accuracy * 100).toFixed(1)}%`,
                win_streak: predictors.hu.stats.winStreak,
                total: predictors.hu.stats.total
            },
            timestamp: new Date().toISOString(),
            id: '@tiendataox'
        };
        
        // Lưu dự đoán
        const record = {
            Phien: data[0].Phien,
            Tong: data[0].Tong,
            Ket_qua: data[0].Ket_qua,
            Phien_hien_tai: nextPhien,
            Du_doan: result.prediction,
            Do_tin_cay: `${result.confidence}%`,
            timestamp: new Date().toISOString(),
            id: '@tiendataox'
        };
        predictionHistory.hu.unshift(record);
        if (predictionHistory.hu.length > 500) predictionHistory.hu.pop();
        saveHistory();
        
        res.json(response);
    } catch (error) {
        console.error('API error:', error);
        res.status(500).json({ error: 'Server error', message: error.message });
    }
});

app.get('/lc79-md5', async (req, res) => {
    try {
        const data = await fetchDataMd5();
        if (!data?.length) {
            return res.status(500).json({ error: 'Cannot fetch data', message: 'Vui lòng thử lại sau' });
        }
        
        const result = predictors.md5.predict(data);
        const nextPhien = data[0].Phien + 1;
        
        const response = {
            success: true,
            phien_hien_tai: nextPhien,
            du_doan: result.prediction,
            do_tin_cay: `${result.confidence}%`,
            xac_suat_tai: `${((result.prediction === 'Tài' ? result.probability : 1 - result.probability) * 100).toFixed(1)}%`,
            xac_suat_xiu: `${((result.prediction === 'Xỉu' ? result.probability : 1 - result.probability) * 100).toFixed(1)}%`,
            phan_tich: {
                pattern: `${(result.details.pattern.score * 100).toFixed(0)}% nghiêng về ${result.details.pattern.score > 0.5 ? 'Tài' : 'Xỉu'}`,
                xu_huong: `${(result.details.trend.score * 100).toFixed(0)}% nghiêng về ${result.details.trend.score > 0.5 ? 'Tài' : 'Xỉu'}`,
                dao_chieu: result.details.reversal.signal !== 0 ? `Có tín hiệu đảo chiều` : 'Không có tín hiệu đảo chiều',
                lich_su: result.details.history.sampleSize ? `Dựa trên ${result.details.history.sampleSize} mẫu tương tự` : 'Chưa đủ dữ liệu lịch sử'
            },
            thong_ke: {
                accuracy: `${(predictors.md5.stats.accuracy * 100).toFixed(1)}%`,
                win_streak: predictors.md5.stats.winStreak,
                total: predictors.md5.stats.total
            },
            timestamp: new Date().toISOString(),
            id: '@tiendataox'
        };
        
        const record = {
            Phien: data[0].Phien,
            Tong: data[0].Tong,
            Ket_qua: data[0].Ket_qua,
            Phien_hien_tai: nextPhien,
            Du_doan: result.prediction,
            Do_tin_cay: `${result.confidence}%`,
            timestamp: new Date().toISOString(),
            id: '@tiendataox'
        };
        predictionHistory.md5.unshift(record);
        if (predictionHistory.md5.length > 500) predictionHistory.md5.pop();
        saveHistory();
        
        res.json(response);
    } catch (error) {
        console.error('API error:', error);
        res.status(500).json({ error: 'Server error', message: error.message });
    }
});

app.get('/lc79-hu/lichsu', (req, res) => {
    res.json({
        type: 'Lẩu Cua 79 - Tài Xỉu HŨ',
        total: predictionHistory.hu.length,
        history: predictionHistory.hu.slice(0, 50)
    });
});

app.get('/lc79-md5/lichsu', (req, res) => {
    res.json({
        type: 'Lẩu Cua 79 - Tài Xỉu MD5',
        total: predictionHistory.md5.length,
        history: predictionHistory.md5.slice(0, 50)
    });
});

app.get('/stats', (req, res) => {
    res.json({
        hu: {
            total: predictors.hu.stats.total,
            correct: predictors.hu.stats.correct,
            accuracy: `${(predictors.hu.stats.accuracy * 100).toFixed(2)}%`,
            winStreak: predictors.hu.stats.winStreak,
            bestStreak: predictors.hu.stats.bestStreak,
            lossStreak: predictors.hu.stats.lossStreak
        },
        md5: {
            total: predictors.md5.stats.total,
            correct: predictors.md5.stats.correct,
            accuracy: `${(predictors.md5.stats.accuracy * 100).toFixed(2)}%`,
            winStreak: predictors.md5.stats.winStreak,
            bestStreak: predictors.md5.stats.bestStreak,
            lossStreak: predictors.md5.stats.lossStreak
        },
        weights: {
            hu: predictors.hu.weights,
            md5: predictors.md5.weights
        }
    });
});

// ==================== START ====================
loadHistory();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n╔════════════════════════════════════════════════════════╗`);
    console.log(`║     REAL TAI XIU PREDICTOR - PROFESSIONAL v5.0      ║`);
    console.log(`║                  @tiendataox                         ║`);
    console.log(`╚════════════════════════════════════════════════════════╝\n`);
    
    console.log(`📡 Server: http://0.0.0.0:${PORT}`);
    console.log(`\n🧠 PHƯƠNG PHÁP PHÂN TÍCH:`);
    console.log(`   ├─ 1. Pattern Recognition (cầu bệt, 1-1, 2-2, 1-2-1, 1-2-3, 3-2-1)`);
    console.log(`   ├─ 2. Trend Analysis (xu hướng tổng điểm)`);
    console.log(`   ├─ 3. Cycle Detection (chu kỳ lặp lại)`);
    console.log(`   ├─ 4. Volatility Analysis (biến động thị trường)`);
    console.log(`   ├─ 5. Reversal Signal (tín hiệu đảo chiều)`);
    console.log(`   └─ 6. Historical Learning (học từ dữ liệu quá khứ)`);
    
    console.log(`\n📊 THỐNG KÊ HIỆN TẠI:`);
    console.log(`   ├─ HU:  ${(predictors.hu.stats.accuracy * 100).toFixed(1)}% (${predictors.hu.stats.correct}/${predictors.hu.stats.total})`);
    console.log(`   └─ MD5: ${(predictors.md5.stats.accuracy * 100).toFixed(1)}% (${predictors.md5.stats.correct}/${predictors.md5.stats.total})`);
    
    console.log(`\n🔄 Auto-save: ENABLED (mỗi khi có kết quả mới)`);
    console.log(`⏰ Auto-process: Mỗi 20 giây\n`);
    
    setInterval(() => autoProcess(), 20000);
    setTimeout(() => autoProcess(), 5000);
});
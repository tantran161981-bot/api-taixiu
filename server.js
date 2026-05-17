const axios = require('axios');
const express = require('express');
const fs = require('fs');

const app = express();
const PORT = 5000;

const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const HISTORY_FILE = 'lichsu_md5.json';

class TaiXiuPredictor {
    constructor(apiUrl) {
        this.apiUrl = apiUrl;
        this.history = [];
        this.predictions = [];
        this.confidenceThreshold = 0.65;
    }

    // Lấy dữ liệu từ API
    async fetchData() {
        try {
            const response = await axios.get(this.apiUrl, { timeout: 10000 });
            
            if (response.data && response.data.list) {
                this.history = response.data.list.map(item => ({
                    phien: item.id,
                    ket_qua: item.resultTruyenThong === 'TAI' ? 'TAI' : 'XIU',
                    xuc_xac_1: item.dices[0],
                    xuc_xac_2: item.dices[1],
                    xuc_xac_3: item.dices[2],
                    tong: item.point
                }));
                
                console.log(`✅ Đã lấy ${this.history.length} phiên dữ liệu MD5`);
                return true;
            }
            return false;
        } catch (error) {
            console.error('❌ Lỗi API:', error.message);
            return false;
        }
    }

    // 1. Thuật toán Markov Chain
    markovChainPrediction() {
        if (this.history.length < 10) return 0.5;
        
        const states = this.history.map(h => h.ket_qua);
        const transitionMatrix = { TAI: { TAI: 0, XIU: 0 }, XIU: { TAI: 0, XIU: 0 } };
        
        for (let i = 0; i < states.length - 1; i++) {
            transitionMatrix[states[i]][states[i + 1]]++;
        }
        
        for (let state in transitionMatrix) {
            const total = transitionMatrix[state].TAI + transitionMatrix[state].XIU;
            if (total > 0) {
                transitionMatrix[state].TAI /= total;
                transitionMatrix[state].XIU /= total;
            }
        }
        
        const lastState = states[states.length - 1];
        return transitionMatrix[lastState].TAI;
    }

    // 2. Thuật toán dựa trên tổng xúc xắc
    sumBasedPrediction() {
        if (this.history.length < 10) return 0.5;
        
        const recentSums = this.history.slice(-15).map(h => h.tong);
        const avgSum = recentSums.reduce((a, b) => a + b, 0) / recentSums.length;
        
        const variance = recentSums.reduce((acc, sum) => acc + Math.pow(sum - avgSum, 2), 0) / recentSums.length;
        const stdDev = Math.sqrt(variance);
        
        const lastSum = this.history[this.history.length - 1].tong;
        
        if (Math.abs(lastSum - 11) < stdDev) {
            return 0.5;
        }
        
        // Xu hướng tổng
        const sumTrend = lastSum - avgSum;
        let taiProb = 0.5;
        
        if (sumTrend > 1.5) {
            taiProb = 0.35; // Tổng tăng -> Xỉu
        } else if (sumTrend < -1.5) {
            taiProb = 0.65; // Tổng giảm -> Tài
        } else {
            taiProb = lastSum > 11 ? 0.6 : 0.4;
        }
        
        return taiProb;
    }

    // 3. Thuật toán chu kỳ Pattern
    cyclePatternPrediction() {
        if (this.history.length < 20) return 0.5;
        
        const results = this.history.map(h => h.ket_qua === 'TAI' ? 1 : 0);
        let bestCycle = 0;
        let bestScore = 0;
        
        for (let cycleLen = 2; cycleLen <= 8; cycleLen++) {
            let matches = 0;
            let comparisons = 0;
            
            for (let i = cycleLen; i < results.length - cycleLen; i++) {
                if (results[i] === results[i - cycleLen]) {
                    matches++;
                }
                comparisons++;
            }
            
            const score = matches / comparisons;
            if (score > bestScore && score > 0.6) {
                bestScore = score;
                bestCycle = cycleLen;
            }
        }
        
        if (bestCycle > 0 && this.history.length >= bestCycle) {
            const lastIndex = results.length - 1;
            const predictedValue = results[lastIndex - bestCycle + 1];
            return predictedValue;
        }
        
        return 0.5;
    }

    // 4. Thuật toán phân tích Pattern đặc biệt
    patternRecognition() {
        if (this.history.length < 15) return 0.5;
        
        const results = this.history.map(h => h.ket_qua === 'TAI' ? 1 : 0);
        const recent10 = results.slice(-10);
        
        // Phát hiện cầu bệt
        let streak = 1;
        for (let i = recent10.length - 2; i >= 0; i--) {
            if (recent10[i] === recent10[recent10.length - 1]) {
                streak++;
            } else {
                break;
            }
        }
        
        if (streak >= 5) {
            // Cầu bệt dài -> bẻ cầu
            return recent10[recent10.length - 1] === 1 ? 0.3 : 0.7;
        }
        
        if (streak >= 3) {
            // Cầu bệt ngắn -> theo cầu
            return recent10[recent10.length - 1] === 1 ? 0.7 : 0.3;
        }
        
        // Phát hiện cầu đảo 1-1
        let isAlternating = true;
        for (let i = recent10.length - 3; i >= 0; i--) {
            if (recent10[i] === recent10[i + 1]) {
                isAlternating = false;
                break;
            }
        }
        
        if (isAlternating && recent10.length >= 6) {
            // Cầu đảo 1-1 dài -> bẻ
            return recent10[recent10.length - 1] === 1 ? 0.4 : 0.6;
        }
        
        return 0.5;
    }

    // 5. Thuật toán trung bình động có trọng số
    weightedMovingAverage() {
        if (this.history.length < 15) return 0.5;
        
        const results = this.history.slice(-25).map(h => h.ket_qua === 'TAI' ? 1 : 0);
        let weightedSum = 0;
        let weightSum = 0;
        
        for (let i = 0; i < results.length; i++) {
            const weight = Math.pow(0.9, results.length - 1 - i);
            weightedSum += results[i] * weight;
            weightSum += weight;
        }
        
        const wma = weightedSum / weightSum;
        const smoothed = wma * 0.75 + 0.5 * 0.25;
        
        return smoothed;
    }

    // 6. Thuật toán phân tích xúc xắc chi tiết
    diceAnalysis() {
        if (this.history.length < 10) return 0.5;
        
        const recentDice = this.history.slice(-10);
        
        let total1 = 0, total2 = 0, total3 = 0;
        let highDiceCount = 0;
        
        recentDice.forEach(h => {
            total1 += h.xuc_xac_1;
            total2 += h.xuc_xac_2;
            total3 += h.xuc_xac_3;
            if (h.xuc_xac_1 >= 4) highDiceCount++;
            if (h.xuc_xac_2 >= 4) highDiceCount++;
            if (h.xuc_xac_3 >= 4) highDiceCount++;
        });
        
        const avg1 = total1 / recentDice.length;
        const avg2 = total2 / recentDice.length;
        const avg3 = total3 / recentDice.length;
        const avgHighDice = highDiceCount / (recentDice.length * 3);
        
        // Xu hướng xúc xắc cao
        if (avgHighDice > 0.6) {
            return 0.35; // Nhiều xúc xắc cao -> Xỉu
        }
        
        if (avgHighDice < 0.4) {
            return 0.65; // Nhiều xúc xắc thấp -> Tài
        }
        
        // Dự đoán dựa trên trung bình từng xúc xắc
        const avgTotal = (avg1 + avg2 + avg3);
        if (avgTotal > 11) {
            return 0.4;
        } else if (avgTotal < 10) {
            return 0.6;
        }
        
        return 0.5;
    }

    // Tổng hợp tất cả thuật toán
    async predict(returnFull = false) {
        if (this.history.length === 0) {
            const success = await this.fetchData();
            if (!success) return null;
        }
        
        if (this.history.length < 10) {
            console.log('⚠️ Không đủ dữ liệu để dự đoán (cần ít nhất 10 phiên)');
            return null;
        }
        
        console.log(`\n📊 Đang phân tích với ${this.history.length} phiên dữ liệu MD5...`);
        
        // Chạy các thuật toán
        const predictions = {
            markov: this.markovChainPrediction(),
            sumBased: this.sumBasedPrediction(),
            cycle: this.cyclePatternPrediction(),
            pattern: this.patternRecognition(),
            wma: this.weightedMovingAverage(),
            dice: this.diceAnalysis()
        };
        
        // Trọng số tối ưu cho MD5
        const weights = {
            markov: 0.22,
            sumBased: 0.18,
            cycle: 0.15,
            pattern: 0.2,
            wma: 0.12,
            dice: 0.13
        };
        
        // Tính tổng hợp có trọng số
        let weightedScore = 0;
        let totalWeight = 0;
        
        for (const [algo, score] of Object.entries(predictions)) {
            if (score !== null && !isNaN(score)) {
                weightedScore += score * weights[algo];
                totalWeight += weights[algo];
            }
        }
        
        const finalScore = weightedScore / totalWeight;
        
        // Đánh giá độ tin cậy
        const values = Object.values(predictions).filter(v => v !== null && !isNaN(v));
        const variance = values.reduce((acc, v) => acc + Math.pow(v - finalScore, 2), 0) / values.length;
        const confidence = Math.max(0.5, Math.min(0.95, 1 - Math.sqrt(variance) * 0.8));
        
        // Quyết định cuối cùng
        const prediction = finalScore > 0.52 ? 'TAI' : (finalScore < 0.48 ? 'XIU' : (Math.random() > 0.5 ? 'TAI' : 'XIU'));
        const probability = prediction === 'TAI' ? finalScore : 1 - finalScore;
        
        // Lưu dự đoán
        const currentPhien = this.history[0].phien;
        const nextPhien = currentPhien + 1;
        
        const predictionRecord = {
            phien_hien_tai: currentPhien,
            phien_du_doan: nextPhien,
            ket_qua_hien_tai: this.history[0].ket_qua,
            tong_hien_tai: this.history[0].tong,
            du_doan: prediction,
            xac_suat: (probability * 100).toFixed(1),
            do_tin_cay: (confidence * 100).toFixed(1),
            timestamp: new Date().toISOString(),
            ket_qua_thuc_te: null,
            dung_sai: null
        };
        
        this.predictions.unshift(predictionRecord);
        if (this.predictions.length > 100) this.predictions.pop();
        
        this.saveHistory();
        
        // Log kết quả
        console.log('\n🔮 KẾT QUẢ DỰ ĐOÁN MD5:');
        console.log('═'.repeat(55));
        console.log(`📈 Dự đoán phiên ${nextPhien}: ${prediction}`);
        console.log(`📊 Xác suất: ${(probability * 100).toFixed(1)}%`);
        console.log(`🎯 Độ tin cậy: ${(confidence * 100).toFixed(1)}%`);
        
        console.log('\n📐 Chi tiết thuật toán:');
        console.log(`• Markov Chain: ${(predictions.markov * 100).toFixed(1)}% Tài`);
        console.log(`• Dựa trên tổng: ${(predictions.sumBased * 100).toFixed(1)}% Tài`);
        console.log(`• Chu kỳ Pattern: ${predictions.cycle === 1 ? 'TAI' : predictions.cycle === 0 ? 'XIU' : '50/50'}`);
        console.log(`• Pattern Recognition: ${(predictions.pattern * 100).toFixed(1)}% Tài`);
        console.log(`• WMA: ${(predictions.wma * 100).toFixed(1)}% Tài`);
        console.log(`• Dice Analysis: ${(predictions.dice * 100).toFixed(1)}% Tài`);
        
        if (confidence < this.confidenceThreshold) {
            console.log('\n⚠️ CẢNH BÁO: Độ tin cậy thấp!');
        }
        
        console.log('\n📝 Phiên hiện tại:');
        const current = this.history[0];
        console.log(`  Phiên ${current.phien}: ${current.xuc_xac_1}+${current.xuc_xac_2}+${current.xuc_xac_3}=${current.tong} (${current.ket_qua})`);
        
        if (returnFull) {
            return {
                prediction,
                probability: (probability * 100).toFixed(1),
                confidence: (confidence * 100).toFixed(1),
                nextPhien,
                currentSession: current,
                details: predictions
            };
        }
        
        return predictionRecord;
    }
    
    // Cập nhật kết quả thực tế
    async updateResults() {
        await this.fetchData();
        
        let updated = 0;
        
        for (const pred of this.predictions) {
            if (pred.ket_qua_thuc_te) continue;
            
            const actual = this.history.find(h => h.phien === pred.phien_du_doan);
            if (actual) {
                pred.ket_qua_thuc_te = actual.ket_qua;
                pred.dung_sai = pred.du_doan === actual.ket_qua;
                updated++;
            }
        }
        
        if (updated > 0) {
            this.saveHistory();
            console.log(`✅ Đã cập nhật ${updated} kết quả dự đoán`);
        }
    }
    
    // Lưu lịch sử
    saveHistory() {
        try {
            const data = {
                predictions: this.predictions,
                lastUpdated: new Date().toISOString()
            };
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Lỗi lưu lịch sử:', error.message);
        }
    }
    
    // Tải lịch sử
    loadHistory() {
        try {
            if (fs.existsSync(HISTORY_FILE)) {
                const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
                this.predictions = data.predictions || [];
                console.log(`📁 Đã tải ${this.predictions.length} dự đoán từ lịch sử`);
            }
        } catch (error) {
            console.error('Lỗi tải lịch sử:', error.message);
        }
    }
    
    // Thống kê độ chính xác
    getStats() {
        const verified = this.predictions.filter(p => p.dung_sai !== null);
        const correct = verified.filter(p => p.dung_sai === true);
        
        return {
            totalPredictions: this.predictions.length,
            verified: verified.length,
            correct: correct.length,
            accuracy: verified.length > 0 ? ((correct.length / verified.length) * 100).toFixed(1) : 'N/A',
            recentAccuracy: this.getRecentAccuracy()
        };
    }
    
    getRecentAccuracy() {
        const recent = this.predictions.filter(p => p.dung_sai !== null).slice(0, 20);
        const correct = recent.filter(p => p.dung_sai === true);
        return recent.length > 0 ? ((correct.length / recent.length) * 100).toFixed(1) : 'N/A';
    }
}

// ==================== KHỞI TẠO ====================
const predictor = new TaiXiuPredictor(API_URL_MD5);
predictor.loadHistory();

// ==================== API ENDPOINTS ====================

app.get('/', (req, res) => {
    res.json({
        name: 'Dự Đoán Tài Xỉu MD5',
        version: '2.0',
        author: '@tiendataox',
        endpoints: [
            '/predict - Dự đoán phiên tiếp theo',
            '/stats - Thống kê độ chính xác',
            '/history - Lịch sử dự đoán',
            '/update - Cập nhật kết quả'
        ]
    });
});

// Dự đoán
app.get('/predict', async (req, res) => {
    try {
        await predictor.fetchData();
        const result = await predictor.predict(true);
        
        if (!result) {
            return res.status(500).json({ error: 'Không đủ dữ liệu' });
        }
        
        res.json({
            success: true,
            nextPhien: result.nextPhien,
            prediction: result.prediction,
            probability: `${result.probability}%`,
            confidence: `${result.confidence}%`,
            currentSession: result.currentSession,
            algorithms: {
                markov: `${(result.details.markov * 100).toFixed(1)}%`,
                sumBased: `${(result.details.sumBased * 100).toFixed(1)}%`,
                pattern: `${(result.details.pattern * 100).toFixed(1)}%`,
                dice: `${(result.details.dice * 100).toFixed(1)}%`
            }
        });
    } catch (error) {
        console.error('Lỗi:', error);
        res.status(500).json({ error: 'Lỗi server: ' + error.message });
    }
});

// Thống kê
app.get('/stats', (req, res) => {
    const stats = predictor.getStats();
    res.json(stats);
});

// Lịch sử
app.get('/history', (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    res.json({
        total: predictor.predictions.length,
        predictions: predictor.predictions.slice(0, limit)
    });
});

// Cập nhật kết quả
app.get('/update', async (req, res) => {
    await predictor.updateResults();
    const stats = predictor.getStats();
    res.json({
        success: true,
        message: 'Đã cập nhật kết quả',
        stats
    });
});

// Chạy server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║     🎲 DỰ ĐOÁN TÀI XỈU MD5 - THUẬT TOÁN THÔNG MINH 🎲       ║
║                      @tiendataox                            ║
╠══════════════════════════════════════════════════════════════╣
║  📡 API Server: http://0.0.0.0:${PORT}                        ║
║  🔗 Endpoints:                                              ║
║     GET /predict  - Dự đoán phiên tiếp theo                 ║
║     GET /stats    - Thống kê độ chính xác                   ║
║     GET /history  - Lịch sử dự đoán                         ║
║     GET /update   - Cập nhật kết quả                        ║
╠══════════════════════════════════════════════════════════════╣
║  🧠 6 THUẬT TOÁN KẾT HỢP:                                   ║
║     • Markov Chain - Xác suất chuyển tiếp                   ║
║     • Phân tích tổng - Xu hướng điểm số                     ║
║     • Chu kỳ Pattern - Tìm quy luật lặp                     ║
║     • Pattern Recognition - Cầu bệt, đảo 1-1                ║
║     • WMA - Trung bình động có trọng số                     ║
║     • Dice Analysis - Phân tích chi tiết xúc xắc            ║
╚══════════════════════════════════════════════════════════════╝
    `);
});

// Tự động cập nhật mỗi 30 giây
setInterval(async () => {
    await predictor.updateResults();
}, 30000);

// Chạy thử dự đoán ban đầu
setTimeout(async () => {
    console.log('\n🔄 Đang khởi tạo dự đoán đầu tiên...');
    await predictor.predict();
}, 2000);
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ==================== THUẬT TOÁN DỰ ĐOÁN PRO ====================

class TaiXiuPredictorPro {
    constructor() {
        this.history = [];
        this.tongHistory = [];
        this.xucXacHistory = [];
        this.patternStats = {
            cauBet: { count: 0, type: null, success: 0, total: 0 },
            cauDao: { count: 0, success: 0, total: 0 },
            cau22: { count: 0, success: 0, total: 0 },
            cau33: { count: 0, success: 0, total: 0 },
            cau121: { count: 0, success: 0, total: 0 },
            cau123: { count: 0, success: 0, total: 0 },
            cau321: { count: 0, success: 0, total: 0 }
        };
        this.predictionsHistory = [];
        this.accuracy = { total: 0, correct: 0, recent: [] };
    }

    // Cập nhật dữ liệu mới
    update(data) {
        for (const item of data) {
            const result = item.resultTruyenThong === 'TAI' ? 1 : 0;
            this.history.push(result);
            this.tongHistory.push(item.point);
            this.xucXacHistory.push(item.dices);
            
            if (this.history.length > 100) {
                this.history.shift();
                this.tongHistory.shift();
                this.xucXacHistory.shift();
            }
            
            if (this.history.length >= 2) {
                this.updatePatterns(result);
            }
        }
    }

    updatePatterns(result) {
        const prev = this.history[this.history.length - 2];
        
        // Cầu bệt
        if (result === prev) {
            this.patternStats.cauBet.count++;
        } else {
            this.patternStats.cauBet.count = 0;
        }
        this.patternStats.cauBet.type = result;
        
        // Cầu đảo
        if (result !== prev) {
            this.patternStats.cauDao.count++;
        } else {
            this.patternStats.cauDao.count = 0;
        }
        
        // Cầu 2-2
        if (this.history.length >= 4) {
            const h = this.history;
            const len = h.length;
            if (h[len-4] === h[len-3] && h[len-2] === h[len-1] && h[len-4] !== h[len-2]) {
                this.patternStats.cau22.count++;
            }
        }
        
        // Cầu 3-3
        if (this.history.length >= 6) {
            const h = this.history;
            const len = h.length;
            if (h[len-6] === h[len-5] && h[len-5] === h[len-4] &&
                h[len-3] === h[len-2] && h[len-2] === h[len-1] &&
                h[len-6] !== h[len-3]) {
                this.patternStats.cau33.count++;
            }
        }
    }

    // ==================== 15 THUẬT TOÁN PHÂN TÍCH ====================

    // 1. Cầu bệt
    phanTichCauBet() {
        if (this.patternStats.cauBet.count >= 3) {
            const doDai = this.patternStats.cauBet.count + 1;
            let confidence = 65;
            let prediction = this.patternStats.cauBet.type === 1 ? 0 : 1;
            
            if (doDai >= 7) confidence = 88;
            else if (doDai >= 5) confidence = 80;
            else if (doDai >= 3) confidence = 72;
            
            return {
                detected: true,
                prediction,
                confidence,
                doDai,
                reason: `💰 Cầu bệt ${doDai} phiên ${this.patternStats.cauBet.type === 1 ? 'Tài' : 'Xỉu'} → Bẻ ${prediction === 1 ? 'Tài' : 'Xỉu'}`
            };
        }
        return { detected: false };
    }

    // 2. Cầu đảo 1-1
    phanTichCauDao() {
        if (this.patternStats.cauDao.count >= 3) {
            const doDai = this.patternStats.cauDao.count + 1;
            let confidence = 68;
            const prediction = this.history[this.history.length - 1] === 1 ? 0 : 1;
            
            if (doDai >= 6) confidence = 78;
            else if (doDai >= 4) confidence = 72;
            
            return {
                detected: true,
                prediction,
                confidence,
                doDai,
                reason: `🔄 Cầu đảo ${doDai} phiên → Tiếp tục đảo ${prediction === 1 ? 'Tài' : 'Xỉu'}`
            };
        }
        return { detected: false };
    }

    // 3. Cầu 2-2
    phanTichCau22() {
        if (this.history.length >= 4) {
            const h = this.history;
            const len = h.length;
            if (h[len-4] === h[len-3] && h[len-2] === h[len-1] && h[len-4] !== h[len-2]) {
                return {
                    detected: true,
                    prediction: h[len-2],
                    confidence: 74,
                    reason: `📊 Cầu 2-2 (${h[len-4] === 1 ? 'Tài' : 'Xỉu'}${h[len-4] === 1 ? 'Tài' : 'Xỉu'} → ${h[len-2] === 1 ? 'Tài' : 'Xỉu'}${h[len-2] === 1 ? 'Tài' : 'Xỉu'}) → Theo ${h[len-2] === 1 ? 'Tài' : 'Xỉu'}`
                };
            }
        }
        return { detected: false };
    }

    // 4. Cầu 3-3
    phanTichCau33() {
        if (this.history.length >= 6) {
            const h = this.history;
            const len = h.length;
            if (h[len-6] === h[len-5] && h[len-5] === h[len-4] &&
                h[len-3] === h[len-2] && h[len-2] === h[len-1] &&
                h[len-6] !== h[len-3]) {
                return {
                    detected: true,
                    prediction: h[len-3],
                    confidence: 78,
                    reason: `🎲 Cầu 3-3 (${h[len-6] === 1 ? 'Tài' : 'Xỉu'} x3 → ${h[len-3] === 1 ? 'Tài' : 'Xỉu'} x3) → Theo ${h[len-3] === 1 ? 'Tài' : 'Xỉu'}`
                };
            }
        }
        return { detected: false };
    }

    // 5. Cầu 1-2-1
    phanTichCau121() {
        if (this.history.length >= 5) {
            const h = this.history;
            const len = h.length;
            if (h[len-5] === h[len-3] && h[len-3] === h[len-1] &&
                h[len-4] !== h[len-5] && h[len-2] !== h[len-3]) {
                return {
                    detected: true,
                    prediction: h[len-1],
                    confidence: 76,
                    reason: `⚡ Cầu 1-2-1 (${h[len-5] === 1 ? 'Tài' : 'Xỉu'}-${h[len-4] === 1 ? 'Tài' : 'Xỉu'}-${h[len-3] === 1 ? 'Tài' : 'Xỉu'}) → Theo ${h[len-1] === 1 ? 'Tài' : 'Xỉu'}`
                };
            }
        }
        return { detected: false };
    }

    // 6. Cầu 1-2-3
    phanTichCau123() {
        if (this.history.length >= 6) {
            const h = this.history;
            const len = h.length;
            if (h[len-6] !== h[len-5] && h[len-5] !== h[len-4] && h[len-4] !== h[len-3] &&
                h[len-3] !== h[len-2] && h[len-2] !== h[len-1]) {
                return {
                    detected: true,
                    prediction: h[len-1] === 1 ? 0 : 1,
                    confidence: 70,
                    reason: `🌀 Cầu 1-2-3 (Đang đảo liên tục) → Bẻ cầu`
                };
            }
        }
        return { detected: false };
    }

    // 7. Phân tích thống kê - Bù tỷ lệ
    phanTichThongKe() {
        if (this.history.length >= 30) {
            const recent = this.history.slice(-30);
            const taiCount = recent.filter(r => r === 1).length;
            const xiuCount = 30 - taiCount;
            const chenhLech = Math.abs(taiCount - xiuCount);
            
            if (chenhLech >= 6) {
                const prediction = taiCount > xiuCount ? 0 : 1;
                const confidence = Math.min(85, 60 + chenhLech * 2);
                return {
                    detected: true,
                    prediction,
                    confidence,
                    reason: `📈 Bù tỷ lệ (Tài:${taiCount} - Xỉu:${xiuCount}, chênh ${chenhLech}) → ${prediction === 1 ? 'Tài' : 'Xỉu'}`
                };
            }
        }
        return { detected: false };
    }

    // 8. Phân tích tổng điểm
    phanTichTongDiem() {
        if (this.tongHistory.length >= 15) {
            const recent = this.tongHistory.slice(-15);
            const avg = recent.reduce((a, b) => a + b, 0) / 15;
            const lastAvg = this.tongHistory.slice(-5).reduce((a, b) => a + b, 0) / 5;
            const trend = lastAvg - avg;
            
            // Tổng cao → Tài, tổng thấp → Xỉu
            if (avg > 11) {
                let confidence = 65;
                let prediction = 1;
                if (trend > 1) confidence = 72; // Xu hướng tăng
                if (trend < -1.5) prediction = 0; // Xu hướng giảm mạnh
                return {
                    detected: true,
                    prediction,
                    confidence,
                    reason: `🎯 Tổng điểm TB cao (${avg.toFixed(1)}) → ${prediction === 1 ? 'Tài' : 'Xỉu'}`
                };
            } else if (avg < 9) {
                let confidence = 65;
                let prediction = 0;
                if (trend < -1) confidence = 72;
                if (trend > 1.5) prediction = 1;
                return {
                    detected: true,
                    prediction,
                    confidence,
                    reason: `🎯 Tổng điểm TB thấp (${avg.toFixed(1)}) → ${prediction === 1 ? 'Tài' : 'Xỉu'}`
                };
            }
        }
        return { detected: false };
    }

    // 9. Phân tích biến động
    phanTichBienDong() {
        if (this.tongHistory.length >= 10) {
            const recent = this.tongHistory.slice(-10);
            const max = Math.max(...recent);
            const min = Math.min(...recent);
            const range = max - min;
            const volatility = range / 10;
            
            if (volatility > 0.8) {
                const last = this.tongHistory[this.tongHistory.length - 1];
                const prediction = last > 11 ? 0 : (last < 9 ? 1 : null);
                if (prediction !== null) {
                    return {
                        detected: true,
                        prediction,
                        confidence: 68,
                        reason: `🌊 Biến động mạnh (range ${range}) → Đảo ${prediction === 1 ? 'Tài' : 'Xỉu'}`
                    };
                }
            }
        }
        return { detected: false };
    }

    // 10. Phân tích xu hướng
    phanTichXuHuong() {
        if (this.history.length >= 20) {
            const first10 = this.history.slice(-20, -10);
            const last10 = this.history.slice(-10);
            const taiFirst = first10.filter(r => r === 1).length;
            const taiLast = last10.filter(r => r === 1).length;
            const change = taiLast - taiFirst;
            
            if (Math.abs(change) >= 3) {
                const prediction = change > 0 ? 0 : 1;
                const confidence = 66;
                return {
                    detected: true,
                    prediction,
                    confidence,
                    reason: `📉 Xu hướng đảo chiều (${change > 0 ? 'Tài tăng' : 'Xỉu tăng'} mạnh) → ${prediction === 1 ? 'Tài' : 'Xỉu'}`
                };
            }
        }
        return { detected: false };
    }

    // 11. Phân tích xúc xắc (mặt xuất hiện nhiều)
    phanTichXucXac() {
        if (this.xucXacHistory.length >= 20) {
            const allDice = this.xucXacHistory.slice(-20).flat();
            const count = {1:0,2:0,3:0,4:0,5:0,6:0};
            for (const die of allDice) count[die]++;
            
            const maxFace = Object.keys(count).reduce((a, b) => count[a] > count[b] ? a : b);
            const minFace = Object.keys(count).reduce((a, b) => count[a] < count[b] ? a : b);
            
            // Mặt cao (4,5,6) thường ra Tài
            const highFaces = [4,5,6];
            if (highFaces.includes(parseInt(maxFace))) {
                return {
                    detected: true,
                    prediction: 1,
                    confidence: 64,
                    reason: `🎲 Xúc xắc ${maxFace} xuất hiện nhiều nhất → Tài`
                };
            } else if (parseInt(maxFace) <= 3) {
                return {
                    detected: true,
                    prediction: 0,
                    confidence: 64,
                    reason: `🎲 Xúc xắc ${maxFace} xuất hiện nhiều nhất → Xỉu`
                };
            }
        }
        return { detected: false };
    }

    // 12. Phân tích Fibonacci
    phanTichFibonacci() {
        if (this.tongHistory.length >= 20) {
            const recent = this.tongHistory.slice(-20);
            const max = Math.max(...recent);
            const min = Math.min(...recent);
            const range = max - min;
            const fib382 = min + range * 0.382;
            const fib618 = min + range * 0.618;
            const last = this.tongHistory[this.tongHistory.length - 1];
            
            if (Math.abs(last - fib382) < 1.5 || Math.abs(last - fib618) < 1.5) {
                const prediction = last > 11 ? 0 : 1;
                return {
                    detected: true,
                    prediction,
                    confidence: 72,
                    reason: `📐 Chạm ngưỡng Fibonacci (${last.toFixed(0)} điểm) → Đảo ${prediction === 1 ? 'Tài' : 'Xỉu'}`
                };
            }
        }
        return { detected: false };
    }

    // 13. Phân tích chu kỳ
    phanTichChuKy() {
        if (this.history.length >= 15) {
            // Tìm chu kỳ lặp lại
            for (let cycle = 3; cycle <= 7; cycle++) {
                let match = true;
                for (let i = 0; i < cycle && i < this.history.length - cycle; i++) {
                    if (this.history[this.history.length - 1 - i] !== 
                        this.history[this.history.length - 1 - cycle - i]) {
                        match = false;
                        break;
                    }
                }
                if (match) {
                    const prediction = this.history[this.history.length - 1 - cycle];
                    return {
                        detected: true,
                        prediction,
                        confidence: 70,
                        reason: `🔄 Chu kỳ ${cycle} phiên lặp lại → Theo ${prediction === 1 ? 'Tài' : 'Xỉu'}`
                    };
                }
            }
        }
        return { detected: false };
    }

    // 14. Phân tích đuôi cầu
    phanTichDuoiCau() {
        if (this.history.length >= 8) {
            const pattern = this.history.slice(-4);
            const isAlternating = pattern[0] !== pattern[1] && pattern[1] !== pattern[2] && pattern[2] !== pattern[3];
            
            if (isAlternating) {
                const prediction = pattern[3] === 1 ? 0 : 1;
                return {
                    detected: true,
                    prediction,
                    confidence: 73,
                    reason: `🔀 Đuôi cầu đảo (${pattern.map(p => p === 1 ? 'T' : 'X').join('-')}) → ${prediction === 1 ? 'Tài' : 'Xỉu'}`
                };
            }
        }
        return { detected: false };
    }

    // 15. Thuật toán tổng hợp - Lấy đa số
    phanTichDaSo() {
        if (this.history.length >= 10) {
            const recent = this.history.slice(-10);
            const taiCount = recent.filter(r => r === 1).length;
            
            if (taiCount >= 6) {
                return {
                    detected: true,
                    prediction: 0,
                    confidence: 65,
                    reason: `👥 Đa số (${taiCount}/10 Tài) → Bẻ Xỉu`
                };
            } else if (taiCount <= 4) {
                return {
                    detected: true,
                    prediction: 1,
                    confidence: 65,
                    reason: `👥 Đa số (${10-taiCount}/10 Xỉu) → Bẻ Tài`
                };
            }
        }
        return { detected: false };
    }

    // ==================== DỰ ĐOÁN TỔNG HỢP ====================
    
    predict() {
        const algorithms = [
            this.phanTichCauBet.bind(this),
            this.phanTichCauDao.bind(this),
            this.phanTichCau22.bind(this),
            this.phanTichCau33.bind(this),
            this.phanTichCau121.bind(this),
            this.phanTichCau123.bind(this),
            this.phanTichThongKe.bind(this),
            this.phanTichTongDiem.bind(this),
            this.phanTichBienDong.bind(this),
            this.phanTichXuHuong.bind(this),
            this.phanTichXucXac.bind(this),
            this.phanTichFibonacci.bind(this),
            this.phanTichChuKy.bind(this),
            this.phanTichDuoiCau.bind(this),
            this.phanTichDaSo.bind(this)
        ];
        
        const results = [];
        
        for (const algo of algorithms) {
            const result = algo();
            if (result.detected) {
                results.push(result);
            }
        }
        
        // Nếu không có thuật toán nào phát hiện
        if (results.length === 0 && this.history.length > 0) {
            results.push({
                prediction: this.history[this.history.length - 1],
                confidence: 55,
                reason: "📌 Theo cầu tự nhiên"
            });
        }
        
        // Tính điểm
        let taiScore = 0, xiuScore = 0;
        let taiWeight = 0, xiuWeight = 0;
        
        for (const res of results) {
            if (res.prediction === 1) {
                taiScore += res.confidence;
                taiWeight++;
            } else {
                xiuScore += res.confidence;
                xiuWeight++;
            }
        }
        
        const totalWeight = taiWeight + xiuWeight;
        let finalPrediction = taiScore >= xiuScore ? 1 : 0;
        let avgConfidence = (taiScore + xiuScore) / totalWeight;
        
        // Điều chỉnh độ tin cậy theo số lượng thuật toán đồng thuận
        const consensus = finalPrediction === 1 ? taiWeight : xiuWeight;
        const consensusBonus = Math.min(10, consensus * 1.5);
        avgConfidence = Math.min(92, avgConfidence + consensusBonus);
        
        // Lấy top 5 lý do quan trọng nhất
        const topReasons = results
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, 5)
            .map(r => r.reason);
        
        return {
            prediction: finalPrediction,
            predictionText: finalPrediction === 1 ? "Tài" : "Xỉu",
            confidence: Math.round(avgConfidence),
            reasons: topReasons,
            algorithmsUsed: results.length,
            consensus: `${consensus}/${totalWeight} thuật toán đồng thuận`
        };
    }

    // Cập nhật độ chính xác
    updateAccuracy(predicted, actual) {
        const correct = predicted === actual ? 1 : 0;
        this.accuracy.total++;
        this.accuracy.correct += correct;
        this.accuracy.recent.push(correct);
        
        if (this.accuracy.recent.length > 20) {
            this.accuracy.recent.shift();
        }
        
        // Lưu lại dự đoán để phân tích
        this.predictionsHistory.push({
            predicted,
            actual,
            correct,
            timestamp: new Date().toISOString()
        });
        
        if (this.predictionsHistory.length > 100) {
            this.predictionsHistory.shift();
        }
    }

    getAccuracy() {
        const recentAcc = this.accuracy.recent.length > 0 ?
            (this.accuracy.recent.reduce((a, b) => a + b, 0) / this.accuracy.recent.length * 100).toFixed(1) : 0;
        
        const overall = this.accuracy.total > 0 ?
            (this.accuracy.correct / this.accuracy.total * 100).toFixed(1) : 0;
        
        return {
            overall: parseFloat(overall),
            recent: parseFloat(recentAcc),
            total: this.accuracy.total,
            correct: this.accuracy.correct
        };
    }
}

// ==================== KHỞI TẠO PREDICTOR ====================

const predictor = new TaiXiuPredictorPro();
let lastFetchedPhien = null;

// Hàm fetch dữ liệu từ API
async function fetchTaiXiuData(type = 'md5') {
    const url = type === 'md5' 
        ? 'https://wtxmd52.tele68.com/v1/txmd5/sessions'
        : 'https://wtx.tele68.com/v1/tx/sessions';
    
    try {
        const response = await axios.get(url, {
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        
        return response.data.list || [];
    } catch (error) {
        console.error('Lỗi fetch data:', error.message);
        return null;
    }
}

// Cập nhật dữ liệu mới nhất
async function updateData() {
    const data = await fetchTaiXiuData('md5');
    if (data && data.length > 0) {
        const latestPhien = data[0].id;
        if (lastFetchedPhien !== latestPhien) {
            predictor.update(data);
            lastFetchedPhien = latestPhien;
            console.log(`✅ Đã cập nhật ${data.length} phiên, mới nhất: ${latestPhien}`);
        }
    }
}

// ==================== API ENDPOINTS ====================

// Root
app.get('/', (req, res) => {
    res.json({
        name: 'Tài Xỉu Predictor Pro',
        version: '3.0',
        author: '@tiendataox',
        status: 'online'
    });
});

// Dự đoán
app.get('/predict', async (req, res) => {
    try {
        await updateData();
        const result = predictor.predict();
        
        res.json({
            success: true,
            prediction: result.predictionText,
            confidence: `${result.confidence}%`,
            reasons: result.reasons,
            analysis: {
                algorithmsUsed: result.algorithmsUsed,
                consensus: result.consensus
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Dự đoán chi tiết
app.get('/predict/detail', async (req, res) => {
    try {
        await updateData();
        const result = predictor.predict();
        
        res.json({
            success: true,
            prediction: result.predictionText,
            confidence: `${result.confidence}%`,
            reasons: result.reasons,
            detailedAnalysis: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Thống kê độ chính xác
app.get('/stats', (req, res) => {
    const accuracy = predictor.getAccuracy();
    res.json({
        success: true,
        accuracy: accuracy,
        historyLength: predictor.history.length,
        predictionsCount: predictor.predictionsHistory.length
    });
});

// Cập nhật kết quả thực tế (để cải thiện độ chính xác)
app.post('/feedback', (req, res) => {
    const { predicted, actual } = req.body;
    
    if (!predicted || !actual) {
        return res.status(400).json({ success: false, error: 'Thiếu predicted hoặc actual' });
    }
    
    const predValue = predicted === 'Tài' ? 1 : 0;
    const actualValue = actual === 'Tài' ? 1 : 0;
    
    predictor.updateAccuracy(predValue, actualValue);
    
    res.json({
        success: true,
        message: 'Đã cập nhật phản hồi',
        accuracy: predictor.getAccuracy()
    });
});

// Lấy lịch sử
app.get('/history', (req, res) => {
    res.json({
        success: true,
        history: predictor.history.slice(-30),
        predictions: predictor.predictionsHistory.slice(-20)
    });
});

// Force update dữ liệu
app.post('/refresh', async (req, res) => {
    try {
        await updateData();
        res.json({ success: true, message: 'Đã refresh dữ liệu' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== CHẠY SERVER ====================

app.listen(PORT, '0.0.0.0', async () => {
    console.log(`
╔══════════════════════════════════════════════════════╗
║     🎲 TÀI XỈU PREDICTOR PRO v3.0 🎲                ║
║     Chạy trên cổng: ${PORT}                          ║
║     Author: @tiendataox                             ║
╚══════════════════════════════════════════════════════╝
    `);
    
    // Khởi tạo dữ liệu ban đầu
    await updateData();
    console.log(`📊 Đã load ${predictor.history.length} phiên lịch sử`);
    
    // Tự động cập nhật mỗi 30 giây
    setInterval(async () => {
        await updateData();
    }, 30000);
});
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Cấu hình API lấy kết quả
const API_RESULT_URL = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';

// Lưu trữ lịch sử
let resultHistory = [];
let lastProcessedId = null;

// Stats cho độ tin cậy
let predictionStats = { total: 0, correct: 0 };

// ==================== THUẬT TOÁN DỰ ĐOÁN ====================

class TaiXiuPredictor {
    // Phân tích chuỗi kết quả để tìm cầu
    analyzeSequence(results) {
        if (results.length < 5) return null;
        
        const analysis = {
            patterns: [],
            confidence: 0,
            prediction: null
        };
        
        // 1. Phát hiện cầu bệt (dây)
        let streak = 1;
        const lastResult = results[0];
        for (let i = 1; i < results.length; i++) {
            if (results[i] === lastResult) streak++;
            else break;
        }
        
        if (streak >= 3) {
            analysis.patterns.push({
                type: 'Bệt',
                length: streak,
                strength: Math.min(0.9, 0.5 + streak * 0.08),
                prediction: this.getBreakPrediction(lastResult, streak)
            });
        }
        
        // 2. Phát hiện cầu 1-1 (xen kẽ)
        let isAlternating = true;
        for (let i = 1; i < 5 && i < results.length; i++) {
            if (results[i] === results[i-1]) {
                isAlternating = false;
                break;
            }
        }
        if (isAlternating && results.length >= 4) {
            analysis.patterns.push({
                type: '1-1',
                length: 4,
                strength: 0.7,
                prediction: lastResult === 'Tài' ? 'Xỉu' : 'Tài'
            });
        }
        
        // 3. Phát hiện cầu 2-2
        if (results.length >= 4 && 
            results[0] === results[1] && 
            results[2] === results[3] && 
            results[0] !== results[2]) {
            analysis.patterns.push({
                type: '2-2',
                length: 4,
                strength: 0.75,
                prediction: results[2]
            });
        }
        
        // 4. Phân tích xu hướng dài hạn (10 phiên)
        if (results.length >= 10) {
            const taiCount = results.slice(0, 10).filter(r => r === 'Tài').length;
            const xiuCount = 10 - taiCount;
            
            if (taiCount >= 7) {
                analysis.patterns.push({
                    type: 'Xu hướng Tài',
                    length: 10,
                    strength: 0.6 + (taiCount - 6) * 0.1,
                    prediction: 'Xỉu' // Dự đoán đảo chiều
                });
            } else if (xiuCount >= 7) {
                analysis.patterns.push({
                    type: 'Xu hướng Xỉu',
                    length: 10,
                    strength: 0.6 + (xiuCount - 6) * 0.1,
                    prediction: 'Tài' // Dự đoán đảo chiều
                });
            }
        }
        
        // 5. Phân tích tổng điểm (xu hướng tăng/giảm từ dữ liệu thực tế)
        // Lưu ý: Phần này cần dữ liệu điểm, nếu không có sẽ bỏ qua.
        
        return analysis;
    }
    
    // Dự đoán bẻ cầu dựa trên độ dài bệt
    getBreakPrediction(currentResult, streakLength) {
        if (streakLength >= 6) {
            // Bệt quá dài, khả năng bẻ rất cao
            return currentResult === 'Tài' ? 'Xỉu' : 'Tài';
        } else if (streakLength >= 4) {
            // Bệt trung bình, có thể bẻ
            return currentResult === 'Tài' ? 'Xỉu' : 'Tài';
        } else {
            // Bệt ngắn, tiếp tục theo
            return currentResult;
        }
    }
    
    // Tính điểm tin cậy tổng hợp
    calculateConfidence(patterns) {
        if (!patterns || patterns.length === 0) return 50;
        
        let totalStrength = 0;
        let consistentPredictions = {};
        
        for (const pattern of patterns) {
            totalStrength += pattern.strength;
            consistentPredictions[pattern.prediction] = 
                (consistentPredictions[pattern.prediction] || 0) + pattern.strength;
        }
        
        // Tìm dự đoán có tổng strength cao nhất
        let bestPrediction = null;
        let bestStrength = 0;
        for (const [pred, strength] of Object.entries(consistentPredictions)) {
            if (strength > bestStrength) {
                bestStrength = strength;
                bestPrediction = pred;
            }
        }
        
        // Độ tin cậy = (độ mạnh của dự đoán tốt nhất) / (tổng độ mạnh) * 100
        const confidence = (bestStrength / totalStrength) * 100;
        return Math.min(95, Math.max(55, Math.round(confidence)));
    }
    
    // Dự đoán chính
    predict(history) {
        if (history.length < 10) {
            return { 
                prediction: "Đang thu thập dữ liệu...", 
                confidence: 0,
                patterns: []
            };
        }
        
        const resultsOnly = history.map(h => h.result);
        const analysis = this.analyzeSequence(resultsOnly);
        
        if (!analysis || analysis.patterns.length === 0) {
            // Fallback: Dự đoán theo xu hướng 3 phiên gần nhất
            const last3 = resultsOnly.slice(0, 3);
            const taiCount = last3.filter(r => r === 'Tài').length;
            const fallbackPrediction = taiCount >= 2 ? 'Tài' : 'Xỉu';
            return {
                prediction: fallbackPrediction,
                confidence: 55,
                patterns: [{ type: 'Xu hướng 3 phiên', strength: 0.55, prediction: fallbackPrediction }]
            };
        }
        
        // Tìm dự đoán cuối cùng
        let finalPrediction = null;
        let predictionVotes = {};
        for (const pattern of analysis.patterns) {
            predictionVotes[pattern.prediction] = (predictionVotes[pattern.prediction] || 0) + pattern.strength;
        }
        
        let maxVote = 0;
        for (const [pred, vote] of Object.entries(predictionVotes)) {
            if (vote > maxVote) {
                maxVote = vote;
                finalPrediction = pred;
            }
        }
        
        const confidence = this.calculateConfidence(analysis.patterns);
        
        return {
            prediction: finalPrediction,
            confidence: confidence,
            patterns: analysis.patterns
        };
    }
    
    // Cập nhật thống kê độ chính xác
    updateStats(actual, predicted) {
        predictionStats.total++;
        if (actual === predicted) {
            predictionStats.correct++;
        }
    }
    
    getAccuracy() {
        if (predictionStats.total === 0) return 0;
        return (predictionStats.correct / predictionStats.total * 100).toFixed(1);
    }
}

const predictor = new TaiXiuPredictor();

// ==================== LẤY DỮ LIỆU & CẬP NHẬT ====================

async function fetchLC79Results() {
    try {
        const response = await axios.get(API_RESULT_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json',
                'Referer': 'https://lc79b.bet/'
            },
            timeout: 10000
        });
        
        if (response.data && response.data.list) {
            const newHistory = response.data.list.map(item => ({
                id: item.id,
                result: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
                dice: item.dices,
                point: item.point
            }));
            
            // Kiểm tra phiên mới
            if (newHistory.length > 0 && newHistory[0].id !== lastProcessedId) {
                if (lastProcessedId !== null && resultHistory.length > 0) {
                    const actualResult = newHistory[0].result;
                    const lastPrediction = predictor.predict(resultHistory.slice(0, 20));
                    predictor.updateStats(actualResult, lastPrediction.prediction);
                    console.log(`📊 Phiên ${newHistory[0].id}: ${actualResult} | Dự đoán: ${lastPrediction.prediction} | ${lastPrediction.prediction === actualResult ? '✅' : '❌'}`);
                }
                
                resultHistory = newHistory;
                lastProcessedId = newHistory[0].id;
                console.log(`📥 Đã cập nhật ${resultHistory.length} phiên.`);
            }
            return true;
        }
    } catch (error) {
        console.error('[❌] Lỗi fetch:', error.message);
    }
    return false;
}

// ==================== API ENDPOINTS ====================

app.get('/', (req, res) => {
    res.json({
        name: 'LC79 Tài Xỉu Predictor - Siêu Chính Xác',
        version: '1.0',
        author: '@cskh_huydaixu',
        method: 'Phân tích cầu bệt, 1-1, 2-2, xu hướng',
        endpoints: ['/predict', '/stats', '/history']
    });
});

app.get('/predict', async (req, res) => {
    await fetchLC79Results();
    
    if (resultHistory.length < 10) {
        return res.json({
            error: 'Đang phân tích dữ liệu...',
            can_them: `${10 - resultHistory.length} phiên nữa`,
            status: 'learning'
        });
    }
    
    const prediction = predictor.predict(resultHistory);
    const latest = resultHistory[0];
    
    res.json({
        phien_truoc: latest.id,
        xuc_xac: latest.dice,
        ket_qua_truoc: latest.result,
        tong_diem: latest.point,
        phien_hien_tai: latest.id + 1,
        du_doan: prediction.prediction,
        do_tin_cay: `${prediction.confidence}%`,
        phan_tich: prediction.patterns.map(p => `${p.type} (độ mạnh: ${(p.strength*100).toFixed(0)}%)`),
        id: '@cskh_huydaixu'
    });
});

app.get('/stats', (req, res) => {
    res.json({
        tong_du_doan: predictionStats.total,
        du_doan_dung: predictionStats.correct,
        du_doan_sai: predictionStats.total - predictionStats.correct,
        ty_le_chinh_xac: `${predictor.getAccuracy()}%`
    });
});

app.get('/history', (req, res) => {
    res.json({
        total: resultHistory.length,
        data: resultHistory.slice(0, 30)
    });
});

// ==================== KHỞI ĐỘNG SERVER ====================

async function init() {
    console.log('\n========================================');
    console.log('  LC79 TÀI XỈU PREDICTOR - SIÊU CHÍNH XÁC');
    console.log('  Phân tích cầu bệt, 1-1, 2-2, xu hướng');
    console.log('  Tác giả: @cskh_huydaixu');
    console.log('========================================\n');
    
    await fetchLC79Results();
    
    setInterval(async () => {
        await fetchLC79Results();
    }, 5000);
    
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
        console.log(`🎯 Dự đoán: http://localhost:${PORT}/predict`);
        console.log(`📊 Thống kê: http://localhost:${PORT}/stats`);
    });
}

init();
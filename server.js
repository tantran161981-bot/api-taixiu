const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// ==================== CẤU HÌNH ====================
const CONFIG = {
    API_URL: 'https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=3959701241b686f12e01bfe9c3a319b8',
    REFRESH_INTERVAL: 2000,
    HISTORY_LIMIT: 100,
    MIN_DATA: 10
};

// ==================== CACHE DỮ LIỆU ====================
class DataCache {
    constructor() {
        this.history = [];
        this.predictions = [];
        this.lastUpdate = 0;
        this.stats = { total: 0, correct: 0, accuracy: 0 };
        this.lock = false;
    }

    update(history) {
        this.history = history.slice(0, CONFIG.HISTORY_LIMIT);
        this.lastUpdate = Date.now();
        this.updateStats();
    }

    updateStats() {
        if (this.predictions.length > 1 && this.history.length > 1) {
            let correct = 0;
            let total = 0;
            const limit = Math.min(this.predictions.length, this.history.length);
            for (let i = 0; i < limit; i++) {
                if (i < this.predictions.length && i < this.history.length) {
                    if (this.predictions[i]?.prediction === this.history[i]?.result) {
                        correct++;
                    }
                    total++;
                }
            }
            if (total > 0) {
                this.stats.total = total;
                this.stats.correct = correct;
                this.stats.accuracy = Math.round((correct / total) * 100 * 100) / 100;
            }
        }
    }

    addPrediction(prediction) {
        this.predictions.unshift(prediction);
        if (this.predictions.length > 100) {
            this.predictions = this.predictions.slice(0, 100);
        }
        this.updateStats();
    }
}

const cache = new DataCache();

// ==================== THUẬT TOÁN DỰ ĐOÁN ====================
class SuperPredictor {
    static predict(history) {
        if (!history || history.length < CONFIG.MIN_DATA) {
            return {
                prediction: -1,
                confidence: 0,
                logic: `CHỜ ĐỦ ${CONFIG.MIN_DATA} PHIÊN`,
                details: { need: CONFIG.MIN_DATA - history.length }
            };
        }

        const recent = history.slice(0, 15);
        const allData = history.slice(0, 50);
        const lastVal = recent[0];

        // ===== PHÂN TÍCH CƠ BẢN =====
        let streak = 0;
        for (let i = 0; i < recent.length; i++) {
            if (recent[i] === lastVal) streak++;
            else break;
        }

        let reverses = 0;
        for (let i = 1; i < recent.length; i++) {
            if (recent[i] !== recent[i-1]) reverses++;
        }
        const reverseRate = reverses / (recent.length - 1);

        const totalTai = allData.filter(x => x === 1).length;
        const totalXiu = allData.length - totalTai;
        const taiRatio = totalTai / allData.length;

        // ===== CÁC CHIẾN LƯỢC =====
        const strategies = [];

        // Strategy 1: Bẻ cầu
        if (streak >= 4 && reverseRate > 0.35) {
            strategies.push({
                prediction: lastVal === 1 ? 0 : 1,
                confidence: Math.min(85 + streak * 2, 98),
                logic: `BẺ CẦU (DÂY ${streak})`
            });
        }

        // Strategy 2: Theo xu hướng
        if (streak < 3 && reverseRate < 0.3) {
            strategies.push({
                prediction: lastVal,
                confidence: Math.min(80 + (1 - reverseRate) * 20, 95),
                logic: 'THEO XU HƯỚNG'
            });
        }

        // Strategy 3: Chu kỳ 2-2
        if (recent.length >= 6) {
            let pattern22 = true;
            for (let i = 0; i < 6; i += 2) {
                if (recent[i] !== recent[i+1]) pattern22 = false;
            }
            if (pattern22) {
                strategies.push({
                    prediction: recent[0] === 1 ? 0 : 1,
                    confidence: 90,
                    logic: 'CHU KỲ 2-2'
                });
            }
        }

        // Strategy 4: Chu kỳ 3-3
        if (recent.length >= 6) {
            const first3 = recent.slice(0, 3);
            const next3 = recent.slice(3, 6);
            if (first3[0] === first3[1] && first3[1] === first3[2] &&
                next3[0] === next3[1] && next3[2] === next3[0] &&
                first3[0] !== next3[0]) {
                strategies.push({
                    prediction: next3[0],
                    confidence: 92,
                    logic: 'CHU KỲ 3-3'
                });
            }
        }

        // Strategy 5: Markov Chain
        if (history.length >= 15) {
            const transitions = {};
            for (let i = 0; i < history.length - 3; i++) {
                const state = `${history[i]}${history[i+1]}${history[i+2]}`;
                const next = history[i+3];
                if (!transitions[state]) transitions[state] = {0: 0, 1: 0};
                transitions[state][next]++;
            }
            const currentState = `${history[0]}${history[1]}${history[2]}`;
            if (transitions[currentState]) {
                const t = transitions[currentState];
                if (t[1] > t[0] + 1) {
                    strategies.push({
                        prediction: 1,
                        confidence: Math.min(85 + t[1], 95),
                        logic: 'MARKOV CHAIN'
                    });
                } else if (t[0] > t[1] + 1) {
                    strategies.push({
                        prediction: 0,
                        confidence: Math.min(85 + t[0], 95),
                        logic: 'MARKOV CHAIN'
                    });
                }
            }
        }

        // Strategy 6: Phân tích Entropy
        if (history.length >= 16) {
            const segment = history.slice(0, 8);
            const ones = segment.filter(x => x === 1).length;
            const entropy = -(ones/8 * Math.log2(ones/8 + 0.001) + (8-ones)/8 * Math.log2((8-ones)/8 + 0.001));
            const bitShift = (history[0] << 3) ^ (history[1] << 2) ^ (history[2] << 1) ^ history[3];
            if (entropy > 0.9 && bitShift > 5) {
                strategies.push({
                    prediction: 1,
                    confidence: 88,
                    logic: 'ENTROPY + BITSHIFT'
                });
            } else if (entropy > 0.9 && bitShift <= 5) {
                strategies.push({
                    prediction: 0,
                    confidence: 88,
                    logic: 'ENTROPY + BITSHIFT'
                });
            }
        }

        // Strategy 7: Bẻ cầu khi Tài/Xỉu mất cân bằng
        if (Math.abs(taiRatio - 0.5) > 0.2) {
            strategies.push({
                prediction: taiRatio > 0.5 ? 0 : 1,
                confidence: Math.min(70 + Math.abs(taiRatio - 0.5) * 40, 90),
                logic: 'CÂN BẰNG LẠI'
            });
        }

        // ===== TỔNG HỢP KẾT QUẢ =====
        if (strategies.length === 0) {
            // Fallback: Đảo nhịp
            return {
                prediction: lastVal === 1 ? 0 : 1,
                confidence: 70,
                logic: 'ĐẢO NHỊP CƠ BẢN',
                details: { strategies: 0 }
            };
        }

        // Bình chọn có trọng số
        let weightedSum = 0;
        let totalWeight = 0;
        let bestStrategy = null;
        let maxConf = 0;

        for (const s of strategies) {
            const w = s.confidence / 100;
            weightedSum += s.prediction * w;
            totalWeight += w;
            if (s.confidence > maxConf) {
                maxConf = s.confidence;
                bestStrategy = s;
            }
        }

        const weightedAvg = totalWeight > 0 ? weightedSum / totalWeight : 0.5;
        const finalPred = weightedAvg >= 0.5 ? 1 : 0;
        const finalConf = Math.min(Math.round((1 - Math.abs(weightedAvg - 0.5) * 2) * 100), 98);

        return {
            prediction: finalPred,
            confidence: Math.max(finalConf, 65),
            logic: bestStrategy ? bestStrategy.logic : 'TỔNG HỢP SIÊU TRÍ TUỆ',
            details: {
                strategies_used: strategies.length,
                best_confidence: maxConf,
                weighted_avg: Math.round(weightedAvg * 100) / 100
            }
        };
    }
}

// ==================== LẤY DỮ LIỆU TỪ API ====================
async function fetchLC79Data() {
    try {
        const response = await axios.get(CONFIG.API_URL, { timeout: 5000 });
        return response.data;
    } catch (error) {
        console.error('❌ Lỗi fetch API:', error.message);
        return null;
    }
}

function parseHistory(data) {
    if (!data) return [];
    const dataList = data.list || data.data || (Array.isArray(data) ? data : []);
    if (!dataList || dataList.length === 0) return [];

    const history = [];
    for (const item of dataList.slice(0, CONFIG.HISTORY_LIMIT)) {
        const dice1 = item.dice1 || 0;
        const dice2 = item.dice2 || 0;
        const dice3 = item.dice3 || 0;
        
        let result;
        if (item.resultTruyenThong) {
            result = item.resultTruyenThong === 'TAI' ? 1 : 0;
        } else {
            const total = dice1 + dice2 + dice3;
            result = total > 10 ? 1 : 0;
        }

        history.push({
            id: item.id,
            dice: [dice1, dice2, dice3],
            total: dice1 + dice2 + dice3,
            result: result,
            result_text: result === 1 ? 'TÀI' : 'XỈU',
            time: item.time || ''
        });
    }
    return history;
}

async function updateCache() {
    try {
        const data = await fetchLC79Data();
        if (data) {
            const history = parseHistory(data);
            if (history && history.length > 0) {
                cache.update(history);
                console.log(`✅ Cập nhật cache: ${history.length} phiên`);

                // Dự đoán nếu đủ dữ liệu
                if (history.length >= CONFIG.MIN_DATA) {
                    const resultHistory = history.slice(0, 20).map(h => h.result);
                    const prediction = SuperPredictor.predict(resultHistory);
                    cache.addPrediction(prediction);
                }
                return true;
            }
        }
        return false;
    } catch (error) {
        console.error('❌ Lỗi update cache:', error);
        return false;
    }
}

// ==================== BACKGROUND UPDATER ====================
async function backgroundUpdater() {
    while (true) {
        try {
            await updateCache();
        } catch (error) {
            console.error('❌ Lỗi background updater:', error);
        }
        await new Promise(resolve => setTimeout(resolve, CONFIG.REFRESH_INTERVAL));
    }
}

// ==================== API ENDPOINTS ====================

// Trang chủ
app.get('/', (req, res) => {
    res.json({
        name: 'LC79 Tài Xỉu Prediction API',
        version: '2.0',
        status: 'online',
        endpoints: {
            '/history': 'Lấy lịch sử kết quả (limit=20)',
            '/predict': 'Dự đoán kết quả tiếp theo',
            '/stats': 'Thống kê độ chính xác',
            '/status': 'Kiểm tra trạng thái API',
            '/refresh': 'Làm mới cache (POST)'
        },
        time: new Date().toISOString()
    });
});

// Lấy lịch sử
app.get('/history', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, CONFIG.HISTORY_LIMIT);
    const history = cache.history.slice(0, limit);
    
    res.json({
        success: true,
        count: history.length,
        data: history,
        time: new Date().toISOString()
    });
});

// Dự đoán
app.get('/predict', (req, res) => {
    if (!cache.predictions || cache.predictions.length === 0) {
        const history = cache.history.slice(0, 20);
        const resultHistory = history.map(h => h.result);
        
        if (resultHistory.length < CONFIG.MIN_DATA) {
            return res.json({
                success: false,
                error: `Chưa đủ dữ liệu (cần ${CONFIG.MIN_DATA} phiên)`,
                current: resultHistory.length
            });
        }
        
        const pred = SuperPredictor.predict(resultHistory);
        const predictionData = {
            prediction: pred.prediction,
            confidence: pred.confidence,
            logic: pred.logic,
            details: pred.details || {},
            time: new Date().toISOString()
        };
        cache.addPrediction(predictionData);
    }

    const prediction = cache.predictions[0];
    const currentPhien = cache.history[0]?.id || null;

    res.json({
        success: true,
        prediction: prediction.prediction,
        prediction_text: prediction.prediction === 1 ? 'TÀI' : 'XỈU',
        confidence: prediction.confidence,
        logic: prediction.logic,
        current_phien: currentPhien,
        history_count: cache.history.length,
        details: prediction.details || {},
        time: new Date().toISOString()
    });
});

// Thống kê
app.get('/stats', (req, res) => {
    res.json({
        success: true,
        stats: {
            total_predictions: cache.predictions.length,
            correct: cache.stats.correct,
            total: cache.stats.total,
            accuracy: cache.stats.accuracy,
            history_count: cache.history.length,
            last_update: cache.lastUpdate > 0 ? new Date(cache.lastUpdate).toISOString() : null
        },
        time: new Date().toISOString()
    });
});

// Trạng thái
app.get('/status', (req, res) => {
    const lastFetchAgo = cache.lastUpdate > 0 ? (Date.now() - cache.lastUpdate) / 1000 : 0;
    
    res.json({
        success: true,
        status: 'online',
        cache: {
            history_count: cache.history.length,
            predictions_count: cache.predictions.length,
            last_update: cache.lastUpdate > 0 ? new Date(cache.lastUpdate).toISOString() : null,
            last_update_ago: Math.round(lastFetchAgo * 100) / 100
        },
        time: new Date().toISOString()
    });
});

// Làm mới cache
app.post('/refresh', async (req, res) => {
    const result = await updateCache();
    res.json({
        success: result,
        message: result ? 'Cache đã được làm mới' : 'Không thể làm mới cache',
        history_count: cache.history.length,
        time: new Date().toISOString()
    });
});

// ==================== KHỞI ĐỘNG ====================
console.log(`
╔═══════════════════════════════════════════════════════════╗
║     LC79 TÀI XỈU PREDICTION API - NODE.JS                ║
║                                                           ║
║     🔄 Tự động cập nhật dữ liệu mỗi 2 giây              ║
║     📊 Thuật toán dự đoán đa tầng (7+ chiến lược)       ║
║     🚀 Deploy trên Render với Node.js                    ║
╚═══════════════════════════════════════════════════════════╝
`);

// Khởi động background updater
backgroundUpdater();
console.log('✅ Đã khởi động background updater');

// Lấy dữ liệu lần đầu
setTimeout(async () => {
    console.log('🔄 Đang fetch dữ liệu lần đầu...');
    await updateCache();
}, 1000);

// Chạy server
app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
});

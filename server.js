const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8000;
app.use(cors());
app.use(express.json());

// ==================== CẤU HÌNH ====================
const API_URL = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';

let APP_STATE = {
    history: [],
    lastPrediction: null,
    stats: { total: 0, win: 0, loss: 0 }
};

// ==================== ENGINE BÁM CẦU + BẺ CẦU XỊN ====================
class SmartTrendPredictor {
    
    // Dự đoán chính
    predict(sessionId, history) {
        if (history.length < 8) {
            const lastResult = history[history.length - 1]?.result || 'Tài';
            const isFollow = Math.random() < 0.65;
            const prediction = isFollow ? lastResult : (lastResult === 'Tài' ? 'Xỉu' : 'Tài');
            console.log(`🎲 [Khởi tạo] Bám ${prediction}`);
            return {
                phien: sessionId,
                ketqua: prediction,
                do_tin_cay: '68%'
            };
        }
        
        const analysis = this.analyze(history);
        
        // 🧠 CHIẾN THUẬT: Bám cầu khi rõ, bẻ cầu khi có tín hiệu mạnh
        let prediction, confidence;
        
        // 🎯 Ưu tiên 1: Bẻ cầu siêu cấp
        if (analysis.shouldBreak) {
            prediction = analysis.breakTarget;
            confidence = analysis.breakConfidence;
            console.log(`🪚 [BẺ CẦU] ${analysis.breakReason} -> ${prediction} (${confidence}%)`);
        }
        // 🎯 Ưu tiên 2: Bám cầu dài (dây 4+)
        else if (analysis.longStreak.active) {
            prediction = analysis.longStreak.prediction;
            confidence = analysis.longStreak.confidence;
            console.log(`📈 [CẦU DÀI] Dây ${analysis.longStreak.length} ${analysis.longStreak.type} -> ${prediction}`);
        }
        // 🎯 Ưu tiên 3: Cầu chéo 1-1
        else if (analysis.cauCheo.active) {
            prediction = analysis.cauCheo.prediction;
            confidence = analysis.cauCheo.confidence;
            console.log(`🔄 [CẦU CHÉO] Xen kẽ -> ${prediction}`);
        }
        // 🎯 Ưu tiên 4: Cầu 2-2
        else if (analysis.pair22.active) {
            prediction = analysis.pair22.prediction;
            confidence = analysis.pair22.confidence;
            console.log(`🔁 [CẦU 2-2] Cặp đôi -> ${prediction}`);
        }
        // 🎯 Ưu tiên 5: Xu hướng chính
        else if (analysis.trend.active) {
            prediction = analysis.trend.direction;
            confidence = analysis.trend.confidence;
            console.log(`📊 [XU HƯỚNG] Theo ${prediction} (độ mạnh ${analysis.trend.strength})`);
        }
        // 🎯 Mặc định: bám 3 phiên gần nhất
        else {
            prediction = analysis.defaultPrediction;
            confidence = 62;
            console.log(`⚖️ [MẶC ĐỊNH] Bám 3 phiên gần nhất -> ${prediction}`);
        }
        
        confidence = Math.min(92, Math.max(65, confidence));
        
        return {
            phien: sessionId,
            ketqua: prediction,
            do_tin_cay: confidence + '%'
        };
    }
    
    // HÀM PHÂN TÍCH TỔNG HỢP (LÕI)
    analyze(history) {
        const results = history.map(h => h.result);
        const lastResult = results[results.length - 1];
        const last2 = results.slice(-2);
        const last3 = results.slice(-3);
        const last5 = results.slice(-5);
        const last10 = results.slice(-10);
        
        // ========== 1. DÂY DÀI (STREAK) ==========
        let streakLength = 1;
        for (let i = results.length - 2; i >= 0; i--) {
            if (results[i] === lastResult) streakLength++;
            else break;
        }
        
        // ========== 2. XU HƯỚNG TỔNG THỂ ==========
        const taiCount10 = last10.filter(r => r === 'Tài').length;
        const mainTrend = taiCount10 > 5 ? 'Tài' : (taiCount10 < 5 ? 'Xỉu' : null);
        const trendStrength = Math.abs(taiCount10 - 5) / 5;
        
        // ========== 3. CẦU CHÉO 1-1 ==========
        let isCauCheo = true;
        for (let i = results.length - 1; i >= Math.max(0, results.length - 6); i--) {
            if (i > 0 && results[i] === results[i-1]) {
                isCauCheo = false;
                break;
            }
        }
        
        // ========== 4. CẦU 2-2 ==========
        let isPair22 = false;
        if (last5.length >= 4) {
            if (last5[0] === last5[1] && last5[2] === last5[3] && last5[1] !== last5[2]) {
                isPair22 = true;
            }
        }
        
        // ========== 5. PHÁT HIỆN BẺ CẦU ==========
        let shouldBreak = false;
        let breakTarget = null;
        let breakConfidence = 0;
        let breakReason = '';
        
        // Bẻ cầu dây dài (4+)
        if (streakLength >= 4) {
            shouldBreak = true;
            breakTarget = lastResult === 'Tài' ? 'Xỉu' : 'Tài';
            breakConfidence = 70 + (streakLength - 3) * 5;
            breakReason = `Dây ${streakLength} quá dài`;
        }
        // Bẻ cầu khi lệch quá mức (10 phiên)
        else if (Math.abs(taiCount10 - 5) >= 3) {
            shouldBreak = true;
            breakTarget = taiCount10 > 5 ? 'Xỉu' : 'Tài';
            breakConfidence = 72;
            breakReason = `Lệch ${Math.abs(taiCount10 - 5)}/10 phiên`;
        }
        // Bẻ cầu 2-2 khi đủ 3 cặp
        else if (isPair22 && streakLength >= 2 && last2[0] === last2[1]) {
            shouldBreak = true;
            breakTarget = lastResult === 'Tài' ? 'Xỉu' : 'Tài';
            breakConfidence = 74;
            breakReason = 'Cầu 2-2 đủ 3 cặp';
        }
        // Bẻ cầu chéo dài (1-1 trên 5 nhịp)
        else if (isCauCheo && streakLength === 1 && results.length >= 8) {
            // Kiểm tra chuỗi chéo dài
            let cheoLength = 1;
            for (let i = results.length - 2; i >= 0; i--) {
                if (results[i] !== results[i+1]) cheoLength++;
                else break;
            }
            if (cheoLength >= 6) {
                shouldBreak = true;
                breakTarget = lastResult;
                breakConfidence = 75;
                breakReason = `Cầu chéo ${cheoLength} nhịp, tiếp tục theo nhịp`;
            }
        }
        
        // ========== 6. DỰ ĐOÁN MẶC ĐỊNH ==========
        // Bám 3 phiên gần nhất
        const taiCount3 = last3.filter(r => r === 'Tài').length;
        const defaultPrediction = taiCount3 >= 2 ? 'Tài' : 'Xỉu';
        
        return {
            // Dây dài
            longStreak: {
                active: streakLength >= 3 && !shouldBreak,
                length: streakLength,
                type: lastResult,
                prediction: lastResult,
                confidence: 65 + Math.min(15, streakLength * 3)
            },
            // Xu hướng chính
            trend: {
                active: mainTrend !== null && !shouldBreak,
                direction: mainTrend,
                strength: trendStrength,
                confidence: 60 + trendStrength * 25
            },
            // Cầu chéo
            cauCheo: {
                active: isCauCheo && !shouldBreak && streakLength === 1,
                prediction: lastResult === 'Tài' ? 'Xỉu' : 'Tài',
                confidence: 70
            },
            // Cầu 2-2
            pair22: {
                active: isPair22 && !shouldBreak,
                prediction: lastResult === 'Tài' ? 'Xỉu' : 'Tài',
                confidence: 72
            },
            // Bẻ cầu
            shouldBreak,
            breakTarget,
            breakConfidence,
            breakReason,
            // Mặc định
            defaultPrediction
        };
    }
}

const predictor = new SmartTrendPredictor();

// ==================== ĐỒNG BỘ DATA ====================
async function syncData() {
    try {
        const res = await fetch(API_URL);
        const data = await res.json();
        
        if (data?.list) {
            const newHistory = data.list.map(item => ({
                session: Number(item.id),
                result: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu'
            })).reverse();
            
            const latest = newHistory[newHistory.length - 1];
            
            // Kiểm tra kết quả dự đoán cũ
            if (APP_STATE.lastPrediction && APP_STATE.lastPrediction.phien === latest.session) {
                APP_STATE.stats.total++;
                if (APP_STATE.lastPrediction.ketqua === latest.result) {
                    APP_STATE.stats.win++;
                    console.log(`✅ THẮNG ${latest.session}: ${APP_STATE.lastPrediction.ketqua}`);
                } else {
                    APP_STATE.stats.loss++;
                    console.log(`❌ THUA ${latest.session}: ${APP_STATE.lastPrediction.ketqua} vs ${latest.result}`);
                }
                const wr = (APP_STATE.stats.win / APP_STATE.stats.total * 100).toFixed(2);
                console.log(`📊 WINRATE: ${wr}% (${APP_STATE.stats.win}/${APP_STATE.stats.total})`);
                console.log('---');
                APP_STATE.lastPrediction = null;
            }
            
            APP_STATE.history = newHistory;
            
            // Debug phân tích cầu
            if (newHistory.length >= 5) {
                const analysis = predictor.analyze(newHistory);
                console.log(`🔍 Phân tích: Dây ${analysis.longStreak.length} | Xu hướng ${analysis.trend.direction || '?'} | Cầu chéo: ${analysis.cauCheo.active ? 'Có' : 'Không'} | Bẻ cầu: ${analysis.shouldBreak ? '✅' : '❌'}`);
            }
        }
    } catch (e) {
        console.error("Lỗi sync:", e.message);
    }
}

setInterval(syncData, 5000);

// ==================== API ====================
app.get('/', async (req, res) => {
    await syncData();
    
    const last = APP_STATE.history[APP_STATE.history.length - 1];
    const nextId = last ? last.session + 1 : 1;
    
    if (!APP_STATE.lastPrediction || APP_STATE.lastPrediction.phien !== nextId) {
        APP_STATE.lastPrediction = predictor.predict(nextId, APP_STATE.history);
    }
    
    const pred = APP_STATE.lastPrediction;
    const winRate = APP_STATE.stats.total > 0 
        ? (APP_STATE.stats.win / APP_STATE.stats.total * 100).toFixed(2)
        : "0";
    
    res.json({
        "phien_truoc": last?.session || 0,
        "ketqua_truoc": last?.result || "",
        "xuc_xac": last ? (() => {
            const original = APP_STATE.history[APP_STATE.history.length - 1];
            if (original && original.dice) return original.dice;
            return [0,0,0];
        })() : [0,0,0],
        "phien_sau": nextId,
        "du_doan": pred.ketqua,
        "do_tin_cay": pred.do_tin_cay,
        "thong_ke": {
            "thang": APP_STATE.stats.win,
            "thua": APP_STATE.stats.loss,
            "tong": APP_STATE.stats.total,
            "winrate": winRate + "%"
        }
    });
});

app.get('/reset', (req, res) => {
    APP_STATE.stats = { total: 0, win: 0, loss: 0 };
    res.json({ message: "Reset thống kê thành công" });
});

app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`🎲 SMART TREND PREDICTOR - BÁM CẦU + BẺ CẦU XỊN`);
    console.log(`🚀 PORT ${PORT}`);
    console.log(`📡 API: http://localhost:${PORT}`);
    console.log(`🔄 Tự động cập nhật mỗi 5 giây`);
    console.log(`========================================\n`);
    syncData();
});
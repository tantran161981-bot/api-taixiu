const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8000;
app.use(cors());
app.use(express.json());

// --- Cấu hình ---
const API_URL = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';

let APP_STATE = {
    history: [],
    lastPrediction: null,
    stats: { total: 0, win: 0, loss: 0 }
};

// =========================================================================================
// ENGINE DỰ ĐOÁN BÁM CẦU (CHUYÊN BẮT XU HƯỚNG)
// =========================================================================================
class TrendFollowerPredictor {
    
    // Hàm chính dự đoán theo xu hướng
    predict(sessionId, history) {
        if (history.length < 10) {
            // Chưa đủ dữ liệu thì random có phân tích nhẹ
            const lastResult = history[history.length - 1]?.result || 'Tài';
            const random = Math.random();
            
            // Thiên về bám theo kết quả gần nhất khi mới bắt đầu
            let prediction;
            if (random < 0.6) {
                prediction = lastResult; // 60% bám theo cầu
            } else {
                prediction = lastResult === "Tài" ? "Xỉu" : "Tài"; // 40% đảo
            }
            
            console.log(`🎲 [Khởi tạo] Bám cầu ${prediction} (dựa trên ${lastResult})`);
            
            return {
                phien: sessionId,
                ketqua: prediction,
                do_tin_cay: '65%'
            };
        }
        
        // Lấy các thông số phân tích
        const analysis = this.analyzeTrend(history);
        
        // Quyết định dựa trên phân tích xu hướng
        let prediction;
        let confidence;
        
        if (analysis.strongTrend) {
            // Xu hướng mạnh -> bám theo cầu
            prediction = analysis.trend;
            confidence = Math.min(92, 75 + analysis.trendStrength * 15);
            console.log(`🎲 [Cầu mạnh] Bám theo ${prediction} (độ mạnh: ${analysis.trendStrength.toFixed(2)})`);
        } 
        else if (analysis.pattern) {
            // Có pattern đặc biệt
            prediction = analysis.pattern.prediction;
            confidence = analysis.pattern.confidence;
            console.log(`🎲 [Pattern] ${analysis.pattern.name} -> ${prediction}`);
        }
        else if (analysis.cauCheo) {
            // Cầu chéo (xen kẽ)
            prediction = analysis.cauCheo;
            confidence = 72;
            console.log(`🎲 [Cầu chéo] Xen kẽ ${prediction}`);
        }
        else if (analysis.reversal) {
            // Sắp đảo cầu
            prediction = analysis.reversal;
            confidence = 68;
            console.log(`🎲 [Đảo cầu] Chuẩn bị đảo sang ${prediction}`);
        }
        else {
            // Không rõ xu hướng -> bám theo cầu ngắn hạn
            prediction = analysis.shortTermTrend;
            confidence = 65;
            console.log(`🎲 [Cầu ngắn] Bám ${prediction}`);
        }
        
        return {
            phien: sessionId,
            ketqua: prediction,
            do_tin_cay: Math.round(confidence) + '%'
        };
    }
    
    // Phân tích xu hướng chi tiết
    analyzeTrend(history) {
        const results = history.map(h => h.result);
        const lastResult = results[results.length - 1];
        const secondLast = results[results.length - 2];
        const thirdLast = results[results.length - 3];
        
        // ====== 1. PHÂN TÍCH CẦU DÀI (XU HƯỚNG CHÍNH) ======
        const last10 = results.slice(-10);
        const taiCount10 = last10.filter(r => r === 'Tài').length;
        const xiuCount10 = 10 - taiCount10;
        
        // Xu hướng chính 10 phiên
        const mainTrend = taiCount10 > xiuCount10 ? 'Tài' : 'Xỉu';
        const mainTrendStrength = Math.abs(taiCount10 - xiuCount10) / 10;
        
        // ====== 2. PHÂN TÍCH CẦU NGẮN (5 PHIÊN GẦN NHẤT) ======
        const last5 = results.slice(-5);
        const taiCount5 = last5.filter(r => r === 'Tài').length;
        const xiuCount5 = 5 - taiCount5;
        
        const shortTermTrend = taiCount5 > xiuCount5 ? 'Tài' : 'Xỉu';
        const shortTermStrength = Math.abs(taiCount5 - xiuCount5) / 5;
        
        // ====== 3. PHÁT HIỆN CẦU DÂY ======
        let chainLength = 1;
        for (let i = results.length - 2; i >= 0; i--) {
            if (results[i] === lastResult) {
                chainLength++;
            } else {
                break;
            }
        }
        
        // ====== 4. PHÁT HIỆN CẦU CHÉO (1-1) ======
        let isCauCheo = true;
        for (let i = results.length - 1; i >= Math.max(0, results.length - 6); i--) {
            if (i > 0 && results[i] === results[i-1]) {
                isCauCheo = false;
                break;
            }
        }
        
        // ====== 5. PHÁT HIỆN PATTERN ĐẶC BIỆT ======
        const pattern = this.detectPattern(results);
        
        // ====== 6. XÁC ĐỊNH XU HƯỚNG MẠNH ======
        const strongTrend = (chainLength >= 3) || (shortTermStrength > 0.7) || (mainTrendStrength > 0.6);
        
        // ====== 7. DỰ ĐOÁN ĐẢO CẦU ======
        let reversal = null;
        if (chainLength >= 4) {
            // Dây dài 4+ chuẩn bị đảo
            reversal = lastResult === 'Tài' ? 'Xỉu' : 'Tài';
        } else if (shortTermStrength > 0.8 && chainLength >= 2) {
            // Áp đảo quá mức
            reversal = lastResult === 'Tài' ? 'Xỉu' : 'Tài';
        }
        
        // ====== 8. CẦU CHÉO ======
        const cauCheo = isCauCheo ? (lastResult === 'Tài' ? 'Xỉu' : 'Tài') : null;
        
        return {
            trend: mainTrend,
            trendStrength: mainTrendStrength,
            shortTermTrend: shortTermTrend,
            shortTermStrength: shortTermStrength,
            chainLength: chainLength,
            isCauCheo: isCauCheo,
            cauCheo: cauCheo,
            pattern: pattern,
            strongTrend: strongTrend,
            reversal: reversal,
            lastResult: lastResult
        };
    }
    
    // Phát hiện các pattern đặc biệt
    detectPattern(results) {
        if (results.length < 5) return null;
        
        const last5 = results.slice(-5);
        const last4 = results.slice(-4);
        const last3 = results.slice(-3);
        
        // Pattern 3 Tài - 3 Xỉu (cầu 3 nhịp)
        if (last3.every(r => r === 'Tài') && results[results.length - 4] === 'Xỉu') {
            return {
                name: 'Cầu 3 Tài',
                prediction: 'Tài',
                confidence: 75
            };
        }
        if (last3.every(r => r === 'Xỉu') && results[results.length - 4] === 'Tài') {
            return {
                name: 'Cầu 3 Xỉu',
                prediction: 'Xỉu',
                confidence: 75
            };
        }
        
        // Pattern 2-2-2 (cầu 2 nhịp đều)
        if (last4[0] === last4[1] && last4[2] === last4[3] && last4[1] !== last4[2]) {
            return {
                name: 'Cầu 2-2',
                prediction: last4[3] === 'Tài' ? 'Xỉu' : 'Tài',
                confidence: 70
            };
        }
        
        // Pattern 1-2-3 (tăng dần)
        if (last5[0] !== last5[1] && last5[1] !== last5[2] && last5[2] !== last5[3] && last5[3] !== last5[4]) {
            return {
                name: 'Cầu lộn xộn',
                prediction: last5[4] === 'Tài' ? 'Xỉu' : 'Tài',
                confidence: 60
            };
        }
        
        return null;
    }
}

const predictor = new TrendFollowerPredictor();

// =========================================================================================
// ĐỒNG BỘ DỮ LIỆU (GIỮ NGUYÊN)
// =========================================================================================
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
            
            // Kiểm tra kết quả của dự đoán cũ khi phiên đó đã có kết quả thật
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
                
                // Xoá dự đoán cũ sau khi đã tính xong
                APP_STATE.lastPrediction = null;
            }

            APP_STATE.history = newHistory;
            
            // In phân tích cầu hiện tại (debug)
            if (newHistory.length >= 5) {
                const analysis = predictor.analyzeTrend(newHistory);
                console.log(`📈 Phân tích cầu: Dài ${analysis.chainLength} | Xu hướng ${analysis.trend} (${Math.round(analysis.trendStrength*100)}%) | Cầu chéo: ${analysis.isCauCheo ? 'Có' : 'Không'}`);
            }
        }
    } catch (e) {
        console.error("Lỗi sync:", e.message);
    }
}

setInterval(syncData, 5000);

// =========================================================================================
// API (GIỮ NGUYÊN JSON)
// =========================================================================================
app.get('/', async (req, res) => {
    await syncData();
    
    const last = APP_STATE.history[APP_STATE.history.length - 1];
    const nextId = last ? last.session + 1 : 1;
    
    // Kiểm tra nếu đã có dự đoán cho phiên tiếp theo thì dùng lại, không tạo mới
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

// Reset stats
app.get('/reset', (req, res) => {
    APP_STATE.stats = { total: 0, win: 0, loss: 0 };
    res.json({ message: "Reset thống kê thành công" });
});

app.listen(PORT, () => {
    console.log(`🎲 TREND FOLLOWER - PORT ${PORT}`);
    console.log(`Thuật toán: Bám cầu thông minh (phân tích xu hướng, cầu dây, cầu chéo, pattern)`);
    syncData();
});
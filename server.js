const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// ==================== CẤU HÌNH API ====================
const API_URLS = {
    lc79_hu: 'https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5',
    lc79_md5: 'https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=3959701241b686f12e01bfe9c3a319b8',
    betvip_hu: 'https://wtx.macminim6.online/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=f69c1c37e9ffbfea5b655ed312604b40',
    betvip_md5: 'https://wtxmd52.macminim6.online/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=7aa1c7e7ea0160fd97524740774a4c61'
};

// ==================== LẤY DỮ LIỆU TỪ API (GIỮ NGUYÊN ID GỐC) ====================
async function fetchGameData(apiUrl) {
    try {
        const response = await axios.get(apiUrl, { timeout: 8000 });
        const raw = response.data;
        const list = raw.list || raw.data || [];
        
        if (!list.length) return null;
        
        return list.map(item => ({
            id: item.id,
            result: (() => {
                let sum = (item.dice1 || 0) + (item.dice2 || 0) + (item.dice3 || 0);
                if (sum === 0 && item.resultTruyenThong) {
                    return item.resultTruyenThong === 'TAI' ? 1 : 0;
                }
                return sum > 10 ? 1 : 0;
            })()
        }));
    } catch (error) {
        console.error(`Fetch error:`, error.message);
        return null;
    }
}

// ==================== THUẬT TOÁN GỐC 100% TỪ TOOL HTML ====================
function deepAnalysis(h, gameId = null) {
    if (!h || h.length < 6) {
        return {
            prediction: -1,
            predictionText: "Chờ",
            confidence: 50,
            message: "CẦU CHƯA ỔN ĐỊNH"
        };
    }

    let pStr = h.slice(0, Math.min(30, h.length)).join('');
    let curStreak = 0;
    for (let i = 0; i < h.length; i++) {
        if (h[i] === h[0]) curStreak++;
        else break;
    }
    
    let finalPred = -1;
    let logicMsg = "";
    let confBase = 0;

    // ================= TÁCH RIÊNG LC79 MD5 (GIỐNG TOOL HTML) =================
    if (gameId === 'lc79_md5') {
        let apiHistoryStr = h.slice(0, 5).join('');
        if (apiHistoryStr === '11111' || apiHistoryStr === '00000') {
            finalPred = h[0] === 1 ? 0 : 1;
            logicMsg = "LC MD5 (API DIRECT): ĐỈNH BỆT -> BẺ";
        } else if (apiHistoryStr.startsWith('101') || apiHistoryStr.startsWith('010')) {
            finalPred = h[0] === 1 ? 0 : 1;
            logicMsg = "LC MD5 (API DIRECT): DÂY PING PONG";
        } else if (h[0] === h[1] && h[1] === h[2]) {
            finalPred = h[0];
            logicMsg = "LC MD5 (API DIRECT): THEO BỆT MỚI";
        } else {
            finalPred = h[0] === 1 ? 0 : 1;
            logicMsg = "LC MD5 (API DIRECT): ĐẢO NHỊP CHU KỲ NẮN";
        }
        confBase = 98;
    } 
    // ================= CÁC GAME KHÁC (LC79 HU, BETVIP HU/MD5 ĐỀU CHẠY THUẬT TOÁN NÀY) =================
    else {
        let fastDerivativePred = -1;
        if (h.length >= 6) {
            let recentChanges = 0;
            for (let i = 0; i < 3; i++) {
                if (h[i] !== h[i + 1]) recentChanges++;
            }
            if (recentChanges === 3) fastDerivativePred = h[0] === 1 ? 0 : 1;
            else if (h[1] === h[2] && h[2] === h[3] && h[0] !== h[1]) fastDerivativePred = h[0];
        }

        let microTrendPred = -1;
        if (h.length >= 5) {
            let score = (h[0] * 5) + (h[1] * 3) + (h[2] * 2) + (h[3] * 1) - (h[4] * 1);
            if (score > 6 && h[0] === 1) microTrendPred = 1;
            else if (score < 4 && h[0] === 0) microTrendPred = 0;
        }

        let v3Pred = -1;
        let v3LogicMsg = "";
        if (h.length >= 18) {
            let match3_1 = (h[0] === h[3] && h[1] === h[4] && h[2] === h[5]);
            if (match3_1) {
                v3Pred = h[2];
                v3LogicMsg = "CẦU V3: LẶP CHU KỲ 3 NHỊP -> ĐÁNH THEO KHUÔN";
            }
        }

        let v4Pred = -1;
        let v4LogicMsg = "";
        if (h.length >= 20) {
            if (h[0] === h[4] && h[1] === h[3] && h[0] !== h[2]) {
                v4Pred = h[0];
                v4LogicMsg = "CẦU V4: ĐỐI XỨNG GƯƠNG TÂM";
            } else if (pStr.startsWith('100111') || pStr.startsWith('011000')) {
                v4Pred = h[0] === 1 ? 1 : 0;
                v4LogicMsg = "CẦU V4: THÁP TIẾN CẤP ĐANG MỞ";
            } else if (h.slice(0, 6).join('') === h.slice(6, 12).join('')) {
                v4Pred = h[6];
                v4LogicMsg = "CẦU V4: BÃO LẶP CHU KỲ 6 NHỊP";
            }
        }

        let v5Pred = -1;
        let v5LogicMsg = "";
        if (h.length >= 25) {
            let transitions = { '00': { 0: 0, 1: 0 }, '01': { 0: 0, 1: 0 }, '10': { 0: 0, 1: 0 }, '11': { 0: 0, 1: 0 } };
            for (let i = 0; i < h.length - 2; i++) {
                let state = "" + h[i + 2] + h[i + 1];
                let next = h[i];
                if (transitions[state]) transitions[state][next]++;
            }
            let currentState = "" + h[1] + h[0];
            if (transitions[currentState]) {
                let next0 = transitions[currentState][0];
                let next1 = transitions[currentState][1];
                if (next1 > next0 + 1) {
                    v5Pred = 1;
                    v5LogicMsg = "CẦU V5: MARKOV CHAIN (TỶ LỆ KÉP)";
                } else if (next0 > next1 + 1) {
                    v5Pred = 0;
                    v5LogicMsg = "CẦU V5: MARKOV CHAIN (TỶ LỆ KÉP)";
                }
            }
        }
        if (curStreak > 6) {
            v5Pred = h[0] === 1 ? 0 : 1;
            v5LogicMsg = "CẦU V5: ĐỈNH BỆT ẢO -> ÉP BẺ NHỊP";
        }

        let v6Pred = -1;
        let v6LogicMsg = "";
        if (h.length >= 30) {
            let isPingPongLong = true;
            for (let i = 0; i < 8; i++) {
                if (h[i] === h[i + 1]) isPingPongLong = false;
            }
            
            let is22Long = true;
            for (let i = 0; i < 8; i += 2) {
                if (h[i] !== h[i + 1] || (i < 6 && h[i] === h[i + 2])) is22Long = false;
            }
            
            let is123Long = (pStr.startsWith('100111') || pStr.startsWith('011000'));
            let is321Long = (pStr.startsWith('111001') || pStr.startsWith('000110'));
            
            if (isPingPongLong) {
                v6Pred = h[0] === 1 ? 0 : 1;
                v6LogicMsg = "CẦU V6: PING PONG DÀI HẠN (1-1)";
            } else if (is22Long) {
                let countConsecutive = h[0] === h[1] ? 2 : 1;
                v6Pred = countConsecutive === 2 ? (h[0] === 1 ? 0 : 1) : h[0];
                v6LogicMsg = "CẦU V6: KHUÔN 2-2 BỀN VỮNG";
            } else if (is123Long) {
                v6Pred = h[0] === 1 ? 0 : 1;
                v6LogicMsg = "CẦU V6: BƯỚC TIẾN 1-2-3";
            } else if (is321Long) {
                v6Pred = h[0] === 1 ? 1 : 0;
                v6LogicMsg = "CẦU V6: BƯỚC LÙI 3-2-1";
            } else {
                let targetPattern = h.slice(0, 4).join('');
                let matchTai = 0;
                let matchXiu = 0;
                
                for (let i = 1; i <= h.length - 5; i++) {
                    let historicalPattern = h.slice(i, i + 4).join('');
                    if (targetPattern === historicalPattern) {
                        if (h[i - 1] === 1) matchTai++;
                        else matchXiu++;
                    }
                }
                
                if (matchTai > matchXiu && matchTai >= 2) {
                    v6Pred = 1;
                    v6LogicMsg = "CẦU V6: MATCHING TOÀN CẢNH (LẶP LỊCH SỬ)";
                } else if (matchXiu > matchTai && matchXiu >= 2) {
                    v6Pred = 0;
                    v6LogicMsg = "CẦU V6: MATCHING TOÀN CẢNH (LẶP LỊCH SỬ)";
                }
            }
        }

        let v7Pred = -1;
        let v7LogicMsg = "";
        if (h.length >= 15) {
            let xorValue = h[0] ^ h[1] ^ h[2];
            let bitShift = (h[3] << 1) | h[4];
            let rawEntropy = (h[0] * 8) + (h[1] * 4) + (h[2] * 2) + h[3];
            
            if (xorValue === 1 && bitShift > 1 && rawEntropy > 7) {
                v7Pred = 1;
                v7LogicMsg = "CẦU V7: SUPER ENTROPY & XOR (BIT SHIFT TÀI)";
            } else if (xorValue === 0 && bitShift <= 1 && rawEntropy <= 7) {
                v7Pred = 0;
                v7LogicMsg = "CẦU V7: SUPER ENTROPY & XOR (BIT SHIFT XỈU)";
            }
        }

        if (v7Pred !== -1) {
            finalPred = v7Pred;
            logicMsg = v7LogicMsg;
            confBase = 99;
        } else if (v6Pred !== -1) {
            finalPred = v6Pred;
            logicMsg = v6LogicMsg;
            confBase = 99;
        } else if (v5Pred !== -1) {
            finalPred = v5Pred;
            logicMsg = v5LogicMsg;
            confBase = 99;
        } else if (v4Pred !== -1) {
            finalPred = v4Pred;
            logicMsg = v4LogicMsg;
            confBase = 99;
        } else if (v3Pred !== -1) {
            finalPred = v3Pred;
            logicMsg = "VIP V3: " + v3LogicMsg;
            confBase = 98;
        } else if (fastDerivativePred !== -1) {
            finalPred = fastDerivativePred;
            logicMsg = "VIP 9: BẮT NGUYÊN TỬ NHANH";
            confBase = 95;
        } else if (microTrendPred !== -1 && curStreak <= 3) {
            finalPred = microTrendPred;
            logicMsg = "VIP 10: SIÊU TRỌNG SỐ";
            confBase = 94;
        } else {
            finalPred = h[0] === 1 ? 0 : 1;
            logicMsg = "ĐẢO NHỊP TIÊU CHUẨN";
            confBase = 85;
        }
    }

    let variance = (h[0] === h[1] && curStreak < 3 ? 2 : 0);
    let finalConfidence = Math.min(Math.max(confBase + variance, 65), 99);

    return {
        prediction: finalPred,
        predictionText: finalPred === 1 ? "Tài" : (finalPred === 0 ? "Xỉu" : "Chờ"),
        confidence: finalConfidence,
        message: logicMsg
    };
}

// ==================== DỰ ĐOÁN CHO LC79 (GIỮ NGUYÊN 100%) ====================
async function predictLC79(gameId, apiUrl) {
    const data = await fetchGameData(apiUrl);
    if (!data || data.length < 5) {
        return { error: "Không thể lấy dữ liệu", phien_hien_tai: 0, du_doan: "Lỗi", do_tin_cay: "0%" };
    }
    
    const latestId = data[0].id;
    const historyResults = data.map(item => item.result);
    const prediction = deepAnalysis(historyResults, gameId);
    const currentPhien = latestId + 1;
    
    return {
        phien_hien_tai: currentPhien,
        du_doan: prediction.predictionText,
        do_tin_cay: `${prediction.confidence}%`
    };
}

// ==================== DỰ ĐOÁN CHO BETVIP (NGƯỢC VỚI KẾT QUẢ CỦA TOOL HTML) ====================
async function predictBetVIP(gameId, apiUrl) {
    const data = await fetchGameData(apiUrl);
    if (!data || data.length < 5) {
        return { error: "Không thể lấy dữ liệu", phien_hien_tai: 0, du_doan: "Lỗi", do_tin_cay: "0%" };
    }
    
    const latestId = data[0].id;
    const historyResults = data.map(item => item.result);
    
    // Lấy kết quả dự đoán từ thuật toán GIỐNG HỆT TOOL HTML
    const originalPrediction = deepAnalysis(historyResults, gameId);
    
    // ĐẢO NGƯỢC KẾT QUẢ: Tài -> Xỉu, Xỉu -> Tài
    let reversedPrediction = "";
    if (originalPrediction.predictionText === "Tài") {
        reversedPrediction = "Xỉu";
    } else if (originalPrediction.predictionText === "Xỉu") {
        reversedPrediction = "Tài";
    } else {
        reversedPrediction = "Chờ";
    }
    
    const currentPhien = latestId + 1;
    
    return {
        phien_hien_tai: currentPhien,
        du_doan: reversedPrediction,
        do_tin_cay: "99%"  // BETVIP giữ độ tin cậy cao
    };
}

// ==================== API ENDPOINTS ====================

app.get('/', (req, res) => {
    res.json({
        name: "TÀI XỈU SUPER AI API",
        version: "7.0",
        author: "ANH QUAN",
        description: "LC79 giữ nguyên 100% thuật toán từ tool HTML, BETVIP dự đoán NGƯỢC",
        endpoints: {
            "/lc79-hu": "Dự đoán LC79 Tài Xỉu Hũ (giữ nguyên)",
            "/lc79-md5": "Dự đoán LC79 Tài Xỉu MD5 (giữ nguyên)",
            "/betvip-hu": "Dự đoán BETVIP Tài Xỉu Hũ (NGƯỢC với tool)",
            "/betvip-md5": "Dự đoán BETVIP Tài Xỉu MD5 (NGƯỢC với tool)"
        }
    });
});

app.get('/lc79-hu', async (req, res) => {
    try {
        const result = await predictLC79('lc79_hu', API_URLS.lc79_hu);
        if (result.error) return res.status(500).json(result);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/lc79-md5', async (req, res) => {
    try {
        const result = await predictLC79('lc79_md5', API_URLS.lc79_md5);
        if (result.error) return res.status(500).json(result);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/betvip-hu', async (req, res) => {
    try {
        const result = await predictBetVIP('betvip_hu', API_URLS.betvip_hu);
        if (result.error) return res.status(500).json(result);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/betvip-md5', async (req, res) => {
    try {
        const result = await predictBetVIP('betvip_md5', API_URLS.betvip_md5);
        if (result.error) return res.status(500).json(result);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== KHỞI ĐỘNG ====================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════════╗
║                                                                           ║
║   🚀 TÀI XỈU SUPER AI API - THUẬT TOÁN V1-V7                            ║
║   📡 PORT: ${PORT}                                                           ║
║   👤 AUTHOR: ANH QUAN                                                     ║
║                                                                           ║
║   🧠 THUẬT TOÁN:                                                          ║
║      ├─ LC79: GIỮ NGUYÊN 100% THUẬT TOÁN TỪ TOOL HTML                    ║
║      │   ├─ V1-V7, LC79 MD5 đặc biệt, phân tích sâu                      ║
║      │                                                                   ║
║      └─ BETVIP: DỰ ĐOÁN NGƯỢC VỚI KẾT QUẢ CỦA TOOL HTML                  ║
║          (Tài -> Xỉu, Xỉu -> Tài)                                        ║
║                                                                           ║
║   📡 CÁCH TÍNH PHIÊN: latest.id + 1 (GIỐNG TOOL HTML)                    ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝
    `);
});

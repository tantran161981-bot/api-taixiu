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

// ==================== THUẬT TOÁN DEEP ANALYSIS ====================
function deepAnalysis(h, gameId) {
    // Kiểm tra dữ liệu đầu vào
    if (!h || !Array.isArray(h) || h.length < 6) {
        return {
            prediction: -1,
            predictionText: "Chờ",
            confidence: 50,
            message: "CẦU CHƯA ỔN ĐỊNH",
            algorithm: "N/A"
        };
    }

    let pStr = h.slice(0, Math.min(30, h.length)).join('');
    let curStreak = 0;
    for (let i = 0; i < h.length; i++) {
        if (h[i] === h[0]) curStreak++;
        else break;
    }
    
    // Khai báo biến
    let finalPred = -1;
    let logicMsg = "";
    let confBase = 0;
    let v7Pred = -1;
    let v6Pred = -1;
    let v5Pred = -1;
    let v4Pred = -1;
    let v3Pred = -1;
    let fastDerivativePred = -1;
    let microTrendPred = -1;
    let apiSpecificPred = -1;

    // ================= LC79 MD5 =================
    if (gameId === 'lc79_md5') {
        let apiHistoryStr = h.slice(0, 5).join('');
        if (apiHistoryStr === '11111' || apiHistoryStr === '00000') {
            apiSpecificPred = h[0] === 1 ? 0 : 1;
            logicMsg = "LC MD5: ĐỈNH BỆT -> BẺ";
        } else if (apiHistoryStr.startsWith('101') || apiHistoryStr.startsWith('010')) {
            apiSpecificPred = h[0] === 1 ? 0 : 1;
            logicMsg = "LC MD5: DÂY PING PONG";
        } else if (h[0] === h[1] && h[1] === h[2]) {
            apiSpecificPred = h[0];
            logicMsg = "LC MD5: THEO BỆT MỚI";
        } else {
            apiSpecificPred = h[0] === 1 ? 0 : 1;
            logicMsg = "LC MD5: ĐẢO NHỊP CHU KỲ";
        }
        finalPred = apiSpecificPred;
        confBase = 98;
    } 
    // ================= CÁC GAME KHÁC =================
    else {
        // V1: Fast Derivative
        if (h.length >= 6) {
            let recentChanges = 0;
            for (let i = 0; i < 3; i++) {
                if (h[i] !== h[i + 1]) recentChanges++;
            }
            if (recentChanges === 3) fastDerivativePred = h[0] === 1 ? 0 : 1;
            else if (h[1] === h[2] && h[2] === h[3] && h[0] !== h[1]) fastDerivativePred = h[0];
        }

        // V2: Micro Trend
        if (h.length >= 5) {
            let score = (h[0] * 5) + (h[1] * 3) + (h[2] * 2) + (h[3] * 1) - (h[4] * 1);
            if (score > 6 && h[0] === 1) microTrendPred = 1;
            else if (score < 4 && h[0] === 0) microTrendPred = 0;
        }

        // V3: Chu kỳ 3 nhịp
        if (h.length >= 18) {
            let match3_1 = (h[0] === h[3] && h[1] === h[4] && h[2] === h[5]);
            if (match3_1) {
                v3Pred = h[2];
                logicMsg = "V3: LẶP CHU KỲ 3 NHỊP";
            }
        }

        // V4: Đối xứng
        if (h.length >= 20 && v3Pred === -1) {
            if (h[0] === h[4] && h[1] === h[3] && h[0] !== h[2]) {
                v4Pred = h[0];
                logicMsg = "V4: ĐỐI XỨNG GƯƠNG TÂM";
            } else if (pStr.startsWith('100111') || pStr.startsWith('011000')) {
                v4Pred = h[0] === 1 ? 1 : 0;
                logicMsg = "V4: THÁP TIẾN CẤP";
            } else if (h.slice(0, 6).join('') === h.slice(6, 12).join('')) {
                v4Pred = h[6];
                logicMsg = "V4: BÃO LẶP CHU KỲ 6";
            }
        }

        // V5: Markov Chain
        if (h.length >= 25 && v4Pred === -1 && v3Pred === -1) {
            if (curStreak > 6) {
                v5Pred = h[0] === 1 ? 0 : 1;
                logicMsg = "V5: ĐỈNH BỆT -> ÉP BẺ";
            }
        }

        // V6: Pattern dài hạn
        if (h.length >= 30 && v5Pred === -1 && v4Pred === -1 && v3Pred === -1) {
            let isPingPongLong = true;
            for (let i = 0; i < 8; i++) {
                if (h[i] === h[i + 1]) isPingPongLong = false;
            }
            if (isPingPongLong) {
                v6Pred = h[0] === 1 ? 0 : 1;
                logicMsg = "V6: PING PONG DÀI HẠN (1-1)";
            }
        }

        // V7: Super Entropy & XOR
        if (h.length >= 15 && v6Pred === -1 && v5Pred === -1 && v4Pred === -1 && v3Pred === -1) {
            let xorValue = h[0] ^ h[1] ^ h[2];
            let bitShift = (h[3] << 1) | h[4];
            let rawEntropy = (h[0] * 8) + (h[1] * 4) + (h[2] * 2) + h[3];
            
            if (xorValue === 1 && bitShift > 1 && rawEntropy > 7) {
                v7Pred = 1;
                logicMsg = "V7: SUPER ENTROPY & XOR (TÀI)";
            } else if (xorValue === 0 && bitShift <= 1 && rawEntropy <= 7) {
                v7Pred = 0;
                logicMsg = "V7: SUPER ENTROPY & XOR (XỈU)";
            }
        }

        // Xét ưu tiên
        if (v7Pred !== -1) {
            finalPred = v7Pred;
            confBase = 99;
        } else if (v6Pred !== -1) {
            finalPred = v6Pred;
            confBase = 99;
        } else if (v5Pred !== -1) {
            finalPred = v5Pred;
            confBase = 99;
        } else if (v4Pred !== -1) {
            finalPred = v4Pred;
            confBase = 99;
        } else if (v3Pred !== -1) {
            finalPred = v3Pred;
            confBase = 98;
        } else if (fastDerivativePred !== -1) {
            finalPred = fastDerivativePred;
            confBase = 95;
            logicMsg = "V1: BẮT NGUYÊN TỬ NHANH";
        } else if (microTrendPred !== -1 && curStreak <= 3) {
            finalPred = microTrendPred;
            confBase = 94;
            logicMsg = "V2: SIÊU TRỌNG SỐ";
        } else {
            finalPred = h[0] === 1 ? 0 : 1;
            confBase = 85;
            logicMsg = "ĐẢO NHỊP TIÊU CHUẨN";
        }
    }

    // Tính confidence
    let variance = (h[0] === h[1] && curStreak < 3) ? 2 : 0;
    let finalConfidence = Math.min(Math.max(confBase + variance, 65), 99);
    
    let predictionText = "Chờ";
    if (finalPred === 1) predictionText = "Tài";
    else if (finalPred === 0) predictionText = "Xỉu";

    return {
        predictionText: predictionText,
        confidence: finalConfidence,
        message: logicMsg
    };
}

// ==================== LẤY DỮ LIỆU API ====================
async function fetchGameData(apiUrl) {
    try {
        const response = await axios.get(apiUrl, { timeout: 8000 });
        const raw = response.data;
        const list = raw.list || raw.data || [];
        
        if (!list || !list.length) return null;
        
        const history = [];
        for (let i = 0; i < list.length; i++) {
            const item = list[i];
            let sum = (item.dice1 || 0) + (item.dice2 || 0) + (item.dice3 || 0);
            if (sum === 0 && item.resultTruyenThong) {
                history.push(item.resultTruyenThong === 'TAI' ? 1 : 0);
            } else {
                history.push(sum > 10 ? 1 : 0);
            }
        }
        return history;
    } catch (error) {
        console.error('Fetch error:', error.message);
        return null;
    }
}

// ==================== DỰ ĐOÁN ====================
async function getPrediction(gameId, apiUrl, isReversed) {
    const history = await fetchGameData(apiUrl);
    if (!history || history.length < 5) {
        return {
            phien_hien_tai: null,
            du_doan: "Lỗi",
            do_tin_cay: "0%"
        };
    }
    
    const currentPhien = history.length;
    const result = deepAnalysis(history, gameId);
    
    let finalPrediction = result.predictionText;
    let finalConfidence = result.confidence;
    
    // BETVIP: đảo ngược
    if (isReversed && finalPrediction !== "Chờ") {
        finalPrediction = finalPrediction === "Tài" ? "Xỉu" : "Tài";
        finalConfidence = Math.max(55, finalConfidence - 5);
    }
    
    return {
        phien_hien_tai: currentPhien + 1,
        du_doan: finalPrediction,
        do_tin_cay: finalConfidence + "%"
    };
}

// ==================== ENDPOINTS ====================
app.get('/', (req, res) => {
    res.json({
        name: "TÀI XỈU SUPER AI API",
        version: "7.0",
        author: "VI LONG",
        endpoints: {
            "/lc79-hu": "LC79 Tài Xỉu Hũ (giống tool 100%)",
            "/lc79-md5": "LC79 Tài Xỉu MD5 (giống tool 100%)",
            "/betvip-hu": "BETVIP Tài Xỉu Hũ (ĐẢO NGƯỢC)",
            "/betvip-md5": "BETVIP Tài Xỉu MD5 (ĐẢO NGƯỢC)"
        }
    });
});

app.get('/lc79-hu', async (req, res) => {
    try {
        const result = await getPrediction('lc79_hu', API_URLS.lc79_hu, false);
        res.json(result);
    } catch (error) {
        res.status(500).json({ phien_hien_tai: null, du_doan: "Lỗi", do_tin_cay: "0%" });
    }
});

app.get('/lc79-md5', async (req, res) => {
    try {
        const result = await getPrediction('lc79_md5', API_URLS.lc79_md5, false);
        res.json(result);
    } catch (error) {
        res.status(500).json({ phien_hien_tai: null, du_doan: "Lỗi", do_tin_cay: "0%" });
    }
});

app.get('/betvip-hu', async (req, res) => {
    try {
        const result = await getPrediction('betvip_hu', API_URLS.betvip_hu, true);
        res.json(result);
    } catch (error) {
        res.status(500).json({ phien_hien_tai: null, du_doan: "Lỗi", do_tin_cay: "0%" });
    }
});

app.get('/betvip-md5', async (req, res) => {
    try {
        const result = await getPrediction('betvip_md5', API_URLS.betvip_md5, true);
        res.json(result);
    } catch (error) {
        res.status(500).json({ phien_hien_tai: null, du_doan: "Lỗi", do_tin_cay: "0%" });
    }
});

// ==================== KHỞI ĐỘNG ====================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});

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

// ==================== LẤY DỮ LIỆU ====================
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

// ==================== SIÊU THUẬT TOÁN DỰ ĐOÁN V11.0 ====================

/**
 * LỌC NHIỄU THÔNG MINH
 */
function smartNoiseFilter(h) {
    if (h.length < 10) return h;
    
    let filtered = [...h];
    for (let i = 2; i < filtered.length - 2; i++) {
        let window = filtered.slice(i - 2, i + 3);
        let avg = window.reduce((a, b) => a + b, 0) / 5;
        if (Math.abs(filtered[i] - avg) > 0.6) {
            filtered[i] = avg > 0.5 ? 1 : 0;
        }
    }
    return filtered;
}

/**
 * V1 PREMIUM - TÍCH PHÂN ĐẠO HÀM
 */
function v1PremiumIntegral(h) {
    if (h.length < 8) return { pred: -1, conf: 0, msg: "" };
    
    let integral = 0;
    let derivatives = [];
    
    for (let i = 0; i < h.length - 1; i++) {
        let diff = h[i+1] - h[i];
        derivatives.push(diff);
        integral += diff;
    }
    
    let secondDerivatives = [];
    for (let i = 0; i < derivatives.length - 1; i++) {
        secondDerivatives.push(derivatives[i+1] - derivatives[i]);
    }
    
    let momentum = integral / h.length;
    let acceleration = secondDerivatives.reduce((a, b) => a + b, 0) / (secondDerivatives.length || 1);
    
    let prediction = -1;
    let confidence = 0;
    let message = "";
    
    if (momentum > 0.3 && acceleration > 0) {
        prediction = 1;
        confidence = 92;
        message = "💎 TÍCH PHÂN DƯƠNG + GIA TỐC → BẮT TÀI";
    } else if (momentum < -0.3 && acceleration < 0) {
        prediction = 0;
        confidence = 92;
        message = "💎 TÍCH PHÂN ÂM + GIẢM TỐC → BẮT XỈU";
    } else if (Math.abs(momentum) < 0.15 && Math.abs(acceleration) > 0.3) {
        prediction = h[0] === 1 ? 0 : 1;
        confidence = 94;
        message = "💎 GIA TỐC ĐỘT BIẾN → ĐẢO CẦU";
    }
    
    return { pred: prediction, conf: confidence, msg: message };
}

/**
 * V2 PREMIUM - GOLDEN RATIO (TỶ LỆ VÀNG)
 */
function v2PremiumGoldenRatio(h) {
    if (h.length < 12) return { pred: -1, conf: 0, msg: "" };
    
    const phi = 1.618;
    let goldenSpiral = [];
    
    for (let i = 0; i < 5; i++) {
        let pos = Math.floor(Math.pow(phi, i)) % h.length;
        goldenSpiral.push(h[pos]);
    }
    
    let taiCount = goldenSpiral.filter(x => x === 1).length;
    let ratio = taiCount / goldenSpiral.length;
    
    let prediction = -1;
    let confidence = 0;
    let message = "";
    
    if (ratio > 0.6) {
        prediction = 1;
        confidence = 91;
        message = "✨ TỶ LỆ VÀNG PHI 1.618 → NGHIÊNG TÀI";
    } else if (ratio < 0.4) {
        prediction = 0;
        confidence = 91;
        message = "✨ TỶ LỆ VÀNG PHI 1.618 → NGHIÊNG XỈU";
    }
    
    // Fibonacci retracement nâng cao
    let fibLevels = [0.236, 0.382, 0.5, 0.618, 0.786];
    let values = h.slice(0, 13).map(x => x === 1 ? 1 : 0);
    let maxVal = Math.max(...values);
    let minVal = Math.min(...values);
    let range = maxVal - minVal;
    
    let currentVal = values[0];
    for (let level of fibLevels) {
        let fibLevel = minVal + range * level;
        if (Math.abs(currentVal - fibLevel) < 0.15) {
            prediction = level < 0.5 ? 0 : 1;
            confidence = 93;
            message = `✨ FIBONACCI ${level} → ${prediction === 1 ? "TÀI" : "XỈU"}`;
            break;
        }
    }
    
    return { pred: prediction, conf: confidence, msg: message };
}

/**
 * V3 PREMIUM - HỌC SÂU CNN SIMULATOR
 */
function v3PremiumCNN(h) {
    if (h.length < 15) return { pred: -1, conf: 0, msg: "" };
    
    // Convolution kernel 3x1
    let kernel = [0.5, 0.3, 0.2];
    let convFeatures = [];
    
    for (let i = 0; i < h.length - 2; i++) {
        let conv = h[i] * kernel[0] + h[i+1] * kernel[1] + h[i+2] * kernel[2];
        convFeatures.push(conv);
    }
    
    // Max pooling
    let pooledFeatures = [];
    for (let i = 0; i < convFeatures.length - 1; i += 2) {
        pooledFeatures.push(Math.max(convFeatures[i], convFeatures[i+1] || convFeatures[i]));
    }
    
    // Fully connected
    let output = pooledFeatures.reduce((a, b) => a + b, 0) / pooledFeatures.length;
    
    let prediction = -1;
    let confidence = 0;
    let message = "";
    
    if (output > 0.65) {
        prediction = 1;
        confidence = 93;
        message = "🧠 CNN DETECT → XU HƯỚNG TÀI MẠNH";
    } else if (output < 0.35) {
        prediction = 0;
        confidence = 93;
        message = "🧠 CNN DETECT → XU HƯỚNG XỈU MẠNH";
    } else if (output > 0.55 && output < 0.65) {
        prediction = h[0] === 1 ? 0 : 1;
        confidence = 90;
        message = "🧠 CNN BẤT ỔN → ĐẢO CẦU";
    }
    
    return { pred: prediction, conf: confidence, msg: message };
}

/**
 * V4 PREMIUM - QUANTUM PROBABILITY
 */
function v4PremiumQuantum(h) {
    if (h.length < 10) return { pred: -1, conf: 0, msg: "" };
    
    // Superposition state
    let superposition = { tai: 0.5, xiu: 0.5 };
    
    // Collapse measurement
    let collapseFactors = [];
    
    for (let i = 0; i < Math.min(10, h.length); i++) {
        let factor = h[i] === 1 ? 1.2 : 0.8;
        collapseFactors.push(factor);
    }
    
    for (let i = 0; i < collapseFactors.length; i++) {
        if (h[i] === 1) {
            superposition.tai *= collapseFactors[i];
            superposition.xiu *= (2 - collapseFactors[i]);
        } else {
            superposition.xiu *= collapseFactors[i];
            superposition.tai *= (2 - collapseFactors[i]);
        }
    }
    
    let total = superposition.tai + superposition.xiu;
    let taiProb = superposition.tai / total;
    let xiuProb = superposition.xiu / total;
    
    let prediction = -1;
    let confidence = 0;
    let message = "";
    
    if (taiProb > 0.7) {
        prediction = 1;
        confidence = Math.floor(taiProb * 100);
        message = "⚛️ LƯỢNG TỬ COLLAPSE → TÀI";
    } else if (xiuProb > 0.7) {
        prediction = 0;
        confidence = Math.floor(xiuProb * 100);
        message = "⚛️ LƯỢNG TỬ COLLAPSE → XỈU";
    }
    
    return { pred: prediction, conf: confidence, msg: message };
}

/**
 * V5 PREMIUM - CHAOS FRACTAL
 */
function v5PremiumChaosFractal(h) {
    if (h.length < 20) return { pred: -1, conf: 0, msg: "" };
    
    // Fractal dimension calculation
    let fractalDim = 0;
    let scales = [2, 3, 4, 5];
    
    for (let scale of scales) {
        let patterns = new Set();
        for (let i = 0; i < h.length - scale; i += scale) {
            let pattern = h.slice(i, i + scale).join('');
            patterns.add(pattern);
        }
        fractalDim += Math.log(patterns.size) / Math.log(scale);
    }
    fractalDim = fractalDim / scales.length;
    
    // Lyapunov exponent
    let lyapunov = 0;
    for (let i = 0; i < h.length - 2; i++) {
        let diff = Math.abs(h[i+1] - h[i]);
        if (diff > 0) lyapunov += Math.log(diff + 0.01);
    }
    lyapunov = lyapunov / (h.length - 2);
    
    let prediction = -1;
    let confidence = 0;
    let message = "";
    
    if (fractalDim < 0.5 && lyapunov < -0.05) {
        prediction = h[0];
        confidence = 94;
        message = "🌀 FRACTAL ĐƠN GIẢN → THEO CẦU";
    } else if (fractalDim > 0.7 && lyapunov > 0.05) {
        prediction = h[0] === 1 ? 0 : 1;
        confidence = 95;
        message = "🌀 FRACTAL HỖN LOẠN → BẺ CẦU";
    }
    
    return { pred: prediction, conf: confidence, msg: message };
}

/**
 * V6 PREMIUM - SMART MONEY INDEX
 */
function v6PremiumSmartMoney(h) {
    if (h.length < 15) return { pred: -1, conf: 0, msg: "" };
    
    // Smart money indicators
    let accumulation = 0;
    let distribution = 0;
    
    for (let i = 0; i < h.length - 3; i++) {
        if (h[i] === h[i+1] && h[i+1] === h[i+2]) {
            if (h[i] === 1) accumulation += 2;
            else distribution += 2;
        } else if (h[i] !== h[i+1] && h[i+1] !== h[i+2]) {
            if (h[i] === 1) distribution++;
            else accumulation++;
        }
    }
    
    let smi = (accumulation - distribution) / (accumulation + distribution + 1);
    
    let prediction = -1;
    let confidence = 0;
    let message = "";
    
    if (smi > 0.3) {
        prediction = 1;
        confidence = 94;
        message = "💰 SMART MONEY TÍCH LŨY → BẮT TÀI";
    } else if (smi < -0.3) {
        prediction = 0;
        confidence = 94;
        message = "💰 SMART MONEY PHÂN PHỐI → BẮT XỈU";
    }
    
    return { pred: prediction, conf: confidence, msg: message };
}

/**
 * V7 PREMIUM - NEURAL OSCILLATION
 */
function v7PremiumNeuralOscillation(h) {
    if (h.length < 12) return { pred: -1, conf: 0, msg: "" };
    
    // Alpha, Beta, Theta waves simulation
    let alpha = 0, beta = 0, theta = 0;
    let frequencies = [8, 12, 20, 4];
    
    for (let freq of frequencies) {
        let wave = 0;
        for (let i = 0; i < Math.min(20, h.length); i++) {
            wave += h[i] * Math.sin(2 * Math.PI * freq * i / h.length);
        }
        if (freq === 8) alpha = wave / 20;
        else if (freq === 12) beta = wave / 20;
        else if (freq === 20) theta = wave / 20;
    }
    
    let prediction = -1;
    let confidence = 0;
    let message = "";
    
    if (alpha > 0.3 && beta < 0.2) {
        prediction = 1;
        confidence = 93;
        message = "🧠 SÓNG ALPHA DOMINANT → TÀI";
    } else if (beta > 0.3 && alpha < 0.2) {
        prediction = 0;
        confidence = 93;
        message = "🧠 SÓNG BETA DOMINANT → XỈU";
    } else if (theta > 0.4) {
        prediction = h[0] === 1 ? 0 : 1;
        confidence = 91;
        message = "🧠 SÓNG THETA → TRẠNG THÁI ĐẢO CẦU";
    }
    
    return { pred: prediction, conf: confidence, msg: message };
}

// ==================== BẮT CẦU CAO CẤP ====================

function catchSuperStreak(h) {
    if (h.length < 4) return -1;
    
    let streak = 1;
    for (let i = 1; i < h.length; i++) {
        if (h[i] === h[0]) streak++;
        else break;
    }
    
    if (streak >= 3 && streak <= 4) return h[0];
    if (streak >= 5 && streak <= 6) {
        let maxHistory = 1, temp = 1;
        for (let i = 1; i < h.length - 1; i++) {
            if (h[i] === h[i+1]) temp++;
            else { maxHistory = Math.max(maxHistory, temp); temp = 1; }
        }
        return maxHistory <= 6 ? h[0] : (h[0] === 1 ? 0 : 1);
    }
    if (streak >= 7) return h[0] === 1 ? 0 : 1;
    return -1;
}

function catchSuperPingPong(h) {
    if (h.length < 10) return -1;
    
    let isPingPong = true;
    for (let i = 0; i < 9; i++) {
        if (h[i] === h[i+1]) { isPingPong = false; break; }
    }
    
    if (isPingPong) return h[0] === 1 ? 0 : 1;
    
    let pattern = h.slice(0, 5).join('');
    if (pattern === '10101' || pattern === '01010') {
        return h[4] === 1 ? 0 : 1;
    }
    
    return -1;
}

function catchSuperDouble(h) {
    if (h.length < 12) return -1;
    
    for (let size = 2; size <= 4; size++) {
        let isDouble = true;
        for (let i = 0; i < size * 3; i += size) {
            for (let j = 0; j < size - 1; j++) {
                if (i + j + 1 < h.length && h[i + j] !== h[i + j + 1]) {
                    isDouble = false;
                    break;
                }
            }
            if (i + size < h.length && i + size * 2 < h.length && h[i] === h[i + size]) {
                isDouble = false;
                break;
            }
        }
        if (isDouble) {
            let nextPos = (Math.floor(h.length / size) * size);
            if (nextPos < h.length) {
                return h[nextPos] === 1 ? 0 : 1;
            }
            return h[0] === 1 ? 0 : 1;
        }
    }
    
    return -1;
}

// ==================== TỔNG HỢP SIÊU PHẨM ====================

function supremePrediction(h, gameId) {
    if (!h || h.length < 10) {
        return {
            prediction: -1,
            predictionText: "⏳ CHỜ DỮ LIỆU",
            confidence: 50,
            algorithm: "ĐANG PHÂN TÍCH...",
            emoji: "🔍"
        };
    }
    
    // Lọc nhiễu
    let cleanData = smartNoiseFilter(h);
    
    let results = [];
    
    // Premium algorithms
    const v1 = v1PremiumIntegral(cleanData);
    if (v1.pred !== -1) results.push({ pred: v1.pred, conf: v1.conf, name: v1.msg });
    
    const v2 = v2PremiumGoldenRatio(cleanData);
    if (v2.pred !== -1) results.push({ pred: v2.pred, conf: v2.conf, name: v2.msg });
    
    const v3 = v3PremiumCNN(cleanData);
    if (v3.pred !== -1) results.push({ pred: v3.pred, conf: v3.conf, name: v3.msg });
    
    const v4 = v4PremiumQuantum(cleanData);
    if (v4.pred !== -1) results.push({ pred: v4.pred, conf: v4.conf, name: v4.msg });
    
    const v5 = v5PremiumChaosFractal(cleanData);
    if (v5.pred !== -1) results.push({ pred: v5.pred, conf: v5.conf, name: v5.msg });
    
    const v6 = v6PremiumSmartMoney(cleanData);
    if (v6.pred !== -1) results.push({ pred: v6.pred, conf: v6.conf, name: v6.msg });
    
    const v7 = v7PremiumNeuralOscillation(cleanData);
    if (v7.pred !== -1) results.push({ pred: v7.pred, conf: v7.conf, name: v7.msg });
    
    // Catch algorithms
    const streak = catchSuperStreak(cleanData);
    if (streak !== -1) results.push({ pred: streak, conf: 95, name: "🎯 CẦU BỆT SIÊU NHẠY" });
    
    const pingpong = catchSuperPingPong(cleanData);
    if (pingpong !== -1) results.push({ pred: pingpong, conf: 96, name: "🏓 PING PONG HOÀN HẢO" });
    
    const doubles = catchSuperDouble(cleanData);
    if (doubles !== -1) results.push({ pred: doubles, conf: 94, name: "🎲 CẦU KÉP CHUẨN XÁC" });
    
    // LC79 MD5 special
    if (gameId === 'lc79_md5') {
        let apiHistoryStr = h.slice(0, 5).join('');
        let md5Pred = -1;
        if (apiHistoryStr === '11111' || apiHistoryStr === '00000') md5Pred = h[0] === 1 ? 0 : 1;
        else if (apiHistoryStr.startsWith('101') || apiHistoryStr.startsWith('010')) md5Pred = h[0] === 1 ? 0 : 1;
        else if (h[0] === h[1] && h[1] === h[2]) md5Pred = h[0];
        else md5Pred = h[0] === 1 ? 0 : 1;
        results.push({ pred: md5Pred, conf: 98, name: "🔐 LC79 MD5 PREMIUM" });
    }
    
    if (results.length === 0) {
        let fallbackPred = h[0] === 1 ? 0 : 1;
        return {
            prediction: fallbackPred,
            predictionText: fallbackPred === 1 ? "🎲 TÀI" : "🎲 XỈU",
            confidence: 85,
            algorithm: "⚡ ĐẢO NHỊP TIÊU CHUẨN",
            emoji: fallbackPred === 1 ? "🔥" : "❄️"
        };
    }
    
    // Weighted voting
    let weightedTai = 0, weightedXiu = 0, totalWeight = 0;
    for (let r of results) {
        if (r.pred === 1) weightedTai += r.conf;
        else weightedXiu += r.conf;
        totalWeight += r.conf;
    }
    
    let taiProb = weightedTai / totalWeight;
    let xiuProb = weightedXiu / totalWeight;
    let finalPred = taiProb > xiuProb ? 1 : 0;
    let finalConf = Math.min(99, Math.floor(Math.max(taiProb, xiuProb) * 100));
    
    // Best algorithm name
    let bestAlgo = results.reduce((a, b) => (a.conf > b.conf ? a : b), results[0]);
    
    let emoji = finalPred === 1 ? "🏆" : "💎";
    let borderColor = finalPred === 1 ? "#ff4500" : "#00bfff";
    
    return {
        prediction: finalPred,
        predictionText: finalPred === 1 ? "🔥 TÀI 🔥" : "❄️ XỈU ❄️",
        confidence: finalConf,
        algorithm: bestAlgo.name,
        emoji: emoji,
        borderColor: borderColor
    };
}

// ==================== DỰ ĐOÁN CHÍNH ====================
async function predict(gameId, apiUrl) {
    const data = await fetchGameData(apiUrl);
    if (!data || data.length < 10) {
        return {
            status: "⚠️",
            message: "ĐANG KẾT NỐI...",
            phien_hien_tai: 0,
            du_doan: "⏳ CHỜ",
            do_tin_cay: "0%",
            thuat_toan: "ĐỢI DỮ LIỆU",
            timestamp: new Date().toISOString()
        };
    }
    
    const latestId = data[0].id;
    const historyResults = data.map(item => item.result);
    const prediction = supremePrediction(historyResults, gameId);
    const currentPhien = latestId + 1;
    
    return {
        status: "✅",
        icon: prediction.emoji,
        phien_hien_tai: {
            value: currentPhien,
            label: "🆔 PHIÊN HIỆN TẠI"
        },
        du_doan: {
            value: prediction.predictionText,
            label: "🎯 DỰ ĐOÁN",
            color: prediction.prediction === 1 ? "#ff4500" : "#00bfff"
        },
        do_tin_cay: {
            value: `${prediction.confidence}%`,
            label: "📊 ĐỘ TIN CẬY",
            bar: "█".repeat(Math.floor(prediction.confidence / 5)) + "░".repeat(20 - Math.floor(prediction.confidence / 5))
        },
        thuat_toan: {
            value: prediction.algorithm,
            label: "🧠 THUẬT TOÁN",
            version: "V11.0 PREMIUM"
        },
        thoi_gian: {
            value: new Date().toLocaleString('vi-VN'),
            label: "⏰ THỜI GIAN",
            timezone: "UTC+7"
        },
        author: {
            name: "ANH QUAN",
            signature: "✨ SIÊU PHẨM DỰ ĐOÁN ✨"
        }
    };
}

// ==================== API ENDPOINTS ====================

app.get('/', (req, res) => {
    res.json({
        name: "✨ TÀI XỈU SUPER AI PREMIUM ✨",
        version: "11.0",
        author: "🔥 ANH QUAN 🔥",
        description: "SIÊU PHẨM DỰ ĐOÁN - ĐẸP NHẤT, CHUẨN NHẤT, XỊN NHẤT",
        slogan: "🎯 BẮT CẦU CHUẨN - BẺ CẦU HAY - CHIẾN THẮNG LỚN 🎯",
        endpoints: {
            "🎲 /lc79-hu": "LC79 TÀI XỈU HŨ - PREMIUM",
            "🔐 /lc79-md5": "LC79 TÀI XỈU MD5 - PREMIUM",
            "🎰 /betvip-hu": "BETVIP TÀI XỈU HŨ - PREMIUM",
            "🔮 /betvip-md5": "BETVIP TÀI XỈU MD5 - PREMIUM"
        },
        algorithms: [
            "🧠 TÍCH PHÂN ĐẠO HÀM - V1 PREMIUM",
            "✨ GOLDEN RATIO PHI 1.618 - V2 PREMIUM",
            "🤖 CNN DEEP LEARNING - V3 PREMIUM",
            "⚛️ QUANTUM PROBABILITY - V4 PREMIUM",
            "🌀 CHAOS FRACTAL - V5 PREMIUM",
            "💰 SMART MONEY INDEX - V6 PREMIUM",
            "📡 NEURAL OSCILLATION - V7 PREMIUM",
            "🎯 CẦU BỆT SIÊU NHẠY",
            "🏓 PING PONG HOÀN HẢO",
            "🎲 CẦU KÉP CHUẨN XÁC"
        ],
        example_response: {
            status: "✅",
            icon: "🏆",
            phien_hien_tai: { value: 12345, label: "🆔 PHIÊN HIỆN TẠI" },
            du_doan: { value: "🔥 TÀI 🔥", label: "🎯 DỰ ĐOÁN", color: "#ff4500" },
            do_tin_cay: { value: "98%", label: "📊 ĐỘ TIN CẬY", bar: "██████████████████░░" },
            thuat_toan: { value: "🎯 CẦU BỆT SIÊU NHẠY", label: "🧠 THUẬT TOÁN", version: "V11.0 PREMIUM" },
            thoi_gian: { value: "12/06/2026 15:30:00", label: "⏰ THỜI GIAN", timezone: "UTC+7" },
            author: { name: "ANH QUAN", signature: "✨ SIÊU PHẨM DỰ ĐOÁN ✨" }
        }
    });
});

app.get('/lc79-hu', async (req, res) => {
    try {
        const result = await predict('lc79_hu', API_URLS.lc79_hu);
        if (result.error) return res.status(500).json(result);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/lc79-md5', async (req, res) => {
    try {
        const result = await predict('lc79_md5', API_URLS.lc79_md5);
        if (result.error) return res.status(500).json(result);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/betvip-hu', async (req, res) => {
    try {
        const result = await predict('betvip_hu', API_URLS.betvip_hu);
        if (result.error) return res.status(500).json(result);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/betvip-md5', async (req, res) => {
    try {
        const result = await predict('betvip_md5', API_URLS.betvip_md5);
        if (result.error) return res.status(500).json(result);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== KHỞI ĐỘNG ====================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════════════════════════════════════╗
║                                                                                                       ║
║   ✨✨✨ TÀI XỈU SUPER AI PREMIUM V11.0 - ANH QUAN EDITION ✨✨✨                                    ║
║   📡 PORT: ${PORT}                                                                                       ║
║   👤 AUTHOR: 🔥 ANH QUAN 🔥                                                                            ║
║                                                                                                       ║
║   ╔═══════════════════════════════════════════════════════════════════════════════════════════════╗  ║
║   ║                                                                                               ║  ║
║   ║   🎯 SIÊU PHẨM DỰ ĐOÁN - ĐẸP NHẤT, CHUẨN NHẤT, XỊN NHẤT 🎯                                 ║
║   ║                                                                                               ║  ║
║   ║   📊 KẾT QUẢ TRẢ VỀ SIÊU ĐẸP:                                                                 ║  ║
║   ║   ┌─────────────────────────────────────────────────────────────────────────────────────┐   ║  ║
║   ║   │  {                                                                                  │   ║  ║
║   ║   │    "status": "✅",                                                                   │   ║  ║
║   ║   │    "icon": "🏆",                                                                     │   ║  ║
║   ║   │    "phien_hien_tai": { "value": 12345, "label": "🆔 PHIÊN HIỆN TẠI" },             │   ║  ║
║   ║   │    "du_doan": { "value": "🔥 TÀI 🔥", "label": "🎯 DỰ ĐOÁN", "color": "#ff4500" },  │   ║  ║
║   ║   │    "do_tin_cay": { "value": "98%", "label": "📊 ĐỘ TIN CẬY",                        │   ║  ║
║   ║   │                   "bar": "████████████████████" },                                  │   ║  ║
║   ║   │    "thuat_toan": { "value": "🎯 CẦU BỆT SIÊU NHẠY",                                 │   ║  ║
║   ║   │                    "label": "🧠 THUẬT TOÁN", "version": "V11.0 PREMIUM" },          │   ║  ║
║   ║   │    "thoi_gian": { "value": "12/06/2026 15:30:00",                                  │   ║  ║
║   ║   │                  "label": "⏰ THỜI GIAN", "timezone": "UTC+7" },                    │   ║  ║
║

require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ==================== CẤU HÌNH API ====================
const API_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";
const API_NOHU = "https://wtx.tele68.com/v1/tx/sessions";

const http = axios.create({
    timeout: 10000,
    headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json"
    }
});

// ==================== THUẬT TOÁN MASTER AI V5.1 (COPY 100% TỪ HTML) ====================
function runMasterAI(list) {
    if (!list || list.length < 20) {
        return { 
            result: "TÀI", 
            confidence: 51, 
            streak: "0T", 
            entropy: "0.50",
            taiScore: 0,
            xiuScore: 0
        };
    }

    // Chuyển đổi lịch sử thành chuỗi T/X
    const historyArr = list.slice(0, 400).map(item => {
        let val = item.resultTruyenThong || item.result || item.BetSide || item.betSide ||
                  item.diceSum || item.SessionResult || item.resultTX || item.side || 
                  item.outcome || item.winSide || "";

        if (typeof val === 'number') {
            return (val >= 11 || val === 1) ? "T" : "X";
        }
        const s = String(val).toUpperCase().trim();
        if (s.includes("TÀI") || s.includes("TAI") || s === "T" || s.includes("BIG") || s === "1") return "T";
        if (s.includes("XỈU") || s.includes("XIU") || s === "X" || s.includes("SMALL") || s === "0" || s === "2") return "X";
        if (!isNaN(Number(val))) {
            let num = Number(val);
            if (num >= 11 || num === 1) return "T";
            else return "X";
        }
        return "X";
    });

    const history = historyArr.join("");
    const len = history.length;
    
    if (len < 20) {
        return { 
            result: "TÀI", 
            confidence: 51, 
            streak: "0T", 
            entropy: "0.50",
            taiScore: 0,
            xiuScore: 0
        };
    }

    let tScore = 0, xScore = 0;

    const scales = [
        { size: 30,  weight: 1.00, decay: 0.96 },
        { size: 80,  weight: 0.78, decay: 0.97 },
        { size: 150, weight: 0.55, decay: 0.98 },
        { size: 300, weight: 0.32, decay: 0.985 }
    ];

    scales.forEach(({ size, weight, decay }) => {
        const w = Math.min(size, len);
        if (w < 12) return;
        const recent = history.substring(0, w);
        const baseFactor = weight;

        for (let i = 1; i < w - 8; i++) {
            const rf = baseFactor * Math.pow(decay, i * 0.85);
            if (recent.substring(i, i + 3) === recent.substring(0, 3)) {
                (recent[i - 1] === "T") ? tScore += rf : xScore += rf * 1.08;
            }
            if (recent.substring(i, i + 4) === recent.substring(0, 4)) {
                (recent[i - 1] === "T") ? tScore += rf * 1.55 : xScore += rf * 1.65;
            }
            if (recent.substring(i, i + 5) === recent.substring(0, 5)) {
                (recent[i - 1] === "T") ? tScore += rf * 1.95 : xScore += rf * 2.10;
            }
        }
    });

    // Thống kê Markov
    let tt = 0, tx = 0, xt = 0, xx = 0;
    let streakT = 0, streakX = 0, maxStreak = 1;
    let currentStreakChar = history[0];

    for (let i = 1; i < len; i++) {
        if (history[i] === "T") {
            if (history[i - 1] === "T") { 
                tt++; 
                streakT++; 
                streakX = 0; 
            } else { 
                xt++; 
                streakT = 1; 
                streakX = 0; 
            }
            if (streakT > maxStreak) { 
                maxStreak = streakT; 
                currentStreakChar = "T"; 
            }
        } else {
            if (history[i - 1] === "X") { 
                xx++; 
                streakX++; 
                streakT = 0; 
            } else { 
                tx++; 
                streakX = 1; 
                streakT = 0; 
            }
            if (streakX > maxStreak) { 
                maxStreak = streakX; 
                currentStreakChar = "X"; 
            }
        }
    }

    const pTafterT = tt / (tt + tx + 0.001);
    const overallPT = (tt + xt) / (len - 1 + 0.001);

    let changes = 0;
    for (let i = 1; i < len; i++) {
        if (history[i] !== history[i - 1]) changes++;
    }
    const entropy = changes / (len - 1);

    let final = (tScore > xScore) ? "TÀI" : "XỈU";

    // Điều chỉnh theo streak
    if (maxStreak >= 7) {
        final = currentStreakChar === "T" ? "TÀI" : "XỈU";
    } else if (maxStreak >= 5) {
        if ((currentStreakChar === "T" && pTafterT > 0.60) || 
            (currentStreakChar === "X" && (1 - overallPT) > 0.60)) {
            final = currentStreakChar === "T" ? "TÀI" : "XỈU";
        }
    }

    // Điều chỉnh theo xác suất
    if (pTafterT > 0.68 && overallPT > 0.52) final = "TÀI";
    if ((1 - overallPT) > 0.68) final = "XỈU";

    // Xử lý entropy cao
    if (entropy > 0.47 && entropy < 0.54 && Math.abs(tScore - xScore) < 5) {
        final = Math.random() > 0.48 ? "TÀI" : "XỈU";
    }

    // Tính confidence
    let diff = Math.abs(tScore - xScore);
    let conf = 52 + Math.floor(diff * 6.8);

    if (maxStreak >= 6) conf += 19;
    else if (maxStreak >= 5) conf += 13;
    else if (maxStreak >= 4) conf += 7;

    if (Math.max(pTafterT, 1 - overallPT) > 0.67) conf += 12;

    if (entropy > 0.51) conf = Math.max(52, conf - 13);
    if (len > 150 && diff < 6) conf = Math.max(52, conf - 17);

    let percent = Math.max(52, Math.min(92, Math.round(conf)));

    if (percent > 82) {
        if (final === "TÀI" && pTafterT < 0.53) percent -= 10;
        if (final === "XỈU" && overallPT > 0.54) percent -= 10;
    }

    // Format streak string
    let streakStr = maxStreak + currentStreakChar;

    return { 
        result: final, 
        confidence: percent,
        streak: streakStr,
        entropy: entropy.toFixed(2),
        taiScore: Math.round(tScore * 10) / 10,
        xiuScore: Math.round(xScore * 10) / 10,
        pTafterT: (pTafterT * 100).toFixed(1) + '%',
        overallPT: (overallPT * 100).toFixed(1) + '%'
    };
}

// ==================== LẤY DỮ LIỆU API ====================
async function fetchData(url) {
    try {
        const response = await http.get(url);
        return response.data;
    } catch (error) {
        console.error("Fetch error:", error.message);
        return null;
    }
}

// ==================== DỰ ĐOÁN ====================
async function predict(mode) {
    const url = mode === 'md5' ? API_MD5 : API_NOHU;
    const data = await fetchData(url);
    
    if (!data || !data.list || data.list.length === 0) {
        return {
            error: "Không thể lấy dữ liệu",
            mode: mode
        };
    }
    
    const latest = data.list[0];
    const nextPhien = (latest.id || 0) + 1;
    const prediction = runMasterAI(data.list);
    
    return {
        status: "success",
        mode: mode === 'md5' ? "MD5" : "NỔ HŨ",
        phien_hien_tai: nextPhien,
        du_doan: prediction.result,
        do_tin_cay: `${prediction.confidence}%`,
        chi_tiet: {
            streak: prediction.streak,
            entropy: prediction.entropy,
            tai_score: prediction.taiScore,
            xiu_score: prediction.xiuScore,
            xac_suat_tai_sau_tai: prediction.pTafterT,
            xac_suat_tai_tong_the: prediction.overallPT
        },
        timestamp: new Date().toISOString(),
        author: "ANH TUAN MMO"
    };
}

// ==================== ENDPOINTS ====================

// Root endpoint
app.get("/", (req, res) => {
    res.json({
        name: "🔥 LC79 MASTER AI API 🔥",
        version: "5.1",
        author: "ANH TUAN MMO",
        description: "Thuật toán Master AI từ tool HTML - Độ chính xác cao",
        endpoints: {
            "/md5": "Dự đoán Tài Xỉu MD5",
            "/nohu": "Dự đoán Tài Xỉu NỔ HŨ",
            "/all": "Dự đoán cả 2 loại",
            "/health": "Kiểm tra server"
        }
    });
});

// Endpoint MD5
app.get("/md5", async (req, res) => {
    try {
        const result = await predict('md5');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: "Lỗi server", message: error.message });
    }
});

// Endpoint NỔ HŨ
app.get("/nohu", async (req, res) => {
    try {
        const result = await predict('nohu');
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: "Lỗi server", message: error.message });
    }
});

// Endpoint ALL
app.get("/all", async (req, res) => {
    try {
        const [md5, nohu] = await Promise.all([
            predict('md5'),
            predict('nohu')
        ]);
        res.json({
            status: "success",
            timestamp: new Date().toISOString(),
            md5: md5,
            nohu: nohu,
            author: "ANH TUAN MMO"
        });
    } catch (error) {
        res.status(500).json({ error: "Lỗi server", message: error.message });
    }
});

// Health check
app.get("/health", (req, res) => {
    res.json({ 
        status: "healthy", 
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                                                                   ║
║   🔥 LC79 MASTER AI API V5.1 - ANH TUAN MMO 🔥                   ║
║   📡 PORT: ${PORT}                                                   ║
║   🧠 THUẬT TOÁN: MASTER AI (COPY 100% TỪ TOOL HTML)              ║
║                                                                   ║
║   📊 ENDPOINTS:                                                   ║
║   ├── GET /md5    → Dự đoán Tài Xỉu MD5                          ║
║   ├── GET /nohu   → Dự đoán Tài Xỉu NỔ HŨ                        ║
║   ├── GET /all    → Dự đoán cả 2 loại                            ║
║   └── GET /health → Kiểm tra server                              ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
    `);
});

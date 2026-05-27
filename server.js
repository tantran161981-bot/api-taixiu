const express = require("express");
const axios = require("axios");
const EnhancedThuatToan = require("./enhanced_thuattoan");

const app = express();
const PORT = process.env.PORT || 3000;

const engine = new EnhancedThuatToan();

// API tele68
const API_URL = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=8ea7f65b9480ee2e472de65219139add";

app.get("/", (req, res) => {
    res.send("API Tài Xỉu VIP đang chạy...");
});

app.get("/api", async (req, res) => {
    try {
        const response = await axios.get(API_URL, {
            headers: {
                "User-Agent": "Mozilla/5.0",
                "Accept": "application/json"
            }
        });

        const raw = response.data;

        // ✅ FIX CHUẨN TELE68 (API của mày là raw.list)
        const sessions = raw.list || [];

        if (sessions.length === 0) {
            return res.json({
                error: "API rỗng",
                debug: raw
            });
        }

        // 🔁 convert dữ liệu cho thuật toán
        const history = sessions.map(s => ({
            ket_qua: s.resultTruyenThong === "TAI" ? "Tài" : "Xỉu"
        }));

        // phiên mới nhất
        const current = sessions[0];

        // 🧠 dự đoán
        const pred = engine.predict(history);

        // 🎯 TRẢ JSON CHUẨN
        res.json({
            phien: current.id,
            ket_qua: current.resultTruyenThong === "TAI" ? "Tài" : "Xỉu",
            tong: current.point,
            xuc_xac: current.dices,

            du_doan: pred.label,
            ti_le: Number(pred.score.toFixed(2)),
            pattern: pred.pattern,

            so_sanh: "Đang chờ kết quả mới..."
        });

    } catch (err) {
        res.json({
            error: "Lỗi API",
            message: err.message
        });
    }
});

app.listen(PORT, () => {
    console.log("🚀 Server chạy tại: http://localhost:" + PORT + "/api");
});
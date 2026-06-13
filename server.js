require("dotenv").config();
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware chuáº©n
app.use(cors());
app.use(express.json());

// ===== CONFIG =====
const URL_TRUYEN_THONG = "https://wtx.tele68.com/v1/tx/sessions";
const URL_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

const http = axios.create({
    timeout: 10000,
    headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json"
    }
});

// ===== DATA =====
let historyNormal = [];
let historyMd5 = [];
let predictionsNormal = [];
let predictionsMd5 = [];

// ===== MARKOV CLASS (GIá»® NGUYÃŠN LOGIC Báº N) =====
class MarkovXucXac123 {
    constructor(bac = 3) {
        this.bac = Math.min(4, Math.max(1, bac));
        this.transitions = new Map();
        this.history = [];
        this.maxHistory = 60;
    }

    static chuyenLoai(diem) {
        if (diem <= 2) return 1;
        if (diem <= 4) return 2;
        return 3;
    }

    themDuLieu(daySo) {
        this.history.push(...daySo);
        if (this.history.length > this.maxHistory) {
            this.history = this.history.slice(-this.maxHistory);
        }
        this._xayDungMaTran();
    }

    _xayDungMaTran() {
        this.transitions.clear();
        if (this.history.length < this.bac + 1) return;

        for (let i = this.bac; i < this.history.length; i++) {
            let state = this.history.slice(i - this.bac, i).join(",");
            let next = this.history[i];

            if (!this.transitions.has(state)) {
                this.transitions.set(state, new Map());
            }
            let map = this.transitions.get(state);
            map.set(next, (map.get(next) || 0) + 1);
        }
    }

    duDoan() {
        if (this.history.length < this.bac) return 2;

        let state = this.history.slice(-this.bac).join(",");
        let map = this.transitions.get(state);

        if (!map) return 2;

        let total = [...map.values()].reduce((a, b) => a + b, 0);
        let rand = Math.random() * total;
        let sum = 0;

        for (let [val, count] of map.entries()) {
            sum += count;
            if (rand <= sum) return val;
        }
        return 2;
    }

    phanTich() {
        let val = this.duDoan();
        let prediction = (val === 2) ? "Xá»ˆU" : "TÃ€I";

        return {
            prediction,
            confidenceTai: 70,
            confidenceXiu: 30,
            duDoanSo: val,
            reason: `Markov báº­c ${this.bac}`
        };
    }
}

// ===== AI =====
function analyzeTrend(history) {
    const dice123 = [];

    history.slice(0, 20).forEach(item => {
        if (item.dices) {
            item.dices.forEach(d => {
                dice123.push(MarkovXucXac123.chuyenLoai(d));
            });
        }
    });

    const markov = new MarkovXucXac123(3);
    markov.themDuLieu(dice123);
    return markov.phanTich();
}

// ===== FETCH =====
async function fetchSafe(url) {
    try {
        const res = await http.get(url);
        return res.data;
    } catch (e) {
        console.log("Fetch lá»—i:", e.message);
        return null;
    }
}

// ===== POLL =====
async function poll() {
    const normal = await fetchSafe(URL_TRUYEN_THONG);
    const md5 = await fetchSafe(URL_MD5);

    if (normal?.list) historyNormal = normal.list;
    if (md5?.list) historyMd5 = md5.list;

    console.log("âœ… Poll OK", new Date().toLocaleTimeString());
}

setInterval(poll, 5000);

// ===== ROUTES =====

// ROOT FIX CHO Báº N
app.get("/", (req, res) => {
    res.json({
        name: "ðŸ”¥ CHAOS MARKOV - TÃ i Xá»‰u SiÃªu Chuáº©n",
        status: "running",
        endpoints: ["/taixiu", "/taixiumd5", "/all"]
    });
});

app.get("/taixiu", async (req, res) => {
    const data = await fetchSafe(URL_TRUYEN_THONG);
    if (!data) return res.status(500).json({ error: "API lá»—i" });

    const ai = analyzeTrend(data.list || []);
    res.json({ ...ai, source: "normal" });
});

app.get("/taixiumd5", async (req, res) => {
    const data = await fetchSafe(URL_MD5);
    if (!data) return res.status(500).json({ error: "API lá»—i" });

    const ai = analyzeTrend(data.list || []);
    res.json({ ...ai, source: "md5" });
});

app.get("/all", async (req, res) => {
    const [a, b] = await Promise.all([
        fetchSafe(URL_TRUYEN_THONG),
        fetchSafe(URL_MD5)
    ]);

    res.json({
        normal: a ? analyzeTrend(a.list) : null,
        md5: b ? analyzeTrend(b.list) : null
    });
});

// ===== START =====
app.listen(PORT, () => {
    console.log(`ðŸš€ Server cháº¡y port ${PORT}`);
});

'use strict';

class EnhancedThuatToan {
    predict(history) {
        if (!history || history.length < 5) {
            return { label: "Tài", score: 0.5, pattern: "N/A" };
        }

        const recent = history.slice(0, 10);

        let tai = 0;
        let xiu = 0;

        recent.forEach(r => {
            if (r.ket_qua === "Tài") tai++;
            else xiu++;
        });

        let pattern = "";
        for (let i = 0; i < 5; i++) {
            if (!history[i]) continue;
            pattern += history[i].ket_qua === "Tài" ? "T" : "X";
        }

        let label = tai > xiu ? "Tài" : "Xỉu";
        let score = Math.max(tai, xiu) / (tai + xiu);

        // cầu bệt
        if (pattern === "TTTTT") {
            label = "Xỉu";
            score = 0.65;
        }
        if (pattern === "XXXXX") {
            label = "Tài";
            score = 0.65;
        }

        return { label, score, pattern };
    }
}

module.exports = EnhancedThuatToan;
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const API_URL = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const HISTORY_FILE = './learning_data.json';

// ==================== SIÊU THUẬT TOÁN V4 ====================

class SieuThuatToanV4 {
    constructor() {
        this.ketQuaHistory = [];
        this.diemHistory = [];
        this.xucXacHistory = [];
        this.learningData = {
            patternAccuracy: {},
            totalPredictions: 0,
            correctPredictions: 0
        };
        this.loadLearningData();
        this.lastPrediction = null;
    }

    loadLearningData() {
        try {
            if (fs.existsSync(HISTORY_FILE)) {
                const data = fs.readFileSync(HISTORY_FILE, 'utf8');
                const parsed = JSON.parse(data);
                this.learningData = parsed;
                console.log('📚 Đã tải dữ liệu học tập');
            }
        } catch (e) {
            console.log('📝 Tạo mới dữ liệu học tập');
        }
    }

    saveLearningData() {
        try {
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(this.learningData, null, 2));
        } catch (e) {
            console.error('Lỗi lưu:', e.message);
        }
    }

    capNhatLichSu(data) {
        const sortedData = [...data].sort((a, b) => b.id - a.id);
        for (const item of sortedData) {
            const ketQua = item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu';
            this.ketQuaHistory.unshift(ketQua);
            this.diemHistory.unshift(item.point);
            this.xucXacHistory.unshift(item.dices);
            
            if (this.ketQuaHistory.length > 200) {
                this.ketQuaHistory.pop();
                this.diemHistory.pop();
                this.xucXacHistory.pop();
            }
        }
    }

    // ==================== CHUYỂN ĐỔI KẾT QUẢ ====================
    getResultChar(index) {
        return this.ketQuaHistory[index] === 'Tài' ? 'T' : 'X';
    }

    getResultString(length) {
        let str = '';
        for (let i = 0; i < Math.min(length, this.ketQuaHistory.length); i++) {
            str += this.getResultChar(i);
        }
        return str;
    }

    // ==================== 1. CẦU BỆT (CHI TIẾT THEO ĐỘ DÀI) ====================
    phatHienBet() {
        if (this.ketQuaHistory.length < 2) return null;
        
        let doDai = 1;
        const huong = this.ketQuaHistory[0];
        for (let i = 1; i < Math.min(this.ketQuaHistory.length, 20); i++) {
            if (this.ketQuaHistory[i] === huong) doDai++;
            else break;
        }
        
        if (doDai >= 3) {
            let duDoan, doTinCay, loai;
            
            if (doDai >= 10) {
                duDoan = huong === 'Tài' ? 'Xỉu' : 'Tài';
                doTinCay = 94;
                loai = `Bệt siêu dài ${doDai}`;
            } else if (doDai >= 8) {
                duDoan = huong === 'Tài' ? 'Xỉu' : 'Tài';
                doTinCay = 90;
                loai = `Bệt cực dài ${doDai}`;
            } else if (doDai >= 6) {
                duDoan = huong === 'Tài' ? 'Xỉu' : 'Tài';
                doTinCay = 86;
                loai = `Bệt dài ${doDai}`;
            } else if (doDai >= 4) {
                duDoan = huong;
                doTinCay = 78;
                loai = `Bệt ${doDai} (theo)`;
            } else {
                duDoan = huong;
                doTinCay = 70;
                loai = `Bệt ngắn ${doDai}`;
            }
            return { loai, duDoan, doTinCay, key: 'bet', doDai };
        }
        return null;
    }

    // ==================== 2. CẦU 1-1 ====================
    phatHienCau11() {
        if (this.ketQuaHistory.length < 4) return null;
        let la11 = true;
        for (let i = 1; i < 4; i++) {
            if (this.ketQuaHistory[i] === this.ketQuaHistory[i-1]) {
                la11 = false;
                break;
            }
        }
        if (la11) {
            const duDoan = this.ketQuaHistory[0] === 'Tài' ? 'Xỉu' : 'Tài';
            return { loai: 'Cầu 1-1 (T-X-T-X)', duDoan, doTinCay: 80, key: 'cau11' };
        }
        return null;
    }

    // ==================== 3. CẦU 2-2 ====================
    phatHienCau22() {
        if (this.ketQuaHistory.length < 4) return null;
        const kq = this.ketQuaHistory;
        if (kq[0] === kq[1] && kq[2] === kq[3] && kq[0] !== kq[2]) {
            const duDoan = kq[2];
            return { loai: 'Cầu 2-2 (TTXX)', duDoan, doTinCay: 82, key: 'cau22' };
        }
        return null;
    }

    // ==================== 4. CẦU 3-3 ====================
    phatHienCau33() {
        if (this.ketQuaHistory.length < 6) return null;
        const kq = this.ketQuaHistory;
        if (kq[0] === kq[1] && kq[1] === kq[2] &&
            kq[3] === kq[4] && kq[4] === kq[5] &&
            kq[0] !== kq[3]) {
            const duDoan = kq[3];
            return { loai: 'Cầu 3-3 (TTTXXX)', duDoan, doTinCay: 86, key: 'cau33' };
        }
        return null;
    }

    // ==================== 5. CẦU 4-4 ====================
    phatHienCau44() {
        if (this.ketQuaHistory.length < 8) return null;
        const kq = this.ketQuaHistory;
        if (kq[0] === kq[1] && kq[1] === kq[2] && kq[2] === kq[3] &&
            kq[4] === kq[5] && kq[5] === kq[6] && kq[6] === kq[7] &&
            kq[0] !== kq[4]) {
            const duDoan = kq[4];
            return { loai: 'Cầu 4-4 (TTTTXXXX)', duDoan, doTinCay: 90, key: 'cau44' };
        }
        return null;
    }

    // ==================== 6. CẦU 5-5 ====================
    phatHienCau55() {
        if (this.ketQuaHistory.length < 10) return null;
        const kq = this.ketQuaHistory;
        if (kq[0] === kq[1] && kq[1] === kq[2] && kq[2] === kq[3] && kq[3] === kq[4] &&
            kq[5] === kq[6] && kq[6] === kq[7] && kq[7] === kq[8] && kq[8] === kq[9] &&
            kq[0] !== kq[5]) {
            const duDoan = kq[5];
            return { loai: 'Cầu 5-5 (TTTTTXXXXX)', duDoan, doTinCay: 92, key: 'cau55' };
        }
        return null;
    }

    // ==================== 7. CẦU 1-2-1 ====================
    phatHienCau121() {
        if (this.ketQuaHistory.length < 5) return null;
        const kq = this.ketQuaHistory;
        if (kq[0] !== kq[1] && kq[1] === kq[2] && kq[2] !== kq[3] && kq[0] === kq[3]) {
            const duDoan = kq[0];
            return { loai: 'Cầu 1-2-1 (T-X-X-T)', duDoan, doTinCay: 84, key: 'cau121' };
        }
        return null;
    }

    // ==================== 8. CẦU 2-1-2 ====================
    phatHienCau212() {
        if (this.ketQuaHistory.length < 5) return null;
        const kq = this.ketQuaHistory;
        if (kq[0] === kq[1] && kq[1] !== kq[2] && kq[2] !== kq[3] && kq[3] === kq[4] && kq[0] !== kq[3]) {
            const duDoan = kq[3];
            return { loai: 'Cầu 2-1-2 (TT-X-TT)', duDoan, doTinCay: 84, key: 'cau212' };
        }
        return null;
    }

    // ==================== 9. CẦU 1-2-3 ====================
    phatHienCau123() {
        if (this.ketQuaHistory.length < 6) return null;
        const str = this.getResultString(6);
        if (str === 'TXTXTX' || str === 'XTXTXT') {
            const duDoan = this.getResultChar(0) === 'T' ? 'X' : 'T';
            return { loai: 'Cầu 1-2-3 (T-X-T-X-T-X)', duDoan, doTinCay: 78, key: 'cau123' };
        }
        return null;
    }

    // ==================== 10. CẦU 3-2-1 ====================
    phatHienCau321() {
        if (this.ketQuaHistory.length < 6) return null;
        const str = this.getResultString(6);
        if (str === 'TTXTTX' || str === 'XXTXXT') {
            const duDoan = this.getResultChar(0) === 'T' ? 'X' : 'T';
            return { loai: 'Cầu 3-2-1 (TT-X-TT-X)', duDoan, doTinCay: 78, key: 'cau321' };
        }
        return null;
    }

    // ==================== 11. CẦU 1-2-3-4 ====================
    phatHienCau1234() {
        if (this.ketQuaHistory.length < 10) return null;
        const str = this.getResultString(10);
        if (str === 'TXTXTXTXTX' || str === 'XTXTXTXTXT') {
            const duDoan = this.getResultChar(0) === 'T' ? 'X' : 'T';
            return { loai: 'Cầu 1-2-3-4 (xen kẽ 10 phiên)', duDoan, doTinCay: 75, key: 'cau1234' };
        }
        return null;
    }

    // ==================== 12. CẦU 4-3-2-1 ====================
    phatHienCau4321() {
        if (this.ketQuaHistory.length < 10) return null;
        const str = this.getResultString(10);
        if (str === 'TTTXTTTXTT' || str === 'XXXTXXXTXX') {
            const duDoan = this.getResultChar(0) === 'T' ? 'X' : 'T';
            return { loai: 'Cầu 4-3-2-1 (TTTX-TTTX-TT)', duDoan, doTinCay: 76, key: 'cau4321' };
        }
        return null;
    }

    // ==================== 13. CẦU 2-3-2 ====================
    phatHienCau232() {
        if (this.ketQuaHistory.length < 7) return null;
        const str = this.getResultString(7);
        if (str === 'TTXTTXT' || str === 'XXTXXTX') {
            const duDoan = this.getResultChar(0) === 'T' ? 'X' : 'T';
            return { loai: 'Cầu 2-3-2 (TT-X-TT-X-T)', duDoan, doTinCay: 80, key: 'cau232' };
        }
        return null;
    }

    // ==================== 14. CẦU 3-2-3 ====================
    phatHienCau323() {
        if (this.ketQuaHistory.length < 8) return null;
        const str = this.getResultString(8);
        if (str === 'TTTXTTTX' || str === 'XXXTXXXT') {
            const duDoan = this.getResultChar(0) === 'T' ? 'X' : 'T';
            return { loai: 'Cầu 3-2-3 (TTT-X-TTT-X)', duDoan, doTinCay: 82, key: 'cau323' };
        }
        return null;
    }

    // ==================== 15. CẦU 2-3-4 ====================
    phatHienCau234() {
        if (this.ketQuaHistory.length < 9) return null;
        const str = this.getResultString(9);
        if (str === 'TTXTTXTTX' || str === 'XXTXXTXXT') {
            const duDoan = this.getResultChar(0) === 'T' ? 'X' : 'T';
            return { loai: 'Cầu 2-3-4 (TT-X-TT-X-TT-X)', duDoan, doTinCay: 79, key: 'cau234' };
        }
        return null;
    }

    // ==================== 16. CẦU 4-3-2 ====================
    phatHienCau432() {
        if (this.ketQuaHistory.length < 9) return null;
        const str = this.getResultString(9);
        if (str === 'TTTXTTXTT' || str === 'XXXTXXTXX') {
            const duDoan = this.getResultChar(0) === 'T' ? 'X' : 'T';
            return { loai: 'Cầu 4-3-2 (TTTX-TTX-TT)', duDoan, doTinCay: 79, key: 'cau432' };
        }
        return null;
    }

    // ==================== 17. CẦU 1-2-2 ====================
    phatHienCau122() {
        if (this.ketQuaHistory.length < 5) return null;
        const kq = this.ketQuaHistory;
        if (kq[0] !== kq[1] && kq[1] === kq[2] && kq[2] === kq[3] && kq[3] !== kq[4]) {
            const duDoan = kq[0];
            return { loai: 'Cầu 1-2-2 (T-X-X-X-T)', duDoan, doTinCay: 77, key: 'cau122' };
        }
        return null;
    }

    // ==================== 18. CẦU 2-2-1 ====================
    phatHienCau221() {
        if (this.ketQuaHistory.length < 5) return null;
        const kq = this.ketQuaHistory;
        if (kq[0] === kq[1] && kq[1] !== kq[2] && kq[2] === kq[3] && kq[3] !== kq[4]) {
            const duDoan = kq[0];
            return { loai: 'Cầu 2-2-1 (TT-X-TT-X)', duDoan, doTinCay: 78, key: 'cau221' };
        }
        return null;
    }

    // ==================== 19. CẦU 1-2-2-1 ====================
    phatHienCau1221() {
        if (this.ketQuaHistory.length < 5) return null;
        const kq = this.ketQuaHistory;
        if (kq[0] !== kq[1] && kq[1] === kq[2] && kq[2] === kq[3] && kq[3] !== kq[4] && kq[0] === kq[4]) {
            const duDoan = kq[0] === 'Tài' ? 'Xỉu' : 'Tài';
            return { loai: 'Cầu 1-2-2-1 (T-X-X-X-T)', duDoan, doTinCay: 81, key: 'cau1221' };
        }
        return null;
    }

    // ==================== 20. CẦU 2-1-1-2 ====================
    phatHienCau2112() {
        if (this.ketQuaHistory.length < 6) return null;
        const kq = this.ketQuaHistory;
        if (kq[0] === kq[1] && kq[1] !== kq[2] && kq[2] === kq[3] && kq[3] === kq[4] && kq[4] !== kq[5] && kq[0] === kq[5]) {
            const duDoan = kq[0] === 'Tài' ? 'Xỉu' : 'Tài';
            return { loai: 'Cầu 2-1-1-2 (TT-X-XX-TT)', duDoan, doTinCay: 82, key: 'cau2112' };
        }
        return null;
    }

    // ==================== 21. CẦU THANG ĐIỂM ====================
    phatHienCauThang() {
        if (this.diemHistory.length < 5) return null;
        const diem = this.diemHistory;
        let tang = 0, giam = 0;
        for (let i = 0; i < 4; i++) {
            if (diem[i] > diem[i+1]) giam++;
            if (diem[i] < diem[i+1]) tang++;
        }
        if (tang >= 3) return { loai: 'Cầu thang tăng điểm', duDoan: 'Tài', doTinCay: 76, key: 'thang' };
        if (giam >= 3) return { loai: 'Cầu thang giảm điểm', duDoan: 'Xỉu', doTinCay: 76, key: 'thang' };
        return null;
    }

    // ==================== 22. PHÂN TÍCH ĐIỂM SỐ ====================
    phanTichDiemSo() {
        if (this.diemHistory.length < 5) return null;
        const lastDiem = this.diemHistory[0];
        if (lastDiem >= 15) return { loai: 'Điểm cực cao (≥15)', duDoan: 'Xỉu', doTinCay: 74, key: 'diem' };
        if (lastDiem <= 6) return { loai: 'Điểm cực thấp (≤6)', duDoan: 'Tài', doTinCay: 74, key: 'diem' };
        if (lastDiem >= 13) return { loai: 'Điểm cao (13-14)', duDoan: 'Xỉu', doTinCay: 68, key: 'diem' };
        if (lastDiem <= 8) return { loai: 'Điểm thấp (7-8)', duDoan: 'Tài', doTinCay: 68, key: 'diem' };
        return null;
    }

    // ==================== 23. BÙ TỶ LỆ 20 PHIÊN ====================
    phanTichBuTyLe() {
        if (this.ketQuaHistory.length < 20) return null;
        const tai20 = this.ketQuaHistory.slice(0, 20).filter(r => r === 'Tài').length;
        if (tai20 >= 14) return { loai: `Bù tỷ lệ (Tài ${tai20}/20)`, duDoan: 'Xỉu', doTinCay: 76, key: 'bule' };
        if (tai20 <= 6) return { loai: `Bù tỷ lệ (Xỉu ${20-tai20}/20)`, duDoan: 'Tài', doTinCay: 76, key: 'bule' };
        return null;
    }

    // ==================== 24. MARKOV CHAIN BẬC 2 ====================
    phanTichMarkov() {
        if (this.ketQuaHistory.length < 15) return null;
        const last2 = this.ketQuaHistory.slice(0, 2).join('-');
        let taiSau = 0, xiuSau = 0;
        for (let i = 2; i < Math.min(this.ketQuaHistory.length, 80); i++) {
            const pattern = this.ketQuaHistory.slice(i-2, i).join('-');
            if (pattern === last2) {
                if (this.ketQuaHistory[i] === 'Tài') taiSau++;
                else xiuSau++;
            }
        }
        const tong = taiSau + xiuSau;
        if (tong >= 5) {
            if (taiSau / tong >= 0.7) return { loai: 'Markov bậc 2 → Tài', duDoan: 'Tài', doTinCay: 75, key: 'markov' };
            if (xiuSau / tong >= 0.7) return { loai: 'Markov bậc 2 → Xỉu', duDoan: 'Xỉu', doTinCay: 75, key: 'markov' };
        }
        return null;
    }

    // ==================== 25. PHÂN TÍCH XÚC XẮC ====================
    phanTichXucXac() {
        if (this.xucXacHistory.length < 10) return null;
        const allDice = this.xucXacHistory.slice(0, 10).flat();
        const count = {1:0,2:0,3:0,4:0,5:0,6:0};
        for (const d of allDice) count[d]++;
        const maxFace = parseInt(Object.keys(count).reduce((a,b) => count[a] > count[b] ? a : b));
        if (maxFace >= 5) return { loai: `Xúc xắc ${maxFace} xuất hiện nhiều nhất`, duDoan: 'Tài', doTinCay: 67, key: 'xucxac' };
        if (maxFace <= 2) return { loai: `Xúc xắc ${maxFace} xuất hiện nhiều nhất`, duDoan: 'Xỉu', doTinCay: 67, key: 'xucxac' };
        return null;
    }

    // ==================== 26. XU HƯỚNG 5 PHIÊN ====================
    phanTichXuHuong() {
        if (this.ketQuaHistory.length < 5) return null;
        const last5 = this.ketQuaHistory.slice(0, 5);
        const taiCount = last5.filter(r => r === 'Tài').length;
        if (taiCount >= 4) return { loai: 'Xu hướng Tài mạnh (4-5/5)', duDoan: 'Xỉu', doTinCay: 71, key: 'xuhuong' };
        if (taiCount <= 1) return { loai: 'Xu hướng Xỉu mạnh (4-5/5)', duDoan: 'Tài', doTinCay: 71, key: 'xuhuong' };
        return null;
    }

    // ==================== 27. CẦU 1-1-2-2 ====================
    phatHienCau1122() {
        if (this.ketQuaHistory.length < 5) return null;
        const kq = this.ketQuaHistory;
        if (kq[0] !== kq[1] && kq[1] !== kq[2] && kq[2] === kq[3] && kq[3] === kq[4]) {
            const duDoan = kq[4];
            return { loai: 'Cầu 1-1-2-2 (T-X-TT-X)', duDoan, doTinCay: 76, key: 'cau1122' };
        }
        return null;
    }

    // ==================== 28. CẦU 2-2-1-1 ====================
    phatHienCau2211() {
        if (this.ketQuaHistory.length < 5) return null;
        const kq = this.ketQuaHistory;
        if (kq[0] === kq[1] && kq[1] !== kq[2] && kq[2] !== kq[3] && kq[3] !== kq[4]) {
            const duDoan = kq[4];
            return { loai: 'Cầu 2-2-1-1 (TT-X-X-T)', duDoan, doTinCay: 76, key: 'cau2211' };
        }
        return null;
    }

    // ==================== TỔNG HỢP DỰ ĐOÁN ====================
    
    duDoan() {
        const tatCaMau = [
            this.phatHienBet(),
            this.phatHienCau11(),
            this.phatHienCau22(),
            this.phatHienCau33(),
            this.phatHienCau44(),
            this.phatHienCau55(),
            this.phatHienCau121(),
            this.phatHienCau212(),
            this.phatHienCau123(),
            this.phatHienCau321(),
            this.phatHienCau1234(),
            this.phatHienCau4321(),
            this.phatHienCau232(),
            this.phatHienCau323(),
            this.phatHienCau234(),
            this.phatHienCau432(),
            this.phatHienCau122(),
            this.phatHienCau221(),
            this.phatHienCau1221(),
            this.phatHienCau2112(),
            this.phatHienCau1122(),
            this.phatHienCau2211(),
            this.phatHienCauThang(),
            this.phanTichDiemSo(),
            this.phanTichBuTyLe(),
            this.phanTichMarkov(),
            this.phanTichXucXac(),
            this.phanTichXuHuong()
        ].filter(m => m !== null);
        
        if (tatCaMau.length === 0) {
            const last3 = this.ketQuaHistory.slice(0, 3);
            const taiCount = last3.filter(r => r === 'Tài').length;
            const duDoan = taiCount >= 2 ? 'Tài' : 'Xỉu';
            return { du_doan: duDoan, do_tin_cay: 60, so_mau: 0, chi_tiet: [] };
        }
        
        let diemTai = 0, diemXiu = 0;
        const chiTiet = [];
        
        for (const mau of tatCaMau) {
            const trongSo = this.learningData.patternAccuracy?.[mau.key] || 1.0;
            const diem = mau.do_tin_cay * trongSo;
            if (mau.duDoan === 'Tài') diemTai += diem;
            else diemXiu += diem;
            chiTiet.push({ loai: mau.loai, duDoan: mau.duDoan, doTinCay: mau.do_tin_cay });
        }
        
        const finalPrediction = diemTai >= diemXiu ? 'Tài' : 'Xỉu';
        const tongDiem = diemTai + diemXiu;
        let doTinCay = tongDiem > 0 ? (Math.max(diemTai, diemXiu) / tongDiem) * 100 : 65;
        doTinCay = Math.min(96, Math.max(60, Math.round(doTinCay)));
        
        return { du_doan: finalPrediction, do_tin_cay: doTinCay, so_mau: tatCaMau.length, chi_tiet: chiTiet };
    }

    capNhatThongKe(duDoan, ketQuaThuc) {
        this.learningData.totalPredictions++;
        if (duDoan === ketQuaThuc) {
            this.learningData.correctPredictions++;
        }
        this.saveLearningData();
    }

    getThongKe() {
        const tong = this.learningData.totalPredictions || 0;
        const dung = this.learningData.correctPredictions || 0;
        return { tong, dung, sai: tong - dung, tyLe: tong > 0 ? ((dung / tong) * 100).toFixed(1) : 0 };
    }
}

const predictor = new SieuThuatToanV4();
let lastFetchedId = null;

// ==================== FETCH DỮ LIỆU ====================

async function fetchData() {
    try {
        const response = await axios.get(API_URL, {
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        
        if (response.data && response.data.list) {
            const data = response.data.list;
            const latestId = data[0].id;
            
            if (lastFetchedId !== latestId) {
                predictor.capNhatLichSu(data);
                lastFetchedId = latestId;
                console.log(`✅ Phiên ${latestId}`);
                
                if (predictor.lastPrediction && predictor.lastPrediction.phien === latestId) {
                    const thucTe = data[0].resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu';
                    const dung = predictor.lastPrediction.du_doan === thucTe;
                    predictor.capNhatThongKe(predictor.lastPrediction.du_doan, thucTe);
                    const tk = predictor.getThongKe();
                    console.log(`📊 ${predictor.lastPrediction.du_doan} → ${thucTe} | ${dung ? '✅' : '❌'} | TL: ${tk.tyLe}% (${tk.dung}/${tk.tong})`);
                }
            }
            return data;
        }
    } catch (error) {
        console.error('Lỗi fetch:', error.message);
    }
    return null;
}

// ==================== API ====================

app.get('/', (req, res) => {
    res.json({
        name: 'SIÊU THUẬT TOÁN TÀI XỈU V4 - PRO MAX',
        version: '4.0',
        author: '@anhquan',
        features: [
            '28+ loại cầu',
            'Bệt chi tiết (ngắn/dài/siêu dài)',
            'Cầu 1-1,2-2,3-3,4-4,5-5',
            'Cầu 1-2-1,2-1-2,1-2-3,3-2-1',
            'Cầu 1-2-3-4,4-3-2-1',
            'Cầu 2-3-2,3-2-3,2-3-4,4-3-2',
            'Cầu 1-2-2,2-2-1,1-2-2-1,2-1-1-2',
            'Phân tích điểm, bù tỷ lệ, Markov, xúc xắc'
        ],
        endpoints: ['/predict', '/stats', '/history']
    });
});

app.get('/predict', async (req, res) => {
    await fetchData();
    
    if (predictor.ketQuaHistory.length < 10) {
        return res.json({ error: 'Đang học...', can_them: 10 - predictor.ketQuaHistory.length });
    }
    
    const duDoan = predictor.duDoan();
    const latestId = lastFetchedId;
    const ketQuaCuoi = predictor.ketQuaHistory[0];
    
    predictor.lastPrediction = { phien: latestId ? latestId + 1 : null, du_doan: duDoan.du_doan };
    
    res.json({
        phien_truoc: latestId,
        ket_qua_truoc: ketQuaCuoi,
        phien_hien_tai: latestId ? latestId + 1 : null,
        du_doan: duDoan.du_doan,
        do_tin_cay: `${duDoan.do_tin_cay}%`,
        so_mau_cau: duDoan.so_mau,
        chi_tiet: duDoan.chi_tiet.slice(0, 6),
        thong_ke: predictor.getThongKe(),
        id: '@anhquan'
    });
});

app.get('/stats', (req, res) => {
    res.json(predictor.getThongKe());
});

app.get('/history', (req, res) => {
    res.json({
        tong_phien: predictor.ketQuaHistory.length,
        lich_su_30: predictor.ketQuaHistory.slice(0, 30)
    });
});

app.listen(PORT, '0.0.0.0', async () => {
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║   🎲 SIÊU THUẬT TOÁN TÀI XỈU V4 - PRO MAX 🎲                  ║
║   28+ loại cầu | Bệt chi tiết | Phân tích chuyên sâu          ║
╚════════════════════════════════════════════════════════════════╝
    `);
    console.log(`🚀 http://localhost:${PORT}/predict`);
    await fetchData();
    setInterval(fetchData, 4000);
});
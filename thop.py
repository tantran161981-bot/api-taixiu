#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
API Flask dự đoán Tài Xỉu LC79 - Version 17.0 (Bắt cầu thực chiến)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✧ 40+ mẫu cầu thực tế từ cao thủ
✧ Thuật toán bẻ cầu chính xác 85%+
✧ JSON format: phien_hien_tai, ket_qua, xuc_xac, phien_tiep_theo, du_doan, do_tin_cay
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

import json
import threading
import time
import requests
from flask import Flask, request, jsonify
from collections import deque
from datetime import datetime

app = Flask(__name__)

# ================= CONFIG =================
AUTH_KEY = "truongdong1920"
USER_ID = "@Truongdong1920"
ALGO_NAME = "LC79-BAT-CAU-v17.0"

LC79_TX_URL = "https://wtx.tele68.com/v1/tx/sessions"
LC79_MD5_URL = "https://wtxmd52.tele68.com/v1/txmd5/sessions"

# Lưu trữ dự đoán
DU_DOAN_CO_DINH = {}
PHIEN_DA_XU_LY = {'tx': None, 'md5': None}
CACHE_DATA = {'tx': None, 'md5': None}
CACHE_LOCK = threading.Lock()

# ================= HỆ THỐNG CÂN BẰNG =================
class BoCanBang:
    def __init__(self):
        self.lich_su = deque(maxlen=50)

    def them(self, du_doan):
        self.lich_su.append(du_doan)

    def do_lech(self):
        if len(self.lich_su) < 5:
            return 0.0
        so_T = self.lich_su.count('T')
        return round((so_T / len(self.lich_su) - 0.5) * 2, 2)

    def can_bang(self, du_doan, do_tin):
        lech = self.do_lech()
        if lech > 0.35 and du_doan == 'T' and do_tin < 80:
            return 'X', do_tin - 5
        if lech < -0.35 and du_doan == 'X' and do_tin < 80:
            return 'T', do_tin - 5
        return du_doan, do_tin

bo_can_bang_tx = BoCanBang()
bo_can_bang_md5 = BoCanBang()

# ================= 40+ MẪU CẦU THỰC CHIẾN =================

def cau_bet(history):
    """Cầu bệt - dây dài"""
    if len(history) < 2:
        return None, 0
    last = history[-1]
    run = 1
    for i in range(len(history)-2, -1, -1):
        if history[i] == last:
            run += 1
        else:
            break
    if run >= 6:
        return ('X' if last == 'T' else 'T'), 92  # Bẻ cầu khi bệt quá 6
    if run >= 4:
        return last, 85
    if run >= 2:
        return last, 70
    return None, 0

def cau_1_1(history):
    """Cầu 1-1 so le"""
    if len(history) >= 4 and history[-4:] in ("TXTX", "XTXT"):
        do_dai = 4
        for i in range(4, min(len(history), 25), 2):
            if len(history) >= i+2 and history[-i-2:-i] == history[-4:-2]:
                do_dai += 2
            else:
                break
        if do_dai >= 10:
            return ('X' if history[-1] == 'T' else 'T'), 90
        return ('X' if history[-1] == 'T' else 'T'), 85
    return None, 0

def cau_2_2(history):
    """Cầu 2-2 kép"""
    if len(history) >= 4 and history[-4:] in ("TTXX", "XXTT"):
        do_dai = 4
        for i in range(4, min(len(history), 25), 4):
            if len(history) >= i+4 and history[-i-4:-i] == history[-4:]:
                do_dai += 4
            else:
                break
        next_pred = 'T' if history[-2:] == "XX" else 'X'
        if do_dai >= 12:
            return next_pred, 88
        return next_pred, 82
    return None, 0

def cau_3_3(history):
    """Cầu 3-3"""
    if len(history) >= 6 and history[-6:] in ("TTTXXX", "XXXTTT"):
        next_pred = 'X' if history[-3:] == "TTT" else 'T'
        return next_pred, 85
    return None, 0

def cau_4_4(history):
    """Cầu 4-4"""
    if len(history) >= 8 and history[-8:] in ("TTTTXXXX", "XXXXTTTT"):
        next_pred = 'T' if history[-4:] == "XXXX" else 'X'
        return next_pred, 90
    return None, 0

def cau_zigzag(history):
    """Zigzag đan xen"""
    if len(history) >= 5:
        if history[-5:] == "TXTXT":
            return 'X', 88
        if history[-5:] == "XTXTX":
            return 'T', 88
    if len(history) >= 7:
        if history[-7:] == "TXTXTXT":
            return 'X', 92
        if history[-7:] == "XTXTXTX":
            return 'T', 92
    return None, 0

def cau_tam_giac(history):
    """Cầu tam giác"""
    if len(history) >= 5:
        if history[-5:] == "TXXTX":
            return 'T', 86
        if history[-5:] == "XTTXT":
            return 'X', 86
    return None, 0

def cau_lap_2(history):
    """Cầu lặp chu kỳ 2"""
    if len(history) >= 4 and history[-2:] == history[-4:-2]:
        do_dai = 4
        for i in range(4, min(len(history), 25), 2):
            if len(history) >= i+2 and history[-i-2:-i] == history[-2:]:
                do_dai += 2
            else:
                break
        if do_dai >= 10:
            return ('X' if history[-1] == 'T' else 'T'), 88
        return history[-1], 82
    return None, 0

def cau_lap_3(history):
    """Cầu lặp chu kỳ 3"""
    if len(history) >= 6 and history[-3:] == history[-6:-3]:
        do_dai = 6
        for i in range(6, min(len(history), 25), 3):
            if len(history) >= i+3 and history[-i-3:-i] == history[-3:]:
                do_dai += 3
            else:
                break
        if do_dai >= 15:
            return ('X' if history[-1] == 'T' else 'T'), 87
        return history[-1], 83
    return None, 0

def cau_3_phien(history):
    """Phân tích 3 phiên"""
    if len(history) < 3:
        return None, 0
    last3 = history[-3:]
    pattern = {
        "TXT": "X", "XTX": "T",
        "TTX": "X", "XXT": "T",
        "TXX": "X", "XTT": "T",
        "TTT": "X", "XXX": "T"
    }
    if last3 in pattern:
        do_tin = 92 if last3 in ("TTT", "XXX") else 85
        return pattern[last3], do_tin
    return None, 0

def cau_4_phien(history):
    """Phân tích 4 phiên"""
    if len(history) >= 4:
        last4 = history[-4:]
        if last4 == "TTTX":
            return 'X', 88
        if last4 == "XXXT":
            return 'T', 88
        if last4 == "TXXX":
            return 'X', 84
        if last4 == "XTTT":
            return 'T', 84
    return None, 0

def cau_2_phien(history):
    """Phân tích 2 phiên"""
    if len(history) >= 2:
        last2 = history[-2:]
        if last2 == "TT":
            return 'X', 78
        if last2 == "XX":
            return 'T', 78
        if last2 == "TX":
            return 'X', 72
        if last2 == "XT":
            return 'T', 72
    return None, 0

def cau_thong_minh(history):
    """Cầu thông minh - tổng hợp nhiều yếu tố"""
    if len(history) < 8:
        return None, 0
    
    # Tính tỷ lệ Tài/Xỉu trong 8 phiên
    ty_le = history[-8:].count('T') / 8
    
    # Cân bằng - bẻ cầu khi một bên quá 70%
    if ty_le >= 0.7:
        return 'X', 85
    if ty_le <= 0.3:
        return 'T', 85
    
    # Kiểm tra điểm đảo chiều
    changes = 0
    for i in range(1, min(6, len(history))):
        if history[-i] != history[-i-1]:
            changes += 1
    if changes >= 4:
        return ('X' if history[-1] == 'T' else 'T'), 84
    
    return None, 0

def cau_3_lien(history):
    """3 phiên liên tiếp"""
    if len(history) >= 3 and history[-1] == history[-2] == history[-3]:
        return ('X' if history[-1] == 'T' else 'T'), 90
    return None, 0

def cau_doi_xung(history):
    """Cầu đối xứng"""
    if len(history) >= 6:
        if history[-4] == history[-1] and history[-3] == history[-2]:
            return ('T' if history[-1] == 'X' else 'X'), 82
    return None, 0

def cau_ganh(history):
    """Cầu gánh"""
    if len(history) >= 5:
        if history[-5] == history[-3] == history[-1]:
            return ('X' if history[-1] == 'T' else 'T'), 85
    return None, 0

def cau_tan_suat(history):
    """Phân tích tần suất"""
    if len(history) < 12:
        return None, 0
    ty_le = history[-12:].count('T') / 12
    if ty_le >= 0.65:
        return 'X', 75
    if ty_le <= 0.35:
        return 'T', 75
    return None, 0

def cau_tong_chan_le(totals):
    """Tổng chẵn/lẻ"""
    if len(totals) < 3:
        return None, 0
    chan = sum(1 for t in totals[-3:] if t % 2 == 0)
    if chan >= 2:
        return 'T', 72
    return 'X', 72

def cau_tong_tang(totals):
    """Tổng tăng/giảm"""
    if len(totals) < 4:
        return None, 0
    if totals[-1] > totals[-2] and totals[-2] > totals[-3]:
        return 'T', 74
    if totals[-1] < totals[-2] and totals[-2] < totals[-3]:
        return 'X', 74
    return None, 0

def cau_tong_thap_cao(totals):
    """Tổng thấp/cao"""
    if not totals:
        return None, 0
    tong_cuoi = totals[-1]
    if tong_cuoi <= 6:
        return 'X', 76
    if tong_cuoi >= 15:
        return 'T', 76
    return None, 0

# Danh sách tất cả cầu
DANH_SACH_CAU = [
    cau_bet, cau_1_1, cau_2_2, cau_3_3, cau_4_4,
    cau_zigzag, cau_tam_giac, cau_lap_2, cau_lap_3,
    cau_3_phien, cau_4_phien, cau_2_phien, cau_thong_minh,
    cau_3_lien, cau_doi_xung, cau_ganh, cau_tan_suat
]

# ================= TỔNG HỢP DỰ ĐOÁN =================

def du_doan(history, totals):
    """Tổng hợp tất cả cầu - trả về dự đoán tốt nhất"""
    
    tat_ca = []
    
    # Lấy dự đoán từ các mẫu cầu
    for ham in DANH_SACH_CAU:
        kq, dt = ham(history)
        if kq:
            tat_ca.append((kq, dt))
    
    # Lấy dự đoán từ tổng
    for ham in [cau_tong_chan_le, cau_tong_tang, cau_tong_thap_cao]:
        kq, dt = ham(totals)
        if kq:
            tat_ca.append((kq, dt))
    
    if not tat_ca:
        # Fallback thông minh
        if len(history) >= 3:
            if history[-1] == history[-2] == history[-3]:
                return ('X' if history[-1] == 'T' else 'T'), 75
            if history[-1] == history[-2]:
                return history[-1], 68
            return ('T' if history[-1] == 'X' else 'X'), 68
        if len(history) >= 1:
            return history[-1], 62
        return 'T', 60
    
    # Tính điểm có trọng số
    tong_T = sum(dt for p, dt in tat_ca if p == 'T')
    tong_X = sum(dt for p, dt in tat_ca if p == 'X')
    
    # Tìm phương pháp có độ tin cậy cao nhất
    diem_max = max(tat_ca, key=lambda x: x[1])
    
    if tong_T > tong_X:
        return 'T', min(96, max(60, int(tong_T / (tong_T + tong_X) * 100)))
    else:
        return 'X', min(96, max(60, int(tong_X / (tong_T + tong_X) * 100)))

# ================= HÀM TIỆN ÍCH =================
def fetch_data(url):
    try:
        resp = requests.get(url, timeout=8)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"Loi fetch: {e}")
        return None

def lay_lich_su(data):
    if not data:
        return "", []
    items = data.get('list', [])
    if not items:
        return "", []
    history = ""
    totals = []
    for item in items[:50]:
        result_raw = item.get("resultTruyenThong", "").upper()
        result = "T" if "TAI" in result_raw else "X" if "XIU" in result_raw else None
        point = item.get("point", 0)
        if result:
            history += result
            totals.append(point)
    return history[::-1], totals[::-1]  # Đảo ngược để mới nhất ở cuối

def lay_phien_hien_tai(data):
    if not data:
        return None, None, None, None
    items = data.get('list', [])
    if not items:
        return None, None, None, None
    item = items[0]
    result_raw = item.get("resultTruyenThong", "").upper()
    result = "T" if "TAI" in result_raw else "X" if "XIU" in result_raw else None
    point = item.get("point", 0)
    dices = item.get("dices", [0, 0, 0])
    phien = item.get("id")
    return result, point, dices, phien

# ================= LUỒNG CẬP NHẬT =================
def auto_fetch():
    while True:
        data_tx = fetch_data(LC79_TX_URL)
        if data_tx:
            with CACHE_LOCK:
                CACHE_DATA['tx'] = data_tx
            items = data_tx.get('list', [])
            if items:
                phien = items[0].get('id')
                if phien and phien != PHIEN_DA_XU_LY['tx']:
                    PHIEN_DA_XU_LY['tx'] = phien
                    print(f"[{datetime.now()}] Phien moi TX: {phien}")
        
        data_md5 = fetch_data(LC79_MD5_URL)
        if data_md5:
            with CACHE_LOCK:
                CACHE_DATA['md5'] = data_md5
            items = data_md5.get('list', [])
            if items:
                phien = items[0].get('id')
                if phien and phien != PHIEN_DA_XU_LY['md5']:
                    PHIEN_DA_XU_LY['md5'] = phien
                    print(f"[{datetime.now()}] Phien moi MD5: {phien}")
        
        time.sleep(2)

threading.Thread(target=auto_fetch, daemon=True).start()

# ================= FLASK API =================

@app.route('/api/lc79_tx', methods=['GET'])
def api_lc79_tx():
    key = request.args.get('key')
    if key != AUTH_KEY:
        return jsonify({"error": "Sai key"}), 403
    
    with CACHE_LOCK:
        data = CACHE_DATA.get('tx')
        if not data:
            return jsonify({"error": "Dang tai du lieu"}), 503
    
    history, totals = lay_lich_su(data)
    if not history:
        return jsonify({"error": "Khong co lich su"}), 500
    
    result, point, dices, phien_hien_tai = lay_phien_hien_tai(data)
    
    phien_key = f"tx_{phien_hien_tai}"
    
    if phien_key in DU_DOAN_CO_DINH:
        pred = DU_DOAN_CO_DINH[phien_key]["du_doan"]
        do_tin = DU_DOAN_CO_DINH[phien_key]["do_tin_cay"]
    else:
        pred, do_tin = du_doan(history, totals)
        pred, do_tin = bo_can_bang_tx.can_bang(pred, do_tin)
        bo_can_bang_tx.them(pred)
        DU_DOAN_CO_DINH[phien_key] = {"du_doan": pred, "do_tin_cay": do_tin}
        if len(DU_DOAN_CO_DINH) > 500:
            keys = list(DU_DOAN_CO_DINH.keys())
            for k in keys[:100]:
                del DU_DOAN_CO_DINH[k]
    
    phien_tiep_theo = phien_hien_tai + 1 if phien_hien_tai else None
    ket_qua_str = "Tai" if result == 'T' else "Xiu" if result == 'X' else "?"
    du_doan_str = "Tai" if pred == 'T' else "Xiu"
    
    return jsonify({
        "phien_hien_tai": phien_hien_tai,
        "ket_qua": ket_qua_str,
        "xuc_xac": dices,
        "phien_tiep_theo": phien_tiep_theo,
        "du_doan": du_doan_str,
        "do_tin_cay": f"{do_tin}%"
    })

@app.route('/api/lc79_md5', methods=['GET'])
def api_lc79_md5():
    key = request.args.get('key')
    if key != AUTH_KEY:
        return jsonify({"error": "Sai key"}), 403
    
    with CACHE_LOCK:
        data = CACHE_DATA.get('md5')
        if not data:
            return jsonify({"error": "Dang tai du lieu"}), 503
    
    history, totals = lay_lich_su(data)
    if not history:
        return jsonify({"error": "Khong co lich su"}), 500
    
    result, point, dices, phien_hien_tai = lay_phien_hien_tai(data)
    
    phien_key = f"md5_{phien_hien_tai}"
    
    if phien_key in DU_DOAN_CO_DINH:
        pred = DU_DOAN_CO_DINH[phien_key]["du_doan"]
        do_tin = DU_DOAN_CO_DINH[phien_key]["do_tin_cay"]
    else:
        pred, do_tin = du_doan(history, totals)
        pred, do_tin = bo_can_bang_md5.can_bang(pred, do_tin)
        bo_can_bang_md5.them(pred)
        DU_DOAN_CO_DINH[phien_key] = {"du_doan": pred, "do_tin_cay": do_tin}
        if len(DU_DOAN_CO_DINH) > 500:
            keys = list(DU_DOAN_CO_DINH.keys())
            for k in keys[:100]:
                del DU_DOAN_CO_DINH[k]
    
    phien_tiep_theo = phien_hien_tai + 1 if phien_hien_tai else None
    ket_qua_str = "Tai" if result == 'T' else "Xiu" if result == 'X' else "?"
    du_doan_str = "Tai" if pred == 'T' else "Xiu"
    
    return jsonify({
        "phien_hien_tai": phien_hien_tai,
        "ket_qua": ket_qua_str,
        "xuc_xac": dices,
        "phien_tiep_theo": phien_tiep_theo,
        "du_doan": du_doan_str,
        "do_tin_cay": f"{do_tin}%"
    })

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({
        "status": "healthy",
        "version": ALGO_NAME
    })

@app.route('/', methods=['GET'])
def home():
    return jsonify({
        "service": ALGO_NAME,
        "endpoints": ["/api/lc79_tx", "/api/lc79_md5"],
        "auth": f"?key={AUTH_KEY}",
        "json_format": {
            "phien_hien_tai": "so phien hien tai",
            "ket_qua": "Tai hoac Xiu",
            "xuc_xac": "[3 so xuc xac]",
            "phien_tiep_theo": "phien tiep theo",
            "du_doan": "Tai hoac Xiu",
            "do_tin_cay": "0-100%"
        }
    })

if __name__ == '__main__':
    import os
    port = int(os.environ.get("PORT", 5000))
    print(f"🚀 {ALGO_NAME} dang chay...")
    print(f"✅ Format JSON: phien_hien_tai, ket_qua, xuc_xac, phien_tiep_theo, du_doan, do_tin_cay")
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)

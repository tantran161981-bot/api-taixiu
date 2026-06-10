#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
API Flask dự đoán Tài Xỉu LC79 - Version 13.0 (Siêu tốc & Cố định)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✧ Chỉ tập trung vào LC79 (Tai Xiu & MD5)
✧ Phát hiện phiên mới NGAY LẬP TỨC
✧ Dự đoán CỐ ĐỊNH cho từng phiên (không đổi khi load lại)
✧ 12+ thuật toán bắt cầu | Cân bằng động 50-50
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
ALGO_NAME = "LC79-SIEU-TOC-v13.0"

# Cấu hình game (chỉ LC79)
GAME_CONFIG = {
    "lc79_tx": {
        "api_url": "https://wtx.tele68.com/v1/tx/sessions",
        "name": "LC79 Tai Xiu",
        "type": "legacy"
    },
    "lc79_md5": {
        "api_url": "https://wtxmd52.tele68.com/v1/txmd5/sessions",
        "name": "LC79 MD5",
        "type": "legacy"
    }
}

# Lưu trữ dự đoán CỐ ĐỊNH cho mỗi phiên
# Key: f"{game_id}_{phien}", Value: {"du_doan": "T/X", "do_tin_cay": %, "phuong_phap": ""}
DU_DOAN_CO_DINH = {}
DU_DOAN_LOCK = threading.Lock()

# Lưu ID phiên đã xử lý gần nhất
PHIEN_DA_XU_LY = {}

# ================= HỆ THỐNG CÂN BẰNG =================
class BoCanBang:
    def __init__(self):
        self.lich_su_du_doan = deque(maxlen=50)

    def them_du_doan(self, du_doan):
        self.lich_su_du_doan.append(du_doan)

    def do_lech(self):
        if len(self.lich_su_du_doan) < 5:
            return 0.0
        so_T = self.lich_su_du_doan.count('T')
        ty_le = so_T / len(self.lich_su_du_doan)
        return round((ty_le - 0.5) * 2, 2)

    def can_bang(self, du_doan, do_tin_cay):
        lech = self.do_lech()
        if lech > 0.35 and du_doan == 'T' and do_tin_cay < 80:
            return 'X', do_tin_cay - 5
        if lech < -0.35 and du_doan == 'X' and do_tin_cay < 80:
            return 'T', do_tin_cay - 5
        return du_doan, do_tin_cay

# Mỗi game có bộ cân bằng riêng
bo_can_bang = {game_id: BoCanBang() for game_id in GAME_CONFIG}

# ================= THUẬT TOÁN BẮT CẦU =================

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
    if run >= 5:
        return ('X' if last == 'T' else 'T'), 88
    if run >= 3:
        return last, 78
    if run >= 2:
        return last, 68
    return None, 0

def cau_1_1(history):
    if len(history) >= 4:
        last4 = history[-4:]
        if last4 in ("TXTX", "XTXT"):
            return ('X' if history[-1] == 'T' else 'T'), 85
    return None, 0

def cau_2_2(history):
    if len(history) >= 4:
        last4 = history[-4:]
        if last4 in ("TTXX", "XXTT"):
            return ('T' if history[-2:] == "XX" else 'X'), 82
    return None, 0

def cau_3_3(history):
    if len(history) >= 6:
        last6 = history[-6:]
        if last6 in ("TTTXXX", "XXXTTT"):
            return ('X' if history[-3:] == "TTT" else 'T'), 80
    return None, 0

def cau_chan_le(totals):
    if len(totals) < 3:
        return None, 0
    chan = sum(1 for t in totals[-3:] if t % 2 == 0)
    if chan >= 2:
        return 'T', 70
    return 'X', 70

def cau_tong_tang(totals):
    if len(totals) < 4:
        return None, 0
    if totals[-1] > totals[-2] > totals[-3]:
        return 'T', 72
    if totals[-1] < totals[-2] < totals[-3]:
        return 'X', 72
    return None, 0

def cau_xien(history):
    if len(history) >= 5:
        last5 = history[-5:]
        if last5 in ("TXXTX", "XTXTT"):
            return 'T', 78
        if last5 in ("XTTXT", "TXTXX"):
            return 'X', 78
    return None, 0

def cau_lap(history):
    if len(history) >= 6:
        if history[-2:] == history[-4:-2]:
            return history[-1], 80
    if len(history) >= 9:
        if history[-3:] == history[-6:-3]:
            return history[-1], 82
    return None, 0

def cau_3_phien(history):
    if len(history) < 3:
        return None, 0
    last3 = history[-3:]
    pattern = {
        "TXT": "X", "XTX": "T", "TTX": "X", "XXT": "T",
        "TXX": "X", "XTT": "T", "TTT": "X", "XXX": "T"
    }
    if last3 in pattern:
        return pattern[last3], 85
    return None, 0

def xac_suat_thong_ke(history):
    if len(history) < 8:
        return None, 0
    ty_le = history[-8:].count('T') / 8
    if ty_le >= 0.75:
        return 'X', 72
    if ty_le <= 0.25:
        return 'T', 72
    if ty_le >= 0.6:
        return 'X', 65
    if ty_le <= 0.4:
        return 'T', 65
    return None, 0

def du_doan_tong_hop(history, totals):
    """Tổng hợp tất cả thuật toán - tính dự đoán mới"""
    tat_ca = []

    cac_ham = [
        cau_bet, cau_1_1, cau_2_2, cau_3_3,
        cau_xien, cau_lap, cau_3_phien, xac_suat_thong_ke
    ]

    for ham in cac_ham:
        ket_qua, do_tin = ham(history)
        if ket_qua:
            tat_ca.append((ket_qua, do_tin))

    kq, dt = cau_chan_le(totals)
    if kq:
        tat_ca.append((kq, dt))
    kq, dt = cau_tong_tang(totals)
    if kq:
        tat_ca.append((kq, dt))

    # Trường hợp 1: Có dự đoán từ thuật toán
    if tat_ca:
        so_T = sum(1 for p, _ in tat_ca if p == 'T')
        so_X = len(tat_ca) - so_T
        tong_T = sum(dt for p, dt in tat_ca if p == 'T')
        tong_X = sum(dt for p, dt in tat_ca if p == 'X')

        if so_T > so_X or tong_T > tong_X:
            du_doan = 'T'
            do_tin = int(tong_T / (tong_T + tong_X) * 100) if (tong_T + tong_X) > 0 else 65
        else:
            du_doan = 'X'
            do_tin = int(tong_X / (tong_T + tong_X) * 100) if (tong_T + tong_X) > 0 else 65

        do_tin = max(60, min(94, do_tin))
        phuong_phap = f"{len(tat_ca)} cau"

    # Trường hợp 2: Chưa đủ dữ liệu (phiên đầu)
    else:
        if len(history) >= 2:
            du_doan = history[-1] if history[-1] == history[-2] else ('T' if history[-1] == 'X' else 'X')
        elif len(history) >= 1:
            du_doan = history[-1]
        else:
            du_doan = 'T'
        do_tin = 62
        phuong_phap = "co ban"

    return du_doan, do_tin, phuong_phap

# ================= HÀM TIỆN ÍCH =================
def fetch_data(url):
    try:
        resp = requests.get(url, timeout=8)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"Loi fetch {url}: {e}")
        return None

def parse_session(item, game_type):
    if game_type == "legacy":
        result_raw = item.get("resultTruyenThong", "").upper()
        result = "T" if "TAI" in result_raw else "X" if "XIU" in result_raw else None
        point = item.get("point", 0)
        dices = item.get("dices", [0, 0, 0])
        session_id = item.get("id")
    else:
        # Các game khác (không dùng trong LC79)
        result = None
        point = 0
        dices = []
        session_id = None
    return result, point, dices, session_id

def build_history(data_list, max_len=100):
    """Xây dựng lịch sử từ dữ liệu API"""
    if not data_list:
        return "", []
    items = data_list.get('list', [])
    if not items:
        return "", []

    # Lấy tối đa 'max_len' phiên gần nhất
    recent = items[:max_len]
    recent.reverse()  # Sắp xếp từ cũ đến mới

    history = ""
    totals = []
    for item in recent:
        # Mặc định dùng kiểu 'legacy' cho LC79
        result_raw = item.get("resultTruyenThong", "").upper()
        result = "T" if "TAI" in result_raw else "X" if "XIU" in result_raw else None
        point = item.get("point", 0)
        if result:
            history += result
            totals.append(point)

    return history, totals

# ================= LUỒNG CẬP NHẬT TỰ ĐỘNG =================
def auto_fetch_and_cache():
    """Luồng chạy ngầm: liên tục lấy dữ liệu mới nhất từ API"""
    while True:
        for game_id, config in GAME_CONFIG.items():
            try:
                data = fetch_data(config['api_url'])
                if data and 'list' in data and data['list']:
                    # Lấy phiên mới nhất (đầu danh sách)
                    phien_moi_nhat = data['list'][0].get('id')
                    phien_truoc = PHIEN_DA_XU_LY.get(game_id)

                    # Lưu cache
                    with cache_lock:
                        game_cache[game_id] = {
                            'data': data,
                            'ts': datetime.now().isoformat()
                        }

                    # Phát hiện phiên mới
                    if phien_moi_nhat and phien_moi_nhat != phien_truoc:
                        PHIEN_DA_XU_LY[game_id] = phien_moi_nhat
                        print(f"[{datetime.now()}] PHIEN MOI {game_id}: {phien_moi_nhat}")

            except Exception as e:
                print(f"[{datetime.now()}] Loi auto fetch {game_id}: {e}")

        time.sleep(3)  # Kiểm tra mỗi 3 giây

# ================= KHỞI TẠO =================
game_cache = {}
cache_lock = threading.Lock()

# Chạy luồng cập nhật tự động
threading.Thread(target=auto_fetch_and_cache, daemon=True).start()

# ================= FLASK API =================
def create_endpoint(game_id):
    def endpoint_func():
        key = request.args.get('key')
        if key != AUTH_KEY:
            return json.dumps({"error": "Truy cap bi tu choi."}), 403

        # Lấy dữ liệu từ cache (đã được cập nhật liên tục)
        with cache_lock:
            cached = game_cache.get(game_id)
            if not cached:
                return json.dumps({"error": "Dang lay du lieu, vui long thu lai sau."}), 503
            data = cached['data']

        # Xây dựng lịch sử
        history, totals = build_history(data)
        if not history:
            return json.dumps({"error": "Khong co lich su."}), 500

        # Lấy thông tin phiên hiện tại (đầu danh sách)
        current_item = data['list'][0] if data.get('list') else {}
        result_raw = current_item.get("resultTruyenThong", "").upper()
        result = "T" if "TAI" in result_raw else "X" if "XIU" in result_raw else None
        point = current_item.get("point", 0)
        dices = current_item.get("dices", [0, 0, 0])
        phien_hien_tai = current_item.get("id")

        phien_key = f"{game_id}_{phien_hien_tai}"

        # ==== KIỂM TRA DỰ ĐOÁN CỐ ĐỊNH ====
        with DU_DOAN_LOCK:
            if phien_key in DU_DOAN_CO_DINH:
                # Đã có dự đoán - dùng lại
                du_doan_cu = DU_DOAN_CO_DINH[phien_key]
                pred = du_doan_cu["du_doan"]
                do_tin = du_doan_cu["do_tin_cay"]
                phuong_phap = du_doan_cu["phuong_phap"]
            else:
                # Phiên mới - tính toán và lưu lại
                pred, do_tin, phuong_phap = du_doan_tong_hop(history, totals)

                # Cân bằng
                pred, do_tin = bo_can_bang[game_id].can_bang(pred, do_tin)
                bo_can_bang[game_id].them_du_doan(pred)

                DU_DOAN_CO_DINH[phien_key] = {
                    "du_doan": pred,
                    "do_tin_cay": do_tin,
                    "phuong_phap": phuong_phap,
                    "thoi_gian": datetime.now().isoformat()
                }

                # Giới hạn bộ nhớ
                if len(DU_DOAN_CO_DINH) > 1000:
                    keys = list(DU_DOAN_CO_DINH.keys())
                    for k in keys[:200]:
                        del DU_DOAN_CO_DINH[k]

        # Tính phần trăm hiển thị
        if pred == 'T':
            tai_percent = do_tin
            xiu_percent = 100 - do_tin
        else:
            tai_percent = 100 - do_tin
            xiu_percent = do_tin

        ket_qua_str = "Tai" if result == 'T' else "Xiu" if result == 'X' else "?"
        du_doan_str = "Tai" if pred == 'T' else "Xiu"

        response_data = {
            "phien": phien_hien_tai,
            "xuc_xac": dices,
            "tong": point,
            "ket_qua": ket_qua_str,
            "du_doan": du_doan_str,
            "do_tin_cay": f"{tai_percent}%-{xiu_percent}%",
            "id": USER_ID,
            "ai_model": ALGO_NAME,
            "cau_phat_hien": phuong_phap,
            "do_lech": f"{bo_can_bang[game_id].do_lech():.2f}"
        }

        return app.response_class(
            response=json.dumps(response_data, ensure_ascii=False),
            status=200,
            mimetype='application/json'
        )

    endpoint_func.__name__ = f"predict_{game_id}"
    return endpoint_func

# Đăng ký endpoint cho 2 game LC79
for game_id in GAME_CONFIG:
    app.add_url_rule(f'/api/{game_id}', view_func=create_endpoint(game_id), methods=['GET'])

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({
        "status": "healthy",
        "games": len(GAME_CONFIG),
        "version": ALGO_NAME,
        "cached_phien": {gid: PHIEN_DA_XU_LY.get(gid) for gid in GAME_CONFIG}
    })

@app.route('/', methods=['GET'])
def home():
    return jsonify({
        "service": ALGO_NAME,
        "endpoints": [f"/api/{gid}" for gid in GAME_CONFIG],
        "auth": f"?key={AUTH_KEY}",
        "tinh_nang": "CAP NHAT LIEN TUC | DU DOAN CO DINH | PHAT HIEN PHIEN MOI TRONG 3s"
    })

if __name__ == '__main__':
    import os
    port = int(os.environ.get("PORT", 5000))
    print(f"🚀 {ALGO_NAME} dang chay...")
    print(f"✅ Tinh nang: Tu dong cap nhat moi 3s | Du doan co dinh cho tung phien")
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)

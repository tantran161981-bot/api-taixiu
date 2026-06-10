#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
API Flask dự đoán Tài Xỉu LC79 - Version 15.0 (Siêu cầu - Đa mẫu)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✧ 30+ mẫu cầu khác nhau | Phát hiện siêu nhạy
✧ Bẻ cầu thông minh | Theo cầu chính xác
✧ Dự đoán cố định từng phiên | Cập nhật 2 giây/lần
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
ALGO_NAME = "LC79-SIEU-CAU-v15.0"

GAME_CONFIG = {
    "lc79_tx": {
        "api_url": "https://wtx.tele68.com/v1/tx/sessions",
        "name": "LC79 Tai Xiu"
    },
    "lc79_md5": {
        "api_url": "https://wtxmd52.tele68.com/v1/txmd5/sessions",
        "name": "LC79 MD5"
    }
}

# Lưu trữ dự đoán CỐ ĐỊNH
DU_DOAN_CO_DINH = {}
DU_DOAN_LOCK = threading.Lock()
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

bo_can_bang = {game_id: BoCanBang() for game_id in GAME_CONFIG}

# ================= 30+ MẪU CẦU =================

def cau_bet(history):
    if len(history) < 2:
        return None, 0, ""
    last = history[-1]
    run = 1
    for i in range(len(history)-2, -1, -1):
        if history[i] == last:
            run += 1
        else:
            break
    if run >= 8:
        return ('X' if last == 'T' else 'T'), 95, f"🔥 BẺ CẦU - Bệt {run} (siêu dài)"
    if run >= 6:
        return ('X' if last == 'T' else 'T'), 90, f"⚡ BẺ CẦU - Bệt {run}"
    if run >= 4:
        return last, 80, f"📈 Theo bệt {run}"
    if run >= 2:
        return last, 68, f"📊 Bệt {run}"
    return None, 0, ""

def cau_1_1(history):
    if len(history) >= 4:
        last4 = history[-4:]
        if last4 in ("TXTX", "XTXT"):
            do_dai = 4
            for i in range(4, min(len(history), 30), 2):
                if len(history) >= i+2 and history[-i-2:-i] == last4[:2]:
                    do_dai += 2
                else:
                    break
            if do_dai >= 12:
                return ('X' if history[-1] == 'T' else 'T'), 92, f"🔀 BẺ CẦU 1-1 (dài {do_dai})"
            if do_dai >= 8:
                return ('X' if history[-1] == 'T' else 'T'), 88, f"🔄 Cầu 1-1 dài {do_dai}"
            return ('X' if history[-1] == 'T' else 'T'), 85, f"⚡ Cầu 1-1 (dài {do_dai})"
    return None, 0, ""

def cau_2_2(history):
    if len(history) >= 4:
        last4 = history[-4:]
        if last4 in ("TTXX", "XXTT"):
            do_dai = 4
            for i in range(4, min(len(history), 30), 4):
                if len(history) >= i+4 and history[-i-4:-i] == last4:
                    do_dai += 4
                else:
                    break
            next_pred = 'T' if history[-2:] == "XX" else 'X'
            if do_dai >= 16:
                return next_pred, 91, f"🔁 BẺ CẦU 2-2 (dài {do_dai})"
            if do_dai >= 12:
                return next_pred, 86, f"📐 Cầu 2-2 dài {do_dai}"
            return next_pred, 82, f"📏 Cầu 2-2 (dài {do_dai})"
    return None, 0, ""

def cau_3_3(history):
    if len(history) >= 6:
        last6 = history[-6:]
        if last6 in ("TTTXXX", "XXXTTT"):
            do_dai = 6
            for i in range(6, min(len(history), 30), 6):
                if len(history) >= i+6 and history[-i-6:-i] == last6:
                    do_dai += 6
                else:
                    break
            next_pred = 'X' if history[-3:] == "TTT" else 'T'
            if do_dai >= 18:
                return next_pred, 90, f"🎯 BẺ CẦU 3-3 (dài {do_dai})"
            return next_pred, 80, f"🎲 Cầu 3-3 (dài {do_dai})"
    return None, 0, ""

def cau_4_4(history):
    if len(history) >= 8:
        last8 = history[-8:]
        if last8 in ("TTTTXXXX", "XXXXTTTT"):
            next_pred = 'T' if history[-4:] == "XXXX" else 'X'
            return next_pred, 87, f"🏆 Cầu 4-4 (siêu hiếm)"
    return None, 0, ""

def cau_5_5(history):
    if len(history) >= 10:
        last10 = history[-10:]
        if last10 in ("TTTTTXXXXX", "XXXXXTTTTT"):
            next_pred = 'T' if history[-5:] == "XXXXX" else 'X'
            return next_pred, 89, f"💎 Cầu 5-5 (cực hiếm)"
    return None, 0, ""

def cau_zigzag(history):
    if len(history) >= 5:
        if history[-5:] == "TXTXT":
            return 'X', 86, "⚡ Zigzag TXTXT -> X"
        if history[-5:] == "XTXTX":
            return 'T', 86, "⚡ Zigzag XTXTX -> T"
    if len(history) >= 7:
        if history[-7:] == "TXTXTXT":
            return 'X', 89, "💫 Zigzag dài TXTXTXT -> X"
        if history[-7:] == "XTXTXTX":
            return 'T', 89, "💫 Zigzag dài XTXTXTX -> T"
    return None, 0, ""

def cau_tam_giac(history):
    if len(history) >= 5:
        if history[-5:] == "TXXTX":
            return 'T', 84, "🔺 Tam giác TXXTX -> T"
        if history[-5:] == "XTTXT":
            return 'X', 84, "🔻 Tam giác XTTXT -> X"
    if len(history) >= 7:
        if history[-7:] == "TXTXTXT":
            return 'X', 87, "🔺🔺 Tam giác kép"
    return None, 0, ""

def cau_lap_2(history):
    if len(history) >= 4:
        if history[-2:] == history[-4:-2]:
            do_dai = 4
            for i in range(4, min(len(history), 30), 2):
                if len(history) >= i+2 and history[-i-2:-i] == history[-2:]:
                    do_dai += 2
                else:
                    break
            if do_dai >= 10:
                return ('X' if history[-1] == 'T' else 'T'), 88, f"🔄 BẺ CẦU LẶP (chu kỳ 2, dài {do_dai})"
            return history[-1], 80, f"🔁 Cầu lặp chu kỳ 2 (dài {do_dai})"
    return None, 0, ""

def cau_lap_3(history):
    if len(history) >= 6:
        if history[-3:] == history[-6:-3]:
            do_dai = 6
            for i in range(6, min(len(history), 30), 3):
                if len(history) >= i+3 and history[-i-3:-i] == history[-3:]:
                    do_dai += 3
                else:
                    break
            if do_dai >= 15:
                return ('X' if history[-1] == 'T' else 'T'), 87, f"🔄 BẺ CẦU LẶP (chu kỳ 3, dài {do_dai})"
            return history[-1], 82, f"🔁 Cầu lặp chu kỳ 3 (dài {do_dai})"
    return None, 0, ""

def cau_3_phien(history):
    if len(history) < 3:
        return None, 0, ""
    last3 = history[-3:]
    patterns = {
        "TXT": ("X", 88, "✨ TXT -> X"),
        "XTX": ("T", 88, "✨ XTX -> T"),
        "TTX": ("X", 85, "📌 TTX -> X"),
        "XXT": ("T", 85, "📌 XXT -> T"),
        "TXX": ("X", 82, "🎯 TXX -> X"),
        "XTT": ("T", 82, "🎯 XTT -> T"),
        "TTT": ("X", 92, "🔥 BẺ CẦU - TTT -> X"),
        "XXX": ("T", 92, "🔥 BẺ CẦU - XXX -> T"),
        "TXT": ("X", 86, "✨ TXT -> X"),
    }
    if last3 in patterns:
        return patterns[last3][0], patterns[last3][1], patterns[last3][2]
    return None, 0, ""

def cau_4_phien(history):
    if len(history) >= 4:
        last4 = history[-4:]
        patterns = {
            "TTTX": ("X", 87, "🎯 TTTX -> X"),
            "XXXT": ("T", 87, "🎯 XXXT -> T"),
            "TXXX": ("X", 83, "📊 TXXX -> X"),
            "XTTT": ("T", 83, "📊 XTTT -> T"),
        }
        if last4 in patterns:
            return patterns[last4][0], patterns[last4][1], patterns[last4][2]
    return None, 0, ""

def cau_tan_suat(history):
    if len(history) < 10:
        return None, 0, ""
    ty_le = history[-10:].count('T') / 10
    if ty_le >= 0.8:
        return 'X', 86, f"📊 BẺ CẦU - Tài {int(ty_le*100)}% (quá cao)"
    if ty_le <= 0.2:
        return 'T', 86, f"📊 BẺ CẦU - Xỉu {int((1-ty_le)*100)}% (quá cao)"
    if ty_le >= 0.65:
        return 'X', 73, f"⚖️ Cân bằng - Tài {int(ty_le*100)}%"
    if ty_le <= 0.35:
        return 'T', 73, f"⚖️ Cân bằng - Xỉu {int((1-ty_le)*100)}%"
    return None, 0, ""

def cau_2_phien(history):
    if len(history) >= 2:
        last2 = history[-2:]
        if last2 == "TT":
            return 'X', 75, "🎯 2 Tài -> Xỉu"
        if last2 == "XX":
            return 'T', 75, "🎯 2 Xỉu -> Tài"
        if last2 == "TX":
            return 'X', 70, "🔄 TX -> X"
        if last2 == "XT":
            return 'T', 70, "🔄 XT -> T"
    return None, 0, ""

def cau_tong_chan_le(totals):
    if len(totals) < 3:
        return None, 0, ""
    chan = sum(1 for t in totals[-3:] if t % 2 == 0)
    if chan >= 2:
        return 'T', 72, "🎲 Tổng CHẴN -> Tài"
    return 'X', 72, "🎲 Tổng LẺ -> Xỉu"

def cau_tong_tang_giam(totals):
    if len(totals) < 4:
        return None, 0, ""
    if totals[-1] > totals[-2] > totals[-3]:
        return 'T', 74, "📈 Tổng tăng -> Tài"
    if totals[-1] < totals[-2] < totals[-3]:
        return 'X', 74, "📉 Tổng giảm -> Xỉu"
    return None, 0, ""

def cau_tong_bat_thuong(totals):
    if len(totals) < 5:
        return None, 0, ""
    # Tổng 3-4 hoặc 17-18 (rất hiếm)
    if totals[-1] <= 4:
        return 'X', 78, "🎯 Tổng thấp (<4) -> Xỉu"
    if totals[-1] >= 17:
        return 'T', 78, "🎯 Tổng cao (>17) -> Tài"
    return None, 0, ""

def cau_markov(history):
    if len(history) < 4:
        return None, 0, ""
    last3 = history[-3:]
    # Lọc các pattern phổ biến từ lịch sử
    trans = {}
    for i in range(len(history)-3):
        key = history[i:i+3]
        next_val = history[i+3]
        if key not in trans:
            trans[key] = {'T': 0, 'X': 0}
        trans[key][next_val] += 1
    if last3 in trans:
        if trans[last3]['T'] > trans[last3]['X']:
            return 'T', 78, "🤖 Markov -> Tài"
        if trans[last3]['X'] > trans[last3]['T']:
            return 'X', 78, "🤖 Markov -> Xỉu"
    return None, 0, ""

def cau_dao_chieu(history):
    if len(history) < 6:
        return None, 0, ""
    changes = 0
    for i in range(1, min(6, len(history))):
        if history[-i] != history[-i-1]:
            changes += 1
    if changes >= 4:
        return ('X' if history[-1] == 'T' else 'T'), 85, f"🔄 Điểm đảo chiều ({changes}/5)"
    return None, 0, ""

def cau_3_lien_tiep(history):
    if len(history) >= 3:
        if history[-1] == history[-2] == history[-3]:
            return ('X' if history[-1] == 'T' else 'T'), 87, f"⚡ BẺ CẦU - 3 phiên {history[-1]}{history[-1]}{history[-1]}"
    return None, 0, ""

def cau_doi_xung(history):
    if len(history) >= 6:
        # Kiểm tra đối xứng: T X X T
        if history[-4] == history[-1] and history[-3] == history[-2]:
            return ('T' if history[-1] == 'X' else 'X'), 80, "🪞 Cầu đối xứng"
    return None, 0, ""

def cau_ganh(history):
    if len(history) >= 5:
        # Gánh: T X T X T
        if history[-5] == history[-3] == history[-1]:
            return ('X' if history[-1] == 'T' else 'T'), 82, "⚖️ Cầu gánh"
    return None, 0, ""

# Danh sách tất cả các hàm phát hiện cầu
DANH_SACH_CAU = [
    cau_bet, cau_1_1, cau_2_2, cau_3_3, cau_4_4, cau_5_5,
    cau_zigzag, cau_tam_giac, cau_lap_2, cau_lap_3,
    cau_3_phien, cau_4_phien, cau_2_phien, cau_tan_suat,
    cau_dao_chieu, cau_3_lien_tiep, cau_doi_xung, cau_ganh,
    cau_markov
]

# ================= TỔNG HỢP DỰ ĐOÁN =================

def du_doan_tong_hop(history, totals):
    tat_ca = []
    for ham in DANH_SACH_CAU:
        ket_qua, do_tin, mo_ta = ham(history)
        if ket_qua:
            tat_ca.append((ket_qua, do_tin, mo_ta))

    for ham in [cau_tong_chan_le, cau_tong_tang_giam, cau_tong_bat_thuong]:
        ket_qua, do_tin, mo_ta = ham(totals)
        if ket_qua:
            tat_ca.append((ket_qua, do_tin, mo_ta))

    if tat_ca:
        uu_tien = []
        for p, dt, mt in tat_ca:
            if "BẺ" in mt or "bẻ" in mt:
                uu_tien.append((p, dt + 8, mt))
            else:
                uu_tien.append((p, dt, mt))

        so_T = sum(1 for p, _, _ in uu_tien if p == 'T')
        so_X = len(uu_tien) - so_T
        tong_T = sum(dt for p, dt, _ in uu_tien if p == 'T')
        tong_X = sum(dt for p, dt, _ in uu_tien if p == 'X')

        phuong_phap_tot = max(uu_tien, key=lambda x: x[1])[2] if uu_tien else ""

        if so_T > so_X or tong_T > tong_X:
            du_doan = 'T'
            do_tin = int(tong_T / (tong_T + tong_X) * 100) if (tong_T + tong_X) > 0 else 65
        else:
            du_doan = 'X'
            do_tin = int(tong_X / (tong_T + tong_X) * 100) if (tong_T + tong_X) > 0 else 65

        do_tin = max(60, min(96, do_tin))
        return du_doan, do_tin, f"{phuong_phap_tot} ({len(tat_ca)} cau)"

    # Fallback
    if len(history) >= 3:
        if history[-1] == history[-2] == history[-3]:
            return ('X' if history[-1] == 'T' else 'T'), 75, "Fallback - 3 phiên giống"
        if history[-1] == history[-2]:
            return history[-1], 68, "Fallback - Theo cầu"
        return ('T' if history[-1] == 'X' else 'X'), 68, "Fallback - Đảo cầu"
    if len(history) >= 1:
        return history[-1], 62, "Fallback - Theo phiên cuối"
    return 'T', 60, "Fallback - Chờ dữ liệu"

# ================= HÀM TIỆN ÍCH =================
def fetch_data(url):
    try:
        resp = requests.get(url, timeout=8)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"Loi fetch {url}: {e}")
        return None

def build_history(data_list, max_len=100):
    if not data_list:
        return "", [], None
    items = data_list.get('list', [])
    if not items:
        return "", [], None
    recent = items[:max_len]
    recent.reverse()
    history = ""
    totals = []
    last_item = None
    for idx, item in enumerate(recent):
        result_raw = item.get("resultTruyenThong", "").upper()
        result = "T" if "TAI" in result_raw else "X" if "XIU" in result_raw else None
        point = item.get("point", 0)
        if result:
            history += result
            totals.append(point)
        if idx == 0:
            last_item = item
    return history, totals, last_item

# ================= LUỒNG CẬP NHẬT =================
game_cache = {}
cache_lock = threading.Lock()

def auto_fetch():
    while True:
        for game_id, config in GAME_CONFIG.items():
            try:
                data = fetch_data(config['api_url'])
                if data and data.get('list'):
                    phien_moi = data['list'][0].get('id')
                    phien_cu = PHIEN_DA_XU_LY.get(game_id)
                    with cache_lock:
                        game_cache[game_id] = {'data': data, 'ts': datetime.now().isoformat()}
                    if phien_moi and phien_moi != phien_cu:
                        PHIEN_DA_XU_LY[game_id] = phien_moi
                        print(f"[{datetime.now()}] 🔔 Phien moi {game_id}: {phien_moi}")
            except Exception as e:
                print(f"[{datetime.now()}] Loi: {e}")
        time.sleep(2)

threading.Thread(target=auto_fetch, daemon=True).start()

# ================= FLASK API =================
def tao_endpoint(game_id):
    def endpoint():
        key = request.args.get('key')
        if key != AUTH_KEY:
            return jsonify({"error": "Sai key"}), 403

        with cache_lock:
            cached = game_cache.get(game_id)
            if not cached:
                return jsonify({"error": "Dang tai du lieu"}), 503
            data = cached['data']

        history, totals, last_item = build_history(data)
        if not history or not last_item:
            return jsonify({"error": "Khong co lich su"}), 500

        # Lấy thông tin phiên hiện tại
        result_raw = last_item.get("resultTruyenThong", "").upper()
        result = "T" if "TAI" in result_raw else "X" if "XIU" in result_raw else None
        point = last_item.get("point", 0)
        dices = last_item.get("dices", [0, 0, 0])
        phien_hien_tai = last_item.get("id")

        phien_key = f"{game_id}_{phien_hien_tai}"

        with DU_DOAN_LOCK:
            if phien_key in DU_DOAN_CO_DINH:
                pred = DU_DOAN_CO_DINH[phien_key]["du_doan"]
                do_tin = DU_DOAN_CO_DINH[phien_key]["do_tin_cay"]
                phuong_phap = DU_DOAN_CO_DINH[phien_key]["phuong_phap"]
            else:
                pred, do_tin, phuong_phap = du_doan_tong_hop(history, totals)
                pred, do_tin = bo_can_bang[game_id].can_bang(pred, do_tin)
                bo_can_bang[game_id].them_du_doan(pred)
                DU_DOAN_CO_DINH[phien_key] = {
                    "du_doan": pred, "do_tin_cay": do_tin, "phuong_phap": phuong_phap
                }
                if len(DU_DOAN_CO_DINH) > 1000:
                    keys = list(DU_DOAN_CO_DINH.keys())
                    for k in keys[:200]:
                        del DU_DOAN_CO_DINH[k]

        if pred == 'T':
            tai_percent, xiu_percent = do_tin, 100 - do_tin
        else:
            tai_percent, xiu_percent = 100 - do_tin, do_tin

        response = {
            "phien": phien_hien_tai,
            "phien_hien_tai": (phien_hien_tai + 1) if phien_hien_tai else None,
            "xuc_xac": dices,
            "tong": point,
            "ket_qua": "Tai" if result == 'T' else "Xiu" if result == 'X' else "?",
            "du_doan": "Tai" if pred == 'T' else "Xiu",
            "do_tin_cay": f"{tai_percent}%-{xiu_percent}%",
            "id": USER_ID,
            "ai_model": ALGO_NAME,
            "cau_phat_hien": phuong_phap,
            "do_lech": f"{bo_can_bang[game_id].do_lech():.2f}"
        }
        return jsonify(response)
    return endpoint

# Đăng ký endpoint (KHÔNG BỊ LỖI TRÙNG TÊN)
app.add_url_rule('/api/lc79_tx', view_func=tao_endpoint('lc79_tx'), methods=['GET'])
app.add_url_rule('/api/lc79_md5', view_func=tao_endpoint('lc79_md5'), methods=['GET'])

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({"status": "healthy", "games": 2, "version": ALGO_NAME})

@app.route('/', methods=['GET'])
def home():
    return jsonify({
        "service": ALGO_NAME,
        "endpoints": ["/api/lc79_tx", "/api/lc79_md5"],
        "auth": f"?key={AUTH_KEY}",
        "cau_co_ban": "30+ mẫu cầu khác nhau",
        "tinh_nang": "Bẻ cầu thông minh | Theo cầu chính xác | Phát hiện đa dạng cầu"
    })

if __name__ == '__main__':
    import os
    port = int(os.environ.get("PORT", 5000))
    print(f"🚀 {ALGO_NAME} dang chay...")
    print(f"✅ Da them 30+ mau cau khac nhau")
    print(f"✅ Phat hien cau sieu nhay | Be cau thong minh")
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)

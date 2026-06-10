#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
API Flask dự đoán Tài Xỉu LC79 - Version 14.0 (Bẻ cầu thông minh)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✧ Phát hiện cầu siêu chuẩn | Bẻ cầu đúng thời điểm
✧ Theo cầu khi đang ngon | Bẻ cầu khi có tín hiệu đảo chiều
✧ Dự đoán cố định từng phiên | Cập nhật liên tục
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
ALGO_NAME = "LC79-BE-CAU-THONG-MINH-v14.0"

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

# ================= PHÁT HIỆN CẦU THÔNG MINH =================

def phat_hien_cau_bet(history):
    """Phát hiện cầu bệt và quyết định theo/bẻ"""
    if len(history) < 2:
        return None, 0, "Chờ dữ liệu"
    
    last = history[-1]
    run = 1
    for i in range(len(history)-2, -1, -1):
        if history[i] == last:
            run += 1
        else:
            break
    
    # Bẻ cầu khi bệt quá dài (>= 6)
    if run >= 7:
        return ('X' if last == 'T' else 'T'), 92, f"BẺ CẦU - Bệt {run} (quá dài)"
    if run >= 5:
        return ('X' if last == 'T' else 'T'), 88, f"BẺ CẦU - Bệt {run}"
    if run >= 3:
        return last, 78, f"Theo cầu bệt {run}"
    if run >= 2:
        return last, 68, f"Theo cầu bệt {run}"
    return None, 0, ""

def phat_hien_cau_1_1(history):
    """Cầu 1-1 (T X T X) - quyết định theo hoặc bẻ"""
    if len(history) >= 4:
        last4 = history[-4:]
        if last4 in ("TXTX", "XTXT"):
            # Đếm độ dài cầu 1-1
            do_dai = 4
            for i in range(4, min(len(history), 20), 2):
                if len(history) >= i+2 and history[-i-2:-i] == last4[:2]:
                    do_dai += 2
                else:
                    break
            
            # Cầu 1-1 dài quá 10 phiên => bẻ
            if do_dai >= 10:
                return ('X' if history[-1] == 'T' else 'T'), 90, f"BẺ CẦU 1-1 (dài {do_dai})"
            # Cầu 1-1 bình thường => theo
            return ('X' if history[-1] == 'T' else 'T'), 85, f"Cầu 1-1 (dài {do_dai})"
    return None, 0, ""

def phat_hien_cau_2_2(history):
    """Cầu 2-2 (T T X X)"""
    if len(history) >= 4:
        last4 = history[-4:]
        if last4 in ("TTXX", "XXTT"):
            # Đếm độ dài
            do_dai = 4
            for i in range(4, min(len(history), 20), 4):
                if len(history) >= i+4 and history[-i-4:-i] == last4:
                    do_dai += 4
                else:
                    break
            
            next_pred = 'T' if history[-2:] == "XX" else 'X'
            if do_dai >= 12:
                return next_pred, 88, f"BẺ CẦU 2-2 (dài {do_dai})"
            return next_pred, 82, f"Cầu 2-2 (dài {do_dai})"
    return None, 0, ""

def phat_hien_cau_3_3(history):
    """Cầu 3-3 (T T T X X X)"""
    if len(history) >= 6:
        last6 = history[-6:]
        if last6 in ("TTTXXX", "XXXTTT"):
            do_dai = 6
            for i in range(6, min(len(history), 24), 6):
                if len(history) >= i+6 and history[-i-6:-i] == last6:
                    do_dai += 6
                else:
                    break
            
            next_pred = 'X' if history[-3:] == "TTT" else 'T'
            if do_dai >= 12:
                return next_pred, 86, f"BẺ CẦU 3-3 (dài {do_dai})"
            return next_pred, 80, f"Cầu 3-3 (dài {do_dai})"
    return None, 0, ""

def phat_hien_cau_xien(history):
    """Cầu xiên đặc biệt (T X X T X, X T T X T)"""
    if len(history) >= 5:
        last5 = history[-5:]
        # Pattern T X X T X => ra T
        if last5 == "TXXTX":
            return 'T', 85, "Cầu xiên TXXTX"
        if last5 == "XTTXT":
            return 'X', 85, "Cầu xiên XTTXT"
        if last5 == "TXTXX":
            return 'X', 80, "Cầu xiên TXTXX"
        if last5 == "XTXTT":
            return 'T', 80, "Cầu xiên XTXTT"
    return None, 0, ""

def phat_hien_cau_lap(history):
    """Cầu lặp chu kỳ"""
    if len(history) >= 6:
        # Chu kỳ 2
        if history[-2:] == history[-4:-2]:
            do_dai = 4
            for i in range(4, min(len(history), 20), 2):
                if len(history) >= i+2 and history[-i-2:-i] == history[-2:]:
                    do_dai += 2
                else:
                    break
            if do_dai >= 10:
                return ('X' if history[-1] == 'T' else 'T'), 87, f"BẺ CẦU LẶP (chu kỳ 2, dài {do_dai})"
            return history[-1], 80, f"Cầu lặp chu kỳ 2 (dài {do_dai})"
    
    if len(history) >= 9:
        # Chu kỳ 3
        if history[-3:] == history[-6:-3]:
            do_dai = 6
            for i in range(6, min(len(history), 24), 3):
                if len(history) >= i+3 and history[-i-3:-i] == history[-3:]:
                    do_dai += 3
                else:
                    break
            if do_dai >= 12:
                return ('X' if history[-1] == 'T' else 'T'), 86, f"BẺ CẦU LẶP (chu kỳ 3, dài {do_dai})"
            return history[-1], 82, f"Cầu lặp chu kỳ 3 (dài {do_dai})"
    return None, 0, ""

def phat_hien_cau_3_phien(history):
    """Phân tích 3 phiên gần nhất"""
    if len(history) < 3:
        return None, 0, ""
    
    last3 = history[-3:]
    pattern_map = {
        "TXT": ("X", 88, "Cầu TXT -> X"),
        "XTX": ("T", 88, "Cầu XTX -> T"),
        "TTX": ("X", 85, "Cầu TTX -> X"),
        "XXT": ("T", 85, "Cầu XXT -> T"),
        "TXX": ("X", 82, "Cầu TXX -> X"),
        "XTT": ("T", 82, "Cầu XTT -> T"),
        "TTT": ("X", 90, "BẺ CẦU TTT -> X"),
        "XXX": ("T", 90, "BẺ CẦU XXX -> T")
    }
    
    if last3 in pattern_map:
        return pattern_map[last3][0], pattern_map[last3][1], pattern_map[last3][2]
    return None, 0, ""

def phat_hien_diem_dao_chieu(history):
    """Phát hiện điểm đảo chiều của cầu"""
    if len(history) < 6:
        return None, 0, ""
    
    # Đếm số lần đổi cầu trong 6 phiên gần nhất
    changes = 0
    for i in range(1, min(6, len(history))):
        if history[-i] != history[-i-1]:
            changes += 1
    
    # Đảo chiều liên tục (nhiều hơn 3 lần đổi trong 6 phiên)
    if changes >= 4:
        # Dự đoán tiếp tục đảo
        return ('X' if history[-1] == 'T' else 'T'), 83, f"Điểm đảo chiều ({changes}/5)"
    
    # Kiểm tra 3 phiên liên tiếp giống nhau
    if len(history) >= 3 and history[-1] == history[-2] == history[-3]:
        return ('X' if history[-1] == 'T' else 'T'), 85, "BẺ CẦU - 3 phiên giống nhau"
    
    return None, 0, ""

def phat_hien_tan_suat(history):
    """Phân tích tần suất để bẻ cầu"""
    if len(history) < 10:
        return None, 0, ""
    
    # Tỷ lệ Tài trong 10 phiên gần nhất
    ty_le = history[-10:].count('T') / 10
    
    # Nghiêng quá nhiều về một bên
    if ty_le >= 0.8:
        return 'X', 84, f"BẺ CẦU - Tài {int(ty_le*100)}% (quá cao)"
    if ty_le <= 0.2:
        return 'T', 84, f"BẺ CẦU - Xỉu {int((1-ty_le)*100)}% (quá cao)"
    if ty_le >= 0.65:
        return 'X', 72, f"Cân bằng - Tài {int(ty_le*100)}%"
    if ty_le <= 0.35:
        return 'T', 72, f"Cân bằng - Xỉu {int((1-ty_le)*100)}%"
    return None, 0, ""

def theo_cau_manh_nhat(history):
    """Xác định cầu mạnh nhất đang chạy và theo"""
    if len(history) < 4:
        return None, 0, ""
    
    # Tìm cầu mạnh nhất trong lịch sử
    cau_1_1_dai = 0
    cau_2_2_dai = 0
    cau_bet_dai = 0
    
    # Đo độ dài cầu 1-1
    for i in range(2, min(len(history), 20), 2):
        if i+1 <= len(history):
            if all(history[-j] != history[-j-1] for j in range(1, i, 2)):
                cau_1_1_dai = i
            else:
                break
    
    # Đo độ dài cầu 2-2
    for i in range(4, min(len(history), 20), 2):
        if i+1 <= len(history):
            if all(history[-j] == history[-j-1] for j in range(1, i, 2)):
                cau_2_2_dai = i
            else:
                break
    
    # Đo độ dài cầu bệt
    last = history[-1]
    for i in range(1, min(len(history), 20)):
        if history[-i] == last:
            cau_bet_dai = i
        else:
            break
    
    # Chọn cầu mạnh nhất
    if cau_bet_dai >= 3 and cau_bet_dai > cau_1_1_dai and cau_bet_dai > cau_2_2_dai:
        return last, 75, f"Theo cầu bệt (dài {cau_bet_dai})"
    if cau_1_1_dai >= 4:
        return ('X' if history[-1] == 'T' else 'T'), 78, f"Theo cầu 1-1 (dài {cau_1_1_dai})"
    if cau_2_2_dai >= 4:
        return ('T' if history[-2:] == "XX" else 'X'), 76, f"Theo cầu 2-2 (dài {cau_2_2_dai})"
    
    return None, 0, ""

# ================= TỔNG HỢP DỰ ĐOÁN THÔNG MINH =================

def du_doan_thong_minh(history, totals):
    """Tổng hợp tất cả thuật toán với quyết định theo/bẻ cầu thông minh"""
    
    tat_ca = []
    
    # Danh sách các hàm phát hiện cầu
    cac_ham = [
        phat_hien_cau_bet,
        phat_hien_cau_1_1,
        phat_hien_cau_2_2,
        phat_hien_cau_3_3,
        phat_hien_cau_xien,
        phat_hien_cau_lap,
        phat_hien_cau_3_phien,
        phat_hien_diem_dao_chieu,
        phat_hien_tan_suat,
        theo_cau_manh_nhat
    ]
    
    for ham in cac_ham:
        ket_qua, do_tin, mo_ta = ham(history)
        if ket_qua:
            tat_ca.append((ket_qua, do_tin, mo_ta))
    
    # Nếu có dự đoán
    if tat_ca:
        # Ưu tiên các dự đoán có độ tin cậy cao và có "BẺ CẦU"
        uu_tien = []
        for p, dt, mt in tat_ca:
            if "BẺ" in mt:
                uu_tien.append((p, dt + 5, mt))  # Cộng thêm 5% cho quyết định bẻ cầu
            else:
                uu_tien.append((p, dt, mt))
        
        so_T = sum(1 for p, _, _ in uu_tien if p == 'T')
        so_X = len(uu_tien) - so_T
        tong_T = sum(dt for p, dt, _ in uu_tien if p == 'T')
        tong_X = sum(dt for p, dt, _ in uu_tien if p == 'X')
        
        # Tìm phương pháp có độ tin cậy cao nhất để hiển thị
        phuong_phap_tot_nhat = max(uu_tien, key=lambda x: x[1])[2] if uu_tien else "Tổng hợp"
        
        if so_T > so_X or tong_T > tong_X:
            du_doan = 'T'
            do_tin = int(tong_T / (tong_T + tong_X) * 100) if (tong_T + tong_X) > 0 else 65
        else:
            du_doan = 'X'
            do_tin = int(tong_X / (tong_T + tong_X) * 100) if (tong_T + tong_X) > 0 else 65
        
        do_tin = max(60, min(96, do_tin))
        return du_doan, do_tin, f"{phuong_phap_tot_nhat} ({len(tat_ca)} cau)"
    
    # Fallback - không có thuật toán nào hoạt động
    if len(history) >= 3:
        last3 = history[-3:]
        if last3 in ("TTT", "XXX"):
            return ('X' if last3 == "TTT" else 'T'), 70, "Fallback - 3 phiên giống nhau"
        if history[-1] == history[-2]:
            return history[-1], 65, "Fallback - Theo cầu"
        return ('T' if history[-1] == 'X' else 'X'), 65, "Fallback - Đảo cầu"
    
    if len(history) >= 1:
        return history[-1], 60, "Fallback - Theo phiên cuối"
    
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

def parse_session(item, game_type):
    result_raw = item.get("resultTruyenThong", "").upper()
    result = "T" if "TAI" in result_raw else "X" if "XIU" in result_raw else None
    point = item.get("point", 0)
    dices = item.get("dices", [0, 0, 0])
    session_id = item.get("id")
    return result, point, dices, session_id

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

# ================= LUỒNG CẬP NHẬT TỰ ĐỘNG =================
game_cache = {}
cache_lock = threading.Lock()

def auto_fetch_and_cache():
    while True:
        for game_id, config in GAME_CONFIG.items():
            try:
                data = fetch_data(config['api_url'])
                if data and 'list' in data and data['list']:
                    phien_moi_nhat = data['list'][0].get('id')
                    phien_truoc = PHIEN_DA_XU_LY.get(game_id)
                    
                    with cache_lock:
                        game_cache[game_id] = {
                            'data': data,
                            'ts': datetime.now().isoformat()
                        }
                    
                    if phien_moi_nhat and phien_moi_nhat != phien_truoc:
                        PHIEN_DA_XU_LY[game_id] = phien_moi_nhat
                        print(f"[{datetime.now()}] 🔔 PHIEN MOI {game_id}: {phien_moi_nhat}")
                        
            except Exception as e:
                print(f"[{datetime.now()}] Loi auto fetch {game_id}: {e}")
        time.sleep(2)  # Cập nhật mỗi 2 giây

threading.Thread(target=auto_fetch_and_cache, daemon=True).start()

# ================= FLASK API =================
def create_endpoint(game_id):
    def endpoint_func():
        key = request.args.get('key')
        if key != AUTH_KEY:
            return json.dumps({"error": "Truy cap bi tu choi."}), 403
        
        with cache_lock:
            cached = game_cache.get(game_id)
            if not cached:
                return json.dumps({"error": "Dang lay du lieu, vui long thu lai sau."}), 503
            data = cached['data']
        
        history, totals, last_item = build_history(data)
        if not history or not last_item:
            return json.dumps({"error": "Khong co lich su."}), 500
        
        # Lấy thông tin phiên hiện tại
        result, point, dices, phien_hien_tai = parse_session(last_item, "legacy")
        
        phien_key = f"{game_id}_{phien_hien_tai}"
        
        with DU_DOAN_LOCK:
            if phien_key in DU_DOAN_CO_DINH:
                pred = DU_DOAN_CO_DINH[phien_key]["du_doan"]
                do_tin = DU_DOAN_CO_DINH[phien_key]["do_tin_cay"]
                phuong_phap = DU_DOAN_CO_DINH[phien_key]["phuong_phap"]
            else:
                pred, do_tin, phuong_phap = du_doan_thong_minh(history, totals)
                pred, do_tin = bo_can_bang[game_id].can_bang(pred, do_tin)
                bo_can_bang[game_id].them_du_doan(pred)
                
                DU_DOAN_CO_DINH[phien_key] = {
                    "du_doan": pred,
                    "do_tin_cay": do_tin,
                    "phuong_phap": phuong_phap,
                    "thoi_gian": datetime.now().isoformat()
                }
                
                if len(DU_DOAN_CO_DINH) > 1000:
                    keys = list(DU_DOAN_CO_DINH.keys())
                    for k in keys[:200]:
                        del DU_DOAN_CO_DINH[k]
        
        if pred == 'T':
            tai_percent = do_tin
            xiu_percent = 100 - do_tin
        else:
            tai_percent = 100 - do_tin
            xiu_percent = do_tin
        
        ket_qua_str = "Tai" if result == 'T' else "Xiu" if result == 'X' else "?"
        du_doan_str = "Tai" if pred == 'T' else "Xiu"
        
        # Tìm phiên tiếp theo
        phien_tiep_theo = phien_hien_tai + 1 if phien_hien_tai else None
        
        response_data = {
            "phien": phien_hien_tai,
            "phien_hien_tai": phien_tiep_theo,
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
    return endpoint_func

for game_id in GAME_CONFIG:
    app.add_url_rule(f'/api/{game_id}', view_func=create_endpoint(game_id), methods=['GET'])

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({
        "status": "healthy",
        "games": len(GAME_CONFIG),
        "version": ALGO_NAME,
        "cached_phien": PHIEN_DA_XU_LY
    })

@app.route('/', methods=['GET'])
def home():
    return jsonify({
        "service": ALGO_NAME,
        "endpoints": [f"/api/{gid}" for gid in GAME_CONFIG],
        "auth": f"?key={AUTH_KEY}",
        "tinh_nang": "BE CAU THONG MINH | PHAT HIEN CAU | THEO CAU CHINH XAC",
        "mo_ta": "Tu dong phat hien cau va dua ra quyet dinh theo/bẻ cau thong minh nhat"
    })

if __name__ == '__main__':
    import os
    port = int(os.environ.get("PORT", 5000))
    print(f"🚀 {ALGO_NAME} dang chay...")
    print(f"✅ Tinh nang: Phat hien cau thong minh | Be cau chinh xac")
    print(f"✅ Theo cau khi dang ngon | Be cau khi co tin hieu")
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)

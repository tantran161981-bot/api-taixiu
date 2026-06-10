#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
API Flask dự đoán Tài Xỉu SIÊU VIP - Version 11.1 (Bắt cầu thực tế)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✧ Dự đoán 100% phiên | KHÔNG RANDOM
✧ Bắt cầu từ 3 phiên đầu tiên
✧ Cân bằng động | Độ chính xác tối đa
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

import json
import math
import threading
import time
import requests
from flask import Flask, request, jsonify
from collections import defaultdict, deque
from datetime import datetime

app = Flask(__name__)

# ================= CONFIG =================
AUTH_KEY = "truongdong1920"
USER_ID = "@Truongdong1920"
ALGO_NAME = "TRUONGDONG BAT CAU v11.1"

GAME_CONFIG = {
    "lc79_tx": {
        "game_key": "LC79_TX",
        "api_url": "https://wtx.tele68.com/v1/tx/sessions",
        "name": "LC79 Tài Xỉu",
        "type": "legacy"
    },
    "lc79_md5": {
        "game_key": "LC79_MD5",
        "api_url": "https://wtxmd52.tele68.com/v1/txmd5/sessions",
        "name": "LC79 MD5",
        "type": "legacy"
    },
    "betvip_tx": {
        "game_key": "BETVIP_TX",
        "api_url": "https://wtx.macminim6.online/v1/tx/sessions",
        "name": "BETVIP Tài Xỉu",
        "type": "legacy"
    },
    "betvip_md5": {
        "game_key": "BETVIP_MD5",
        "api_url": "https://wtxmd52.macminim6.online/v1/txmd5/sessions",
        "name": "BETVIP MD5",
        "type": "legacy"
    },
    "xenglive_tx": {
        "game_key": "XENGLIVE_TX",
        "api_url": "https://taixiu.backend-98423498294223x1.online/api/luckydice/GetSoiCau",
        "name": "XengLive Tài Xỉu",
        "type": "new"
    },
    "xenglive_md5": {
        "game_key": "XENGLIVE_MD5",
        "api_url": "https://taixiumd5.backend-98423498294223x1.online/api/md5luckydice/GetSoiCau",
        "name": "XengLive MD5",
        "type": "new"
    },
    "xocdia88_tx": {
        "game_key": "XOCDIA88_TX",
        "api_url": "https://taixiu.system32-cloudfare-356783752985678522.monster/api/luckydice/GetSoiCau",
        "name": "XocDia88 Tài Xỉu",
        "type": "new"
    },
    "xocdia88_md5": {
        "game_key": "XOCDIA88_MD5",
        "api_url": "https://taixiumd5.system32-cloudfare-356783752985678522.monster/api/md5luckydice/GetSoiCau",
        "name": "XocDia88 MD5",
        "type": "new"
    }
}

# ================= HỆ THỐNG CÂN BẰNG ĐỘNG =================
class BalanceController:
    def __init__(self, window=100):
        self.predictions = deque(maxlen=window)
        self.actual_results = deque(maxlen=window)
        
    def add_prediction(self, pred):
        self.predictions.append(pred)
        
    def add_result(self, result):
        self.actual_results.append(result)
        
    def get_bias(self):
        if len(self.predictions) < 5:
            return 0.0
        t_count = self.predictions.count('T')
        ratio = t_count / len(self.predictions)
        return (ratio - 0.5) * 2
        
    def correct_prediction(self, pred, confidence):
        bias = self.get_bias()
        if bias > 0.15 and pred == 'T' and confidence < 80:
            return 'X', confidence * 0.85
        elif bias < -0.15 and pred == 'X' and confidence < 80:
            return 'T', confidence * 0.85
        return pred, confidence

balance_controller = BalanceController()

# ================= THUẬT TOÁN BẮT CẦU THỰC TẾ =================
class CauAnalyzer:
    """Phân tích và bắt cầu - KHÔNG RANDOM"""
    
    @staticmethod
    def phat_hien_cau_bet(history):
        """Phát hiện cầu bệt (dây dài)"""
        if len(history) < 2:
            return None, 0
            
        # Đếm độ dài bệt hiện tại
        last = history[-1]
        run = 1
        for i in range(len(history)-2, -1, -1):
            if history[i] == last:
                run += 1
            else:
                break
                
        if run >= 5:
            # Bệt dài => bẻ cầu
            return ('X' if last == 'T' else 'T'), min(88, 70 + run)
        elif run >= 3:
            # Bệt vừa => theo
            return last, min(78, 60 + run)
        elif run >= 2:
            return last, 65
        return None, 0
        
    @staticmethod
    def phat_hien_cau_1_1(history):
        """Cầu 1-1 (T X T X)"""
        if len(history) >= 4:
            last4 = history[-4:]
            if last4 in ("TXTX", "XTXT"):
                next_pred = 'X' if history[-1] == 'T' else 'T'
                return next_pred, 85
        return None, 0
        
    @staticmethod
    def phat_hien_cau_2_2(history):
        """Cầu 2-2 (T T X X)"""
        if len(history) >= 4:
            last4 = history[-4:]
            if last4 in ("TTXX", "XXTT"):
                next_pred = 'T' if history[-2:] == "XX" else 'X'
                return next_pred, 82
        return None, 0
        
    @staticmethod
    def phat_hien_cau_3_3(history):
        """Cầu 3-3 (T T T X X X)"""
        if len(history) >= 6:
            last6 = history[-6:]
            if last6 in ("TTTXXX", "XXXTTT"):
                next_pred = 'X' if history[-3:] == "TTT" else 'T'
                return next_pred, 80
        return None, 0
        
    @staticmethod
    def phat_hien_cau_chan_le(history, totals):
        """Cầu theo tổng chẵn/lẻ"""
        if len(totals) < 3:
            return None, 0
            
        recent = totals[-3:]
        even_count = sum(1 for t in recent if t % 2 == 0)
        
        if even_count >= 2:
            return 'T', 68
        else:
            return 'X', 68
            
    @staticmethod
    def phat_hien_cau_tong_tang(history, totals):
        """Cầu tổng tăng/giảm dần"""
        if len(totals) < 4:
            return None, 0
            
        recent = totals[-4:]
        tang = all(recent[i] <= recent[i+1] for i in range(3))
        giam = all(recent[i] >= recent[i+1] for i in range(3))
        
        if tang:
            return 'T', 72
        elif giam:
            return 'X', 72
        return None, 0
        
    @staticmethod
    def phat_hien_cau_xien(history):
        """Cầu xiên - đan xen đặc biệt"""
        if len(history) >= 5:
            last5 = history[-5:]
            # Mô hình T X X T X
            if last5 == "TXXTX":
                return 'T', 75
            if last5 == "XTTXT":
                return 'X', 75
        return None, 0
        
    @staticmethod
    def phat_hien_cau_lap(history):
        """Cầu lặp - chu kỳ ngắn"""
        if len(history) >= 6:
            # Chu kỳ 2
            if history[-2:] == history[-4:-2] == history[-6:-4]:
                return history[-1], 78
            # Chu kỳ 3
            if len(history) >= 9:
                if history[-3:] == history[-6:-3] == history[-9:-6]:
                    return history[-1], 80
        return None, 0
        
    @staticmethod
    def phan_tich_xac_suat(history):
        """Phân tích xác suất dựa trên lịch sử"""
        if len(history) < 10:
            return None, 0
            
        # Tỷ lệ Tài trong các khung
        ty_le_5 = history[-5:].count('T') / 5
        ty_le_10 = history[-10:].count('T') / 10
        
        # Chênh lệch
        chenh_lech = abs(ty_le_5 - 0.5) - abs(ty_le_10 - 0.5)
        
        if chenh_lech > 0.1:
            if ty_le_5 > 0.5:
                return 'X', 70  # Đang lệch Tài => bẻ về Xỉu
            else:
                return 'T', 70  # Đang lệch Xỉu => bẻ về Tài
        elif ty_le_5 > 0.6:
            return 'X', 72
        elif ty_le_5 < 0.4:
            return 'T', 72
        return None, 0

# ================= QUYẾT ĐỊNH CUỐI CÙNG =================
class QuyetDinhChuan:
    def __init__(self, history, totals):
        self.history = history
        self.totals = totals
        
    def du_doan(self):
        """Tổng hợp tất cả thuật toán - KHÔNG RANDOM"""
        
        danh_sach = []  # (du_doan, do_tin_cay, ten)
        
        # 1. Cầu bệt
        pred, conf = CauAnalyzer.phat_hien_cau_bet(self.history)
        if pred:
            danh_sach.append((pred, conf, "Cầu bệt"))
            
        # 2. Cầu 1-1
        pred, conf = CauAnalyzer.phat_hien_cau_1_1(self.history)
        if pred:
            danh_sach.append((pred, conf, "Cầu 1-1"))
            
        # 3. Cầu 2-2
        pred, conf = CauAnalyzer.phat_hien_cau_2_2(self.history)
        if pred:
            danh_sach.append((pred, conf, "Cầu 2-2"))
            
        # 4. Cầu 3-3
        pred, conf = CauAnalyzer.phat_hien_cau_3_3(self.history)
        if pred:
            danh_sach.append((pred, conf, "Cầu 3-3"))
            
        # 5. Cầu chẵn lẻ
        pred, conf = CauAnalyzer.phat_hien_cau_chan_le(self.history, self.totals)
        if pred:
            danh_sach.append((pred, conf, "Chẵn/Lẻ"))
            
        # 6. Cầu tổng tăng/giảm
        pred, conf = CauAnalyzer.phat_hien_cau_tong_tang(self.history, self.totals)
        if pred:
            danh_sach.append((pred, conf, "Tổng T/G"))
            
        # 7. Cầu xiên
        pred, conf = CauAnalyzer.phat_hien_cau_xien(self.history)
        if pred:
            danh_sach.append((pred, conf, "Cầu xiên"))
            
        # 8. Cầu lặp
        pred, conf = CauAnalyzer.phat_hien_cau_lap(self.history)
        if pred:
            danh_sach.append((pred, conf, "Cầu lặp"))
            
        # 9. Xác suất thống kê
        pred, conf = CauAnalyzer.phan_tich_xac_suat(self.history)
        if pred:
            danh_sach.append((pred, conf, "Xác suất"))
            
        # Nếu CHƯA có dự đoán nào (mới bắt đầu)
        if len(danh_sach) == 0:
            # Dùng quy tắc đơn giản - KHÔNG RANDOM
            if len(self.history) >= 3:
                last3 = self.history[-3:]
                if last3.count('T') >= 2:
                    du_doan = 'T'
                    do_tin_cay = 60
                elif last3.count('X') >= 2:
                    du_doan = 'X'
                    do_tin_cay = 60
                else:
                    # 2-1 hoặc 1-2 => theo phiên cuối
                    du_doan = self.history[-1]
                    do_tin_cay = 58
            elif len(self.history) >= 1:
                du_doan = self.history[-1]
                do_tin_cay = 55
            else:
                # Trường hợp không có lịch sử - dự đoán theo chu kỳ tự nhiên
                # Luân phiên T và X (không random)
                import time
                if int(time.time()) % 2 == 0:
                    du_doan = 'T'
                else:
                    du_doan = 'X'
                do_tin_cay = 52
                
            # Điều chỉnh cân bằng
            du_doan, do_tin_cay = balance_controller.correct_prediction(du_doan, do_tin_cay)
            return du_doan, do_tin_cay, "Cơ bản"
            
        # Tính tổng hợp có trọng số
        tong_T = 0
        tong_X = 0
        
        for pred, conf, _ in danh_sach:
            if pred == 'T':
                tong_T += conf
            else:
                tong_X += conf
                
        tong = tong_T + tong_X
        if tong_T > tong_X:
            du_doan = 'T'
            do_tin_cay = (tong_T / tong) * 100
        else:
            du_doan = 'X'
            do_tin_cay = (tong_X / tong) * 100
            
        # Điều chỉnh cân bằng
        du_doan, do_tin_cay = balance_controller.correct_prediction(du_doan, do_tin_cay)
        
        # Giới hạn độ tin cậy
        do_tin_cay = max(55, min(96, do_tin_cay))
        
        # Lưu lại để cân bằng
        balance_controller.add_prediction(du_doan)
        
        return du_doan, do_tin_cay, f"{len(danh_sach)} thuật toán"

# ================= CÁC HÀM TIỆN ÍCH =================
def fetch_data(url):
    try:
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"Lỗi fetch {url}: {e}")
        return None

def fetch_and_cache(game_id):
    config = GAME_CONFIG.get(game_id)
    if not config:
        return None
    data = fetch_data(config['api_url'])
    if data is not None:
        with cache_lock:
            game_cache[game_id] = {'data': data, 'ts': datetime.now().isoformat()}
    return data

def get_cached_data(game_id):
    with cache_lock:
        cached = game_cache.get(game_id)
        if cached:
            return cached['data']
    return fetch_and_cache(game_id)

def parse_session(item, game_type):
    if game_type == "legacy":
        result_raw = item.get("resultTruyenThong", "").upper()
        result = "T" if "TAI" in result_raw else "X" if "XIU" in result_raw else None
        point = item.get("point", 0)
        dices = item.get("dices", [0,0,0])
        session_id = item.get("id")
    else:
        bet_side = item.get("BetSide")
        result = "T" if bet_side == 0 else "X" if bet_side == 1 else None
        point = item.get("DiceSum", 0)
        dices = [item.get("FirstDice",0), item.get("SecondDice",0), item.get("ThirdDice",0)]
        session_id = item.get("SessionId")
    return result, point, dices, session_id

def build_history(data_list, game_type, max_len=100):
    if not data_list:
        return "", []
    items = data_list['list'] if isinstance(data_list, dict) and 'list' in data_list else data_list
    recent = items[:max_len]
    recent.reverse()
    history = ""
    totals = []
    for item in recent:
        result, point, _, _ = parse_session(item, game_type)
        if result:
            history += result
            totals.append(point)
    return history, totals

# ================= AUTO PING =================
game_cache = {}
cache_lock = threading.Lock()

def ping_all_apis():
    while True:
        for game_id in GAME_CONFIG:
            try:
                fetch_and_cache(game_id)
                print(f"[{datetime.now()}] Ping {game_id} thành công")
            except Exception as e:
                print(f"[{datetime.now()}] Lỗi ping {game_id}: {e}")
        time.sleep(60)

threading.Thread(target=ping_all_apis, daemon=True).start()

# ================= FLASK API =================
def create_endpoint(game_id):
    def endpoint_func():
        key = request.args.get('key')
        if key != AUTH_KEY:
            return json.dumps({"error": "Truy cập bị từ chối."}), 403, {'Content-Type':'application/json'}
            
        config = GAME_CONFIG.get(game_id)
        if not config:
            return json.dumps({"error": "Game không hợp lệ."}), 400, {'Content-Type':'application/json'}
            
        data = get_cached_data(game_id)
        if data is None:
            data = fetch_data(config['api_url'])
            if data is None:
                return json.dumps({"error": "Không thể lấy dữ liệu."}), 500, {'Content-Type':'application/json'}
                
        history, totals = build_history(data, config['type'])
        if not history:
            return json.dumps({"error": "Không có lịch sử."}), 500, {'Content-Type':'application/json'}
            
        if isinstance(data, dict) and 'list' in data:
            current_item = data['list'][0]
        else:
            current_item = data[0] if data else {}
            
        result, point, dices, session_id = parse_session(current_item, config['type'])
        
        if result:
            balance_controller.add_result(result)
        
        # Dự đoán
        qd = QuyetDinhChuan(history, totals)
        pred, conf, method = qd.du_doan()
        
        tai_percent = conf if pred == 'T' else 100 - conf
        xiu_percent = 100 - tai_percent
        
        custom_response = {
            "phien": session_id,
            "xuc_xac": dices,
            "tong": point,
            "ket_qua": "Tài" if result == 'T' else "Xỉu" if result == 'X' else "?",
            "phien_hien_tai": (session_id + 1) if session_id else "?",
            "du_doan": "Tài" if pred == "T" else "Xỉu",
            "do_tin_cay": f"{tai_percent:.0f}%-{xiu_percent:.0f}%",
            "id": USER_ID,
            "ai_model": ALGO_NAME,
            "cau_phat_hien": method,
            "do_lech": f"{balance_controller.get_bias():.2f}"
        }
        
        return app.response_class(
            response=json.dumps(custom_response, ensure_ascii=False, separators=(',', ':')),
            status=200,
            mimetype='application/json'
        )
    endpoint_func.__name__ = f"predict_{game_id}"
    return endpoint_func

for game_id in GAME_CONFIG:
    app.add_url_rule(f'/api/{game_id}', view_func=create_endpoint(game_id), methods=['GET'])

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({
        "status": "healthy",
        "games": len(GAME_CONFIG),
        "version": ALGO_NAME,
        "do_lech": balance_controller.get_bias()
    })

@app.route('/', methods=['GET'])
def home():
    return jsonify({
        "service": ALGO_NAME,
        "endpoints": [f"/api/{gid}" for gid in GAME_CONFIG],
        "auth": f"?key={AUTH_KEY}",
        "tinh_nang": "Bắt cầu thực tế - KHÔNG RANDOM - Dự đoán 100% phiên"
    })

if __name__ == '__main__':
    import os
    print(f"🚀 {ALGO_NAME} đang chạy...")
    print(f"📊 Tính năng: Dự đoán liên tục | Bắt cầu từ 3 phiên")
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)

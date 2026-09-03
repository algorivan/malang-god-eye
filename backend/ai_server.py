"""
MALANG GOD-EYE - AI Backend Server
Uses Flask-SocketIO with threading mode (no eventlet/gevent) for PyTorch compatibility.
"""
import os
import cv2
import threading
import numpy as np
from flask import Flask, request
from flask_socketio import SocketIO
from flask_cors import CORS
from ultralytics import YOLO
import supervision as sv

app = Flask(__name__)
CORS(app)
# Use threading mode — fully compatible with PyTorch + Python 3.14
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# ─── Model Loading ────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, 'yolo11n.pt')
# Prefer custom best.pt if it exists
for candidate in ['models/best.pt', 'yolo-vehicle-detector/models/best.pt']:
    p = os.path.join(BASE_DIR, candidate)
    if os.path.exists(p):
        MODEL_PATH = p
        break

print(f"[AI Server] Loading: {MODEL_PATH}")
model = YOLO(MODEL_PATH)
print(f"[AI Server] Classes: {model.names}")

# ─── Label / Color Maps ───────────────────────────────────────────────────────
LABEL_MAP = {
    'car':        'MOBIL',
    'motorcycle': 'MOTOR',
    'truck':      'TRUK',
    'bus':        'BUS',
    'person':     'PEJALAN',
    'bicycle':    'SEPEDA',
}
COLOR_MAP = {
    'car':        'rgba(56, 189, 248, 1)',
    'motorcycle': 'rgba(16, 185, 129, 1)',
    'truck':      'rgba(245, 158, 11, 1)',
    'bus':        'rgba(251, 146, 60, 1)',
    'person':     'rgba(192, 132, 252, 1)',
    'bicycle':    'rgba(34, 211, 238, 1)',
}

# ─── Active stream registry ───────────────────────────────────────────────────
active_streams = {}   # sid -> stream_url
stream_threads = {}   # sid -> Thread
lock = threading.Lock()


def process_stream(sid: str, stream_url: str):
    """Runs in a daemon thread. Reads video, runs YOLO, emits to client."""
    print(f"[{sid}] Stream start: {stream_url}")
    tracker = sv.ByteTrack()
    cap = cv2.VideoCapture(stream_url)

    if not cap.isOpened():
        socketio.emit('ai_error', {'message': f'Cannot open: {stream_url}'}, room=sid)
        print(f"[{sid}] Cannot open stream.")
        return

    frame_count = 0
    SKIP = 3  # process every 3rd frame

    while True:
        with lock:
            if active_streams.get(sid) != stream_url:
                break  # camera changed or disconnected

        ret, frame = cap.read()
        if not ret:
            print(f"[{sid}] Stream ended.")
            break

        frame_count += 1
        if frame_count % SKIP != 0:
            continue

        img_h, img_w = frame.shape[:2]

        # Inference
        results = model(frame, verbose=False, conf=0.35)[0]
        detections = sv.Detections.from_ultralytics(results)
        detections = tracker.update_with_detections(detections)

        payload = []
        counters = {k: 0 for k in LABEL_MAP}

        for i in range(len(detections.xyxy)):
            xyxy        = detections.xyxy[i]
            conf        = float(detections.confidence[i]) if detections.confidence is not None else 1.0
            cls_id      = int(detections.class_id[i])
            track_id    = int(detections.tracker_id[i]) if detections.tracker_id is not None else -1
            class_name  = model.names.get(cls_id, 'unknown')

            if class_name in counters:
                counters[class_name] += 1

            x1, y1, x2, y2 = xyxy
            payload.append({
                'tracker_id': track_id,
                'class_name': class_name,
                'label':      LABEL_MAP.get(class_name, class_name.upper()),
                'confidence': round(conf, 3),
                'color':      COLOR_MAP.get(class_name, 'rgba(255,255,255,1)'),
                'bbox': [
                    float(x1 / img_w),
                    float(y1 / img_h),
                    float((x2 - x1) / img_w),
                    float((y2 - y1) / img_h),
                ]
            })

        socketio.emit('ai_detections', {
            'detections': payload,
            'counters': counters
        }, room=sid)

    cap.release()
    print(f"[{sid}] Stream thread exiting.")


# ─── Socket.IO Events ─────────────────────────────────────────────────────────
@socketio.on('connect')
def on_connect():
    print(f"[Connect] {request.sid}")


@socketio.on('disconnect')
def on_disconnect():
    sid = request.sid
    with lock:
        active_streams.pop(sid, None)
    print(f"[Disconnect] {sid}")


@socketio.on('start_stream')
def on_start_stream(data):
    sid = request.sid
    stream_url = data.get('stream_url', '').strip()
    if not stream_url:
        return

    with lock:
        active_streams[sid] = stream_url

    # Start background thread
    t = threading.Thread(target=process_stream, args=(sid, stream_url), daemon=True)
    with lock:
        stream_threads[sid] = t
    t.start()
    print(f"[{sid}] Stream requested: {stream_url}")


@socketio.on('stop_stream')
def on_stop_stream():
    sid = request.sid
    with lock:
        active_streams.pop(sid, None)
    print(f"[{sid}] Stream stopped.")


# ─── Entry Point ──────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print("=" * 55)
    print("  MALANG GOD-EYE — YOLOv11 AI Backend (threading)")
    print("  ws://localhost:5000")
    print("=" * 55)
    socketio.run(app, host='0.0.0.0', port=5000, debug=False, allow_unsafe_werkzeug=True)

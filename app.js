/**
 * MALANG GOD-EYE: 253 Public CCTV Enterprise Command Center
 * Live Stream Controller, Smart Route CCTV Corridor & Real-Time AI Object Detection
 * Map: 100% Open Source (Leaflet + OpenStreetMap)
 * AI: Python Backend — YOLOv11n (Ultralytics) + ByteTrack via Socket.IO
 */

// Application State
const STATE = {
  activeCam: null,
  map: null,
  markerCluster: null,
  markers: new Map(),
  currentLayer: 'osm',
  activeDistrict: 'ALL',
  searchQuery: '',
  streamViewMode: 'webview', // 'webview' or 'real'
  audioMuted: false,
  appViewMode: 'map', // 'map' or 'grid'
  matrixLayout: 9, // Default 9 Grid View (3x3)
  matrixDistrict: 'ALL',
  
  // Smart Route Corridor
  activeRouteCorridor: false,
  routeFrom: 'ARJOSARI',
  routeTo: 'TUGU',
  routePolyline: null,
  corridorCameras: [],

  // AI Object Detection via Python Backend (Socket.IO + YOLOv11)
  aiSocket: null,
  aiOverlayEnabled: true,
  aiConnected: false,
  activeRightTab: 'inspect', // 'inspect' or 'detect'
  aiCounters: {
    cars: 0,
    motorcycles: 0,
    trucks: 0,
    buses: 0,
    persons: 0
  },
  lastDetections: []
};

let hlsInstance = null;

// Landmark Coordinates Dictionary for Corridor Routing
const LANDMARK_COORDS = {
  ARJOSARI: [-7.9331, 112.6581],
  SUHAT: [-7.9443, 112.6186],
  UB: [-7.9599, 112.6215],
  KAYUTANGAN: [-7.9789, 112.6294],
  TUGU: [-7.9786, 112.6342],
  PASAR_BESAR: [-7.9859, 112.6334],
  IJEN: [-7.9635, 112.6253],
  GADANG: [-8.0267, 112.6322]
};

// ============================================================================
// WEB AUDIO API (Clean Procedural Feedback)
// ============================================================================
class TacticalAudio {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx && window.userHasInteracted) {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      } catch (e) {}
    }
    if (this.ctx && this.ctx.state === 'suspended' && window.userHasInteracted) {
      this.ctx.resume().catch(() => {});
    }
  }

  playClick() {
    if (STATE.audioMuted) return;
    this.init();
    if (!this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(600, this.ctx.currentTime + 0.03);
      gain.gain.setValueAtTime(0.06, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.03);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.03);
    } catch (e) {}
  }

  playAlert() {
    if (STATE.audioMuted) return;
    this.init();
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(1174, now + 0.06);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.18);
    } catch (e) {}
  }
}

const soundEngine = new TacticalAudio();

// ============================================================================
// REAL-TIME CLOCK ENGINE
// ============================================================================
function updateLiveClocks() {
  const update = () => {
    const now = new Date();
    const wibStr = now.toLocaleTimeString('id-ID', { hour12: false }) + ' WIB';
    const headerClock = document.getElementById('header-wib-clock');
    if (headerClock) headerClock.textContent = wibStr;
  };
  update();
  setInterval(update, 1000);
}

// ============================================================================
// OPEN SOURCE MAP ENGINE (Leaflet + OpenStreetMap)
// ============================================================================
const MAP_LAYERS = {
  osm: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }
  },
  cartodark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    options: {
      maxZoom: 19,
      subdomains: 'abcd',
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }
  },
  hot: {
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    options: {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors, Humanitarian OpenStreetMap Team'
    }
  },
  opentopo: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    options: {
      maxZoom: 17,
      attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)'
    }
  }
};

let currentTileLayer = null;

function initTacticalMap() {
  const mapElement = document.getElementById('malang-map');
  if (!mapElement) return;

  STATE.map = L.map('malang-map', {
    center: [-7.9786, 112.6342], // Alun-Alun Tugu Malang
    zoom: 14,
    zoomControl: false,
    attributionControl: false
  });

  L.control.zoom({ position: 'topright' }).addTo(STATE.map);
  currentTileLayer = L.tileLayer(MAP_LAYERS.osm.url, MAP_LAYERS.osm.options).addTo(STATE.map);

  // Marker Clustering for 253 CCTV nodes
  STATE.markerCluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 40,
    spiderfyOnMaxZoom: true,
    iconCreateFunction: function(cluster) {
      const count = cluster.getChildCount();
      let sizeClass = 'small';
      if (count > 20) sizeClass = 'medium';
      if (count > 50) sizeClass = 'large';
      return L.divIcon({
        html: `<div><span>${count}</span></div>`,
        className: `marker-cluster marker-cluster-${sizeClass}`,
        iconSize: L.point(36, 36)
      });
    }
  });

  MALANG_CCTV_DATA.forEach(cam => {
    const marker = createTacticalMarker(cam);
    STATE.markers.set(cam.id, marker);
    STATE.markerCluster.addLayer(marker);
  });

  STATE.map.addLayer(STATE.markerCluster);

  STATE.map.on('move', () => {
    const center = STATE.map.getCenter();
    const latEl = document.getElementById('telemetry-lat');
    const lngEl = document.getElementById('telemetry-lng');
    if (latEl) latEl.textContent = center.lat.toFixed(5);
    if (lngEl) lngEl.textContent = center.lng.toFixed(5);
  });
}

function createTacticalMarker(cam) {
  const customIcon = L.divIcon({
    className: 'custom-leaflet-marker',
    html: `
      <div class="tactical-marker" data-id="${cam.id}">
        <div class="marker-core">
          <i class="bi bi-camera-video-fill"></i>
        </div>
      </div>
    `,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14]
  });

  const marker = L.marker(cam.coords, { icon: customIcon });

  marker.bindPopup(`
    <div class="tactical-popup">
      <div class="popup-cam-id">${cam.id} // Kec. ${cam.district}</div>
      <div class="popup-title">${cam.name}</div>
      <div class="popup-details">${cam.location}</div>
      <button class="popup-inspect-btn" onclick="selectCamera('${cam.id}')">
        <i class="bi bi-broadcast"></i> BUKA LIVE STREAM
      </button>
    </div>
  `);

  marker.on('click', () => {
    selectCamera(cam.id);
  });

  return marker;
}

function switchMapLayer(layerKey) {
  if (!MAP_LAYERS[layerKey] || !STATE.map) return;
  soundEngine.playClick();
  STATE.currentLayer = layerKey;

  if (currentTileLayer) {
    STATE.map.removeLayer(currentTileLayer);
  }

  currentTileLayer = L.tileLayer(MAP_LAYERS[layerKey].url, MAP_LAYERS[layerKey].options).addTo(STATE.map);

  document.querySelectorAll('.layer-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.layer === layerKey);
  });
}

function jumpToLocation(coords, zoom = 16) {
  soundEngine.playClick();
  if (STATE.map) {
    STATE.map.flyTo(coords, zoom, {
      duration: 1.0,
      easeLinearity: 0.25
    });
  }
}

// ============================================================================
// SMART ROUTE CCTV CORRIDOR & AUTO-SORT SYSTEM
// ============================================================================
function onRouteSelectionChanged() {
  const fromSel = document.getElementById('route-from-select');
  const toSel = document.getElementById('route-to-select');
  if (fromSel) STATE.routeFrom = fromSel.value;
  if (toSel) STATE.routeTo = toSel.value;
}

function calculateRouteCorridor() {
  soundEngine.playClick();
  onRouteSelectionChanged();

  const startKey = STATE.routeFrom;
  const endKey = STATE.routeTo;

  if (!startKey || !endKey) {
    alert("Silakan pilih titik awal (From) dan titik tujuan (To) pada rute!");
    return;
  }

  if (startKey === endKey) {
    alert("Titik awal dan tujuan tidak boleh sama.");
    return;
  }

  const startCoord = LANDMARK_COORDS[startKey];
  const endCoord = LANDMARK_COORDS[endKey];

  // Build corridor waypoints
  const waypoints = [startCoord];
  const midLat = (startCoord[0] + endCoord[0]) / 2;
  const midLng = (startCoord[1] + endCoord[1]) / 2;
  waypoints.push([midLat, midLng]);
  waypoints.push(endCoord);

  if (STATE.routePolyline && STATE.map) {
    STATE.map.removeLayer(STATE.routePolyline);
  }

  STATE.routePolyline = L.polyline(waypoints, {
    color: '#2563eb',
    weight: 6,
    opacity: 0.85,
    dashArray: '10, 10',
    lineCap: 'round'
  }).addTo(STATE.map);

  STATE.map.fitBounds(STATE.routePolyline.getBounds(), { padding: [50, 50] });

  // Calculate distance from each CCTV to the route corridor and sort sequentially
  const corridorMatches = [];
  MALANG_CCTV_DATA.forEach(cam => {
    const dStart = Math.hypot(cam.coords[0] - startCoord[0], cam.coords[1] - startCoord[1]);
    const dEnd = Math.hypot(cam.coords[0] - endCoord[0], cam.coords[1] - endCoord[1]);
    const dTotal = Math.hypot(startCoord[0] - endCoord[0], startCoord[1] - endCoord[1]);

    const bufferDist = (dStart + dEnd) - dTotal;
    if (bufferDist < 0.035) { // ~3km corridor width
      corridorMatches.push({
        cam: cam,
        distFromStart: dStart
      });
    }
  });

  corridorMatches.sort((a, b) => a.distFromStart - b.distFromStart);
  STATE.corridorCameras = corridorMatches.map(m => m.cam);
  STATE.activeRouteCorridor = true;

  const statusBox = document.getElementById('route-status-box');
  const statusText = document.getElementById('route-status-text');
  if (statusBox && statusText) {
    statusBox.style.display = 'block';
    statusText.innerHTML = `<strong>${STATE.corridorCameras.length} CCTV Terdeteksi</strong> di Sepanjang Rute [${startKey} &rarr; ${endKey}]`;
  }

  renderSidebarList();

  if (STATE.corridorCameras.length > 0) {
    selectCamera(STATE.corridorCameras[0].id);
  }
}

function clearRouteCorridor() {
  soundEngine.playClick();
  STATE.activeRouteCorridor = false;
  STATE.corridorCameras = [];

  if (STATE.routePolyline && STATE.map) {
    STATE.map.removeLayer(STATE.routePolyline);
    STATE.routePolyline = null;
  }

  const statusBox = document.getElementById('route-status-box');
  if (statusBox) statusBox.style.display = 'none';

  renderSidebarList();
  if (STATE.appViewMode === 'grid') {
    initMatrixWall();
  }
}

function showCorridorInGrid() {
  soundEngine.playClick();
  setAppViewMode('grid');
}

// ============================================================================
// REAL CCTV LIVE FEED STREAMER
// ============================================================================
function getOptimalStreamUrl(cam) {
  if (!cam) return '';
  if (window.location.protocol.startsWith('http') && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return `/api/stream?id=${cam.stream_id}`;
  }
  return cam.stream_url;
}

function selectCamera(camId) {
  const cam = MALANG_CCTV_DATA.find(c => c.id === camId);
  if (!cam) return;

  STATE.activeCam = cam;
  soundEngine.playClick();

  // Update Inspector Header Info
  const idBadge = document.getElementById('inspector-cam-id');
  if (idBadge) idBadge.textContent = `${cam.id} // Kec. ${cam.district}`;
  const nameEl = document.getElementById('inspector-cam-name');
  if (nameEl) nameEl.textContent = cam.name;
  const locEl = document.getElementById('inspector-cam-location');
  if (locEl) locEl.textContent = `${cam.location} (Kec. ${cam.district})`;

  // Pan map
  if (STATE.map && STATE.appViewMode === 'map') {
    STATE.map.panTo(cam.coords, { animate: true, duration: 0.8 });
  }

  // Highlight list item in sidebar
  document.querySelectorAll('.cctv-card').forEach(card => {
    card.classList.toggle('active', card.dataset.id === cam.id);
  });

  // Load stream
  if (STATE.streamViewMode === 'webview') {
    updateWebviewFrame(cam);
  } else {
    loadRealHlsStream(getOptimalStreamUrl(cam));
  }

  // Notify AI backend of new stream target
  requestAIStreamForCamera(cam);
}

function updateWebviewFrame(cam) {
  const frame = document.getElementById('cctv-webview-frame');
  if (!frame || !cam) return;

  if (window.location.protocol.startsWith('http')) {
    frame.removeAttribute('srcdoc');
    frame.src = `/webview-embed?id=${encodeURIComponent(cam.stream_id)}&name=${encodeURIComponent(cam.name)}&district=${encodeURIComponent(cam.district)}`;
  } else {
    const optimalStream = getOptimalStreamUrl(cam);
    frame.removeAttribute('src');
    frame.srcdoc = `
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="utf-8">
        <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"><\/script>
        <style>
          * { margin:0; padding:0; box-sizing:border-box; }
          body { background:#070b14; color:#f8fafc; font-family:sans-serif; height:100vh; overflow:hidden; display:flex; flex-direction:column; }
          .bar { padding:6px 12px; background:#0f172a; border-bottom:1px solid #1e293b; display:flex; justify-content:space-between; align-items:center; font-size:11px; }
          .cam-name { font-weight:600; color:#60a5fa; }
          .status-dot { color:#10b981; font-weight:600; }
          .player-box { flex:1; position:relative; background:#000; }
          video { width:100%; height:100%; object-fit:contain; }
        </style>
      </head>
      <body>
        <div class="bar">
          <span class="cam-name">${cam.id} // ${cam.name}</span>
          <span class="status-dot">● LIVE STREAM</span>
        </div>
        <div class="player-box">
          <video id="v" autoplay muted controls playsinline></video>
        </div>
        <script>
          const v = document.getElementById('v');
          const streamUrl = '${optimalStream}';
          if (Hls.isSupported()) {
            const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
            hls.loadSource(streamUrl);
            hls.attachMedia(v);
            hls.on(Hls.Events.MANIFEST_PARSED, () => v.play().catch(()=>{}));
          } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
            v.src = streamUrl;
            v.play().catch(()=>{});
          }
        <\/script>
      </body>
      </html>
    `;
  }
}

function loadRealHlsStream(streamUrl) {
  const video = document.getElementById('real-hls-video');
  if (!video) return;

  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }

  if (Hls.isSupported()) {
    hlsInstance = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 90
    });

    hlsInstance.loadSource(streamUrl);
    hlsInstance.attachMedia(video);
    hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(() => {});
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = streamUrl;
    video.play().catch(() => {});
  }
}

function reloadCurrentStream() {
  if (STATE.activeCam) {
    selectCamera(STATE.activeCam.id);
  }
}

function switchStreamViewMode(mode) {
  STATE.streamViewMode = mode;
  soundEngine.playClick();

  const webview = document.getElementById('cctv-webview-frame');
  const video = document.getElementById('real-hls-video');
  const tabWebview = document.getElementById('tab-webview');
  const tabReal = document.getElementById('tab-real-stream');

  if (tabWebview) tabWebview.classList.toggle('active', mode === 'webview');
  if (tabReal) tabReal.classList.toggle('active', mode === 'real');

  if (mode === 'webview') {
    if (webview) webview.style.display = 'block';
    if (video) video.style.display = 'none';
    if (STATE.activeCam) updateWebviewFrame(STATE.activeCam);
  } else {
    if (webview) webview.style.display = 'none';
    if (video) video.style.display = 'block';
    if (STATE.activeCam) loadRealHlsStream(getOptimalStreamUrl(STATE.activeCam));
  }
}

function captureSnapshot() {
  soundEngine.playAlert();
  const video = document.getElementById('real-hls-video');
  const overlayCanvas = document.getElementById('ai-detection-overlay');
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = 1280;
  exportCanvas.height = 720;
  const expCtx = exportCanvas.getContext('2d');

  if (video && !video.paused) {
    try {
      expCtx.drawImage(video, 0, 0, exportCanvas.width, exportCanvas.height);
    } catch (e) {
      expCtx.fillStyle = '#0f172a';
      expCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    }
  } else {
    expCtx.fillStyle = '#0f172a';
    expCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  }

  // Composite AI overlay if enabled
  if (STATE.aiOverlayEnabled && overlayCanvas) {
    expCtx.drawImage(overlayCanvas, 0, 0, exportCanvas.width, exportCanvas.height);
  }

  // Watermark
  expCtx.fillStyle = 'rgba(5, 8, 15, 0.85)';
  expCtx.fillRect(0, 0, exportCanvas.width, 42);
  expCtx.fillStyle = '#38bdf8';
  expCtx.font = 'bold 16px "Inter", sans-serif';
  expCtx.fillText(`MALANG GOD-EYE // ${STATE.activeCam ? STATE.activeCam.name : 'CCTV MALANG'}`, 20, 27);

  const link = document.createElement('a');
  link.download = `GOD-EYE_${STATE.activeCam ? STATE.activeCam.id : 'MALANG'}_${Date.now()}.png`;
  link.href = exportCanvas.toDataURL('image/png');
  link.click();
}

// ============================================================================
// RIGHT SIDEBAR TAB SWITCHER (INSPECT vs AI OBJECT DETECT)
// ============================================================================
function switchRightPanelTab(tabName) {
  STATE.activeRightTab = tabName;
  soundEngine.playClick();

  const tabInspect = document.getElementById('tab-cam-inspect');
  const tabDetect = document.getElementById('tab-ai-detect');
  const viewInspect = document.getElementById('panel-view-inspect');
  const viewDetect = document.getElementById('panel-view-detect');

  if (tabInspect) tabInspect.classList.toggle('active', tabName === 'inspect');
  if (tabDetect) tabDetect.classList.toggle('active', tabName === 'detect');
  if (viewInspect) viewInspect.classList.toggle('active', tabName === 'inspect');
  if (viewDetect) viewDetect.classList.toggle('active', tabName === 'detect');
}

// ============================================================================
// YOLOV11 AI BACKEND — Socket.IO Real Detection Engine
// ============================================================================

function initAISocketConnection() {
  if (typeof io === 'undefined') {
    console.warn('[AI] Socket.IO not loaded, AI backend unavailable.');
    return;
  }

  STATE.aiSocket = io('http://localhost:5000', { transports: ['websocket'] });

  STATE.aiSocket.on('connect', () => {
    STATE.aiConnected = true;
    console.log('[AI] Connected to Python YOLO backend.');
    updateAIStatusBadge(true);
    // If a camera is already active, start streaming its feed to backend
    if (STATE.activeCam) {
      requestAIStreamForCamera(STATE.activeCam);
    }
  });

  STATE.aiSocket.on('disconnect', () => {
    STATE.aiConnected = false;
    console.warn('[AI] Disconnected from YOLO backend.');
    updateAIStatusBadge(false);
  });

  STATE.aiSocket.on('ai_detections', (data) => {
    if (!STATE.aiOverlayEnabled) return;
    STATE.lastDetections = data.detections || [];

    // Update counters from server
    if (data.counters) {
      const c = data.counters;
      STATE.aiCounters.cars += c.car || 0;
      STATE.aiCounters.motorcycles += c.motorcycle || 0;
      STATE.aiCounters.trucks += c.truck || 0;
      STATE.aiCounters.buses += c.bus || 0;
      STATE.aiCounters.persons += c.person || 0;
      updateAICounterUI(data.detections);
    }
  });

  STATE.aiSocket.on('ai_error', (data) => {
    console.error('[AI] Backend error:', data.message);
  });
}

function requestAIStreamForCamera(cam) {
  if (!STATE.aiSocket || !STATE.aiConnected || !cam) return;
  const streamUrl = `/api/stream?id=${cam.stream_id}`;
  STATE.aiSocket.emit('start_stream', { stream_url: cam.stream_url });
}

function stopAIStream() {
  if (!STATE.aiSocket || !STATE.aiConnected) return;
  STATE.aiSocket.emit('stop_stream');
  STATE.lastDetections = [];
}

function updateAIStatusBadge(connected) {
  const badge = document.getElementById('ai-backend-status');
  if (!badge) return;
  badge.textContent = connected ? '● YOLO BACKEND: ONLINE' : '● YOLO BACKEND: OFFLINE';
  badge.style.color = connected ? '#10b981' : '#f43f5e';
}

function toggleAIDetectionOverlay() {
  STATE.aiOverlayEnabled = !STATE.aiOverlayEnabled;
  soundEngine.playClick();

  const btn = document.getElementById('btn-toggle-ai-overlay');
  if (btn) {
    btn.classList.toggle('hud-btn-primary', STATE.aiOverlayEnabled);
    btn.innerHTML = STATE.aiOverlayEnabled ?
      '<i class="bi bi-bounding-box"></i> OVERLAY AI: AKTIF' :
      '<i class="bi bi-bounding-box"></i> OVERLAY AI: NONAKTIF';
  }

  const canvas = document.getElementById('ai-detection-overlay');
  if (canvas && !STATE.aiOverlayEnabled) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    STATE.lastDetections = [];
  }
}

// Tactical Bounding Box Drawing Helper
function drawTacticalBox(ctx, x, y, w, h, label, conf, color, idStr) {
  ctx.fillStyle = color.replace('1)', '0.12)');
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);

  const c = Math.min(10, w / 4, h / 4);
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x, y + c); ctx.lineTo(x, y); ctx.lineTo(x + c, y);
  ctx.moveTo(x + w - c, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + c);
  ctx.moveTo(x, y + h - c); ctx.lineTo(x, y + h); ctx.lineTo(x + c, y + h);
  ctx.moveTo(x + w - c, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - c);
  ctx.stroke();

  const pillText = `${label} ${(conf * 100).toFixed(0)}%`;
  ctx.font = 'bold 10px "JetBrains Mono", monospace';
  const textWidth = ctx.measureText(pillText).width;
  ctx.fillStyle = 'rgba(11, 15, 25, 0.9)';
  ctx.fillRect(x, y - 16, textWidth + 10, 16);
  ctx.fillStyle = color;
  ctx.fillText(pillText, x + 5, y - 4);

  if (idStr) {
    ctx.font = '8.5px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.fillText(idStr, x + 4, y + h - 4);
  }
}

// Canvas render loop — draws whatever is in STATE.lastDetections
function startAIDetectionCanvasLoop() {
  const canvas = document.getElementById('ai-detection-overlay');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function loop() {
    const cw = canvas.width;
    const ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);

    if (STATE.aiOverlayEnabled && STATE.lastDetections.length > 0) {
      STATE.lastDetections.forEach(det => {
        const [nx, ny, nw, nh] = det.bbox;
        const x = nx * cw;
        const y = ny * ch;
        const w = nw * cw;
        const h = nh * ch;
        const idStr = det.tracker_id >= 0 ? `#TRK-${det.tracker_id}` : '';
        drawTacticalBox(ctx, x, y, w, h, det.label || det.class_name.toUpperCase(), det.confidence, det.color || 'rgba(56,189,248,1)', idStr);
      });
    }
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

// ============================================================================
// AI COUNTER UI UPDATER (called from Socket.IO event handler)
// ============================================================================
function updateAICounterUI(detections) {
  const elCars  = document.getElementById('count-cars');
  const elBikes = document.getElementById('count-bikes');
  const elTrucks = document.getElementById('count-trucks');
  const elPeds  = document.getElementById('count-pedestrians');
  const elLogStream = document.getElementById('ai-detection-log-stream');

  if (elCars)   elCars.textContent   = STATE.aiCounters.cars;
  if (elBikes)  elBikes.textContent  = STATE.aiCounters.motorcycles;
  if (elTrucks) elTrucks.textContent = STATE.aiCounters.trucks + STATE.aiCounters.buses;
  if (elPeds)   elPeds.textContent   = STATE.aiCounters.persons;

  if (elLogStream && detections && detections.length > 0) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('id-ID', { hour12: false });
    detections.slice(0, 3).forEach(det => {
      const typeKey = det.class_name;
      const logDiv = document.createElement('div');
      logDiv.className = `ai-log-item ${typeKey === 'car' ? 'car' : typeKey === 'motorcycle' ? 'bike' : typeKey === 'person' ? 'person' : 'truck'}`;
      logDiv.innerHTML = `
        <span>[${timeStr}] ${det.label || det.class_name.toUpperCase()} #${det.tracker_id}</span>
        <strong style="color:#60a5fa;">${(det.confidence * 100).toFixed(1)}%</strong>
      `;
      elLogStream.insertBefore(logDiv, elLogStream.firstChild);
      if (elLogStream.children.length > 25) {
        elLogStream.removeChild(elLogStream.lastChild);
      }
    });
  }
}

function resetAICounters() {
  soundEngine.playClick();
  STATE.aiCounters = { cars: 0, motorcycles: 0, trucks: 0, buses: 0, persons: 0 };
  STATE.lastDetections = [];
  ['count-cars','count-bikes','count-trucks','count-pedestrians'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = 0;
  });
  const el = document.getElementById('ai-detection-log-stream');
  if (el) el.innerHTML = '';
}

// ============================================================================
// DIRECT IN-PAGE MULTI-GRID VIEW (4, 6, 9-GRID LIVE FEEDS)
// ============================================================================
function setAppViewMode(mode) {
  STATE.appViewMode = mode;
  soundEngine.playClick();

  const btnMap = document.getElementById('btn-view-map');
  const btnGrid = document.getElementById('btn-view-grid');
  const mapEl = document.getElementById('map-viewport');
  const gridEl = document.getElementById('matrix-viewport');

  if (btnMap) btnMap.classList.toggle('active', mode === 'map');
  if (btnGrid) btnGrid.classList.toggle('active', mode === 'grid');

  if (mode === 'map') {
    if (mapEl) mapEl.style.display = 'block';
    if (gridEl) gridEl.style.display = 'none';
    switchRightPanelTab('inspect');
    if (STATE.map) {
      setTimeout(() => { STATE.map.invalidateSize(); }, 50);
    }
  } else {
    if (mapEl) mapEl.style.display = 'none';
    if (gridEl) gridEl.style.display = 'flex';
    switchRightPanelTab('detect');
    initMatrixWall();
  }
}

function setMatrixLayout(layout) {
  STATE.matrixLayout = layout;
  soundEngine.playClick();

  document.querySelectorAll('.matrix-layout-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.grid) === layout);
  });

  const subtitle = document.getElementById('matrix-active-info');
  if (subtitle) {
    const dim = layout === 9 ? '3x3' : (layout === 6 ? '3x2' : '2x2');
    const sourceInfo = STATE.activeRouteCorridor ? `Koridor Rute [${STATE.routeFrom} &rarr; ${STATE.routeTo}]` : `${layout} Live Feed Aktif`;
    subtitle.innerHTML = `Mode ${layout}-Grid View (${dim}) // ${sourceInfo}`;
  }

  initMatrixWall();
}

function changeMatrixDistrict(district) {
  STATE.matrixDistrict = district;
  soundEngine.playClick();
  initMatrixWall();
}

function initMatrixWall() {
  const container = document.getElementById('matrix-grid-wall');
  if (!container) return;

  const layout = STATE.matrixLayout || 9;
  container.className = `matrix-grid-container layout-${layout}`;

  let candidates = [];
  if (STATE.activeRouteCorridor && STATE.corridorCameras.length > 0) {
    candidates = STATE.corridorCameras;
  } else if (STATE.matrixDistrict && STATE.matrixDistrict !== 'ALL') {
    candidates = MALANG_CCTV_DATA.filter(c => c.district.toLowerCase() === STATE.matrixDistrict.toLowerCase());
  } else {
    candidates = MALANG_CCTV_DATA;
  }

  if (candidates.length === 0) candidates = MALANG_CCTV_DATA;

  const wallCams = candidates.slice(0, layout);

  container.innerHTML = wallCams.map((cam, idx) => {
    const embedUrl = `/webview-embed?id=${encodeURIComponent(cam.stream_id)}&name=${encodeURIComponent(cam.name)}`;
    const stepBadge = STATE.activeRouteCorridor ? `RUTE-0${idx + 1}` : `CH-0${idx + 1}`;
    return `
      <div class="matrix-cam-card" onclick="selectCamera('${cam.id}')" title="Klik untuk fokus pada kamera ${cam.name}">
        <div class="matrix-card-header">
          <span class="matrix-tag">${stepBadge} // ${cam.id}</span>
          <span class="matrix-status-pill"><span class="live-indicator-dot" style="width:4px;height:4px;"></span> LIVE</span>
        </div>
        <iframe src="${embedUrl}" allow="autoplay; fullscreen; encrypted-media"></iframe>
        <div class="matrix-card-footer">
          <span class="matrix-title-label">${cam.name} (Kec. ${cam.district})</span>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================================================
// SIDEBAR CATALOGUE & SEARCH FILTER
// ============================================================================
function renderSidebarList() {
  const container = document.getElementById('cctv-node-list');
  if (!container) return;

  let dataset = MALANG_CCTV_DATA;
  if (STATE.activeRouteCorridor && STATE.corridorCameras.length > 0) {
    dataset = STATE.corridorCameras;
  }

  const filtered = dataset.filter(cam => {
    const matchesDistrict = STATE.activeRouteCorridor || STATE.activeDistrict === 'ALL' || cam.district.toLowerCase() === STATE.activeDistrict.toLowerCase();
    const q = STATE.searchQuery.toLowerCase().trim();
    const matchesQuery = !q || 
      cam.name.toLowerCase().includes(q) || 
      cam.location.toLowerCase().includes(q) || 
      cam.id.toLowerCase().includes(q) ||
      cam.stream_id.toLowerCase().includes(q);
    return matchesDistrict && matchesQuery;
  });

  const countBadge = document.getElementById('cctv-count-badge');
  if (countBadge) {
    countBadge.textContent = STATE.activeRouteCorridor ? `${filtered.length} Rute` : `${filtered.length} Titik`;
  }

  container.innerHTML = filtered.map((cam, idx) => {
    const isActive = STATE.activeCam && STATE.activeCam.id === cam.id;
    const tagText = STATE.activeRouteCorridor ? `URUTAN ${idx + 1}` : cam.id;
    return `
      <div class="cctv-card ${isActive ? 'active' : ''}" data-id="${cam.id}" onclick="selectCamera('${cam.id}')">
        <div class="cctv-card-top">
          <span class="cctv-card-id">${tagText}</span>
          <span class="cctv-card-status online">
            <span class="live-indicator-dot" style="width:5px;height:5px;"></span> LIVE FEED
          </span>
        </div>
        <div class="cctv-card-title">${cam.name}</div>
        <div class="cctv-card-location"><i class="bi bi-geo-alt"></i> ${cam.location}</div>
        <div class="cctv-card-footer">
          <span class="cctv-card-district"><i class="bi bi-buildings"></i> Kec. ${cam.district}</span>
          <span class="cctv-card-res">HLS LIVE</span>
        </div>
      </div>
    `;
  }).join('');
}

function filterByDistrict(districtId) {
  if (STATE.activeRouteCorridor) {
    clearRouteCorridor();
  }
  STATE.activeDistrict = districtId;
  soundEngine.playClick();
  document.querySelectorAll('.district-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.district === districtId);
  });
  renderSidebarList();
}

function updateTickerFeed() {
  let index = 0;
  const tickerEl = document.getElementById('ticker-text-content');
  if (!tickerEl) return;

  const cycle = () => {
    if (typeof SYSTEM_LOGS !== 'undefined' && SYSTEM_LOGS.length > 0) {
      const log = SYSTEM_LOGS[index % SYSTEM_LOGS.length];
      tickerEl.innerHTML = `<span style="color:var(--primary-blue)">[${log.time}]</span> ${log.text}`;
      index++;
    }
  };
  cycle();
  setInterval(cycle, 5000);
}

// ============================================================================
// APPLICATION BOOTSTRAP
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  updateLiveClocks();
  initTacticalMap();
  renderSidebarList();

  // Select first real camera
  if (MALANG_CCTV_DATA.length > 0) {
    selectCamera(MALANG_CCTV_DATA[0].id);
  }

  updateTickerFeed();
  startAIDetectionCanvasLoop();  // Starts the canvas render loop (reads STATE.lastDetections)
  initAISocketConnection();      // Connects to Python YOLO backend via Socket.IO

  // Search input handler
  const searchInput = document.getElementById('search-camera-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      STATE.searchQuery = e.target.value;
      renderSidebarList();
    });
  }

  // Audio Toggle
  const audioBtn = document.getElementById('audio-toggle-btn');
  if (audioBtn) {
    audioBtn.addEventListener('click', () => {
      STATE.audioMuted = !STATE.audioMuted;
      audioBtn.classList.toggle('muted', STATE.audioMuted);
      audioBtn.innerHTML = STATE.audioMuted ? 
        '<i class="bi bi-volume-mute"></i> AUDIO MATI' : 
        '<i class="bi bi-volume-up"></i> AUDIO AKTIF';
      if (!STATE.audioMuted) soundEngine.playClick();
    });
  }

  window.addEventListener('pointerdown', () => { window.userHasInteracted = true; }, { once: true });
});

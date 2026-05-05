// ===== GasKo App: UI Controller =====

const App = {
  map: null, marker: null, routeLine: null, detailMap: null,
  charts: {}, currentPage: 'dashboard',
  _wakeLock: null, _trackingNotif: null, _notifTick: 0,
  _visibilityHandler: null, _unloadHandler: null, _wasPaused: false,

  // ---- Init ----
  init() {
    this.bindNav();
    this.bindControls();
    this.bindSettings();
    this.bindCalibration();
    this.bindAuth();
    this.bindDataMgmt();
    this.initMap();
    this.loadSettings();
    this.renderTrips();
    this.renderCalibrationLog();
    this.initCharts();
    this.updateChartsData();
    // Show current version in About section
    const vEl = document.getElementById('app-version');
    if (vEl && typeof GASKO_VERSION !== 'undefined') vEl.textContent = 'Version ' + GASKO_VERSION;
    // Init Supabase (offline-safe: falls back to localStorage)
    CloudSync.init();
  },

  // ---- Toast ----
  toast(msg, type = 'info') {
    const c = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
  },

  // ---- Navigation ----
  bindNav() {
    document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
      btn.addEventListener('click', () => this.showPage(btn.dataset.page));
    });
    document.getElementById('btn-menu')?.addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
      document.getElementById('sidebar-overlay').classList.toggle('active');
    });
    document.getElementById('sidebar-overlay')?.addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebar-overlay').classList.remove('active');
    });
    document.getElementById('btn-dismiss-disclaimer')?.addEventListener('click', () => {
      document.getElementById('disclaimer-banner').classList.add('hidden');
    });
  },

  showPage(page) {
    this.currentPage = page;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + page)?.classList.add('active');
    document.querySelectorAll('.nav-item[data-page]').forEach(b => {
      b.classList.toggle('active', b.dataset.page === page);
    });
    // Close mobile sidebar
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebar-overlay')?.classList.remove('active');
    if (page === 'trips') this.renderTrips();
    if (page === 'calibrate') { this.renderCalibrationLog(); this.updateCalChart(); }
    if (page === 'dashboard') { this.updateChartsData(); if (this.map) this.map.invalidateSize(); }
    if (page === 'friends') this.loadFriendsPage();
  },

  // ---- Map ----
  initMap() {
    this.map = L.map('map', { zoomControl: true, attributionControl: true }).setView([14.5995, 120.9842], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 19
    }).addTo(this.map);

    const pulseIcon = L.divIcon({ className: '', html: '<div class="pulse-marker"></div>', iconSize: [16, 16], iconAnchor: [8, 8] });
    this.marker = L.marker([14.5995, 120.9842], { icon: pulseIcon }).addTo(this.map);
    this.routeLine = L.polyline([], { color: '#a855f7', weight: 3, opacity: 0.8 }).addTo(this.map);

    setTimeout(() => this.map.invalidateSize(), 300);
  },

  updateMap() {
    const pos = GasKo.state.positions;
    if (!pos.length) return;
    const last = pos[pos.length - 1];
    this.marker.setLatLng([last.lat, last.lng]);
    this.routeLine.setLatLngs(pos.map(p => [p.lat, p.lng]));
    this.map.panTo([last.lat, last.lng]);
  },

  // ---- Controls ----
  bindControls() {
    document.getElementById('btn-start-trip').addEventListener('click', () => this.startTrip());
    document.getElementById('btn-end-trip').addEventListener('click', () => this.endTrip());
    document.getElementById('btn-simulate').addEventListener('click', () => this.toggleSimulation());
    document.getElementById('btn-export-csv').addEventListener('click', () => GasKo.exportCSV());
  },

  startTrip() {
    GasKo.startTracking();
    document.getElementById('btn-start-trip').disabled = true;
    document.getElementById('btn-end-trip').disabled = false;
    document.getElementById('btn-simulate').disabled = true;
    document.getElementById('timer-dot').classList.add('active');
    document.querySelectorAll('.stat-card').forEach(c => c.classList.add('glow'));
    this.startTimer();
    this.startAmbient();
    this.toast('Trip started! GPS tracking active.', 'success');
  },

  endTrip() {
    const trip = GasKo.endTrip();
    document.getElementById('btn-start-trip').disabled = false;
    document.getElementById('btn-end-trip').disabled = true;
    document.getElementById('btn-simulate').disabled = false;
    document.getElementById('btn-simulate').classList.remove('active');
    document.getElementById('timer-dot').classList.remove('active');
    document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('glow'));
    this.stopTimer();
    this.stopAmbient();
    this.toast(`Trip saved! ${trip.distance.toFixed(2)} km | ₱${trip.cost.toFixed(2)}`, 'success');
    this.updateChartsData();
    this.updateDashboard();
    // Cloud sync (offline-safe: saves locally first, syncs when online)
    if (CloudSync.isLoggedIn() && navigator.onLine) {
      CloudSync.saveTrip(trip).catch(() => {});
    }
  },

  toggleSimulation() {
    if (GasKo.state.simulating) {
      this.endTrip();
    } else {
      GasKo.startSimulation();
      document.getElementById('btn-start-trip').disabled = true;
      document.getElementById('btn-end-trip').disabled = false;
      document.getElementById('btn-simulate').classList.add('active');
      document.getElementById('timer-dot').classList.add('active');
      document.querySelectorAll('.stat-card').forEach(c => c.classList.add('glow'));
      this.startTimer();
      this.toast('Demo mode active! Simulating GPS movement.', 'info');
    }
  },

  startTimer() {
    this.stopTimer();
    GasKo.state.timerInterval = setInterval(() => {
      if (!GasKo.state.tripStart) return;
      const elapsed = Date.now() - GasKo.state.tripStart;
      const h = Math.floor(elapsed / 3600000);
      const m = Math.floor((elapsed % 3600000) / 60000);
      const s = Math.floor((elapsed % 60000) / 1000);
      document.getElementById('timer-display').textContent =
        `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      this.updateDashboard();
      // Update tracking notification every 15s
      this._notifTick++;
      if (this._notifTick % 15 === 0) this._updateTrackingNotif();
    }, 1000);
  },
  stopTimer() { clearInterval(GasKo.state.timerInterval); },

  // ---- Ambient: Wake Lock + Notification + Visibility ----
  async startAmbient() {
    // 1. Screen Wake Lock — prevents screen from sleeping during trip
    if ('wakeLock' in navigator) {
      try {
        this._wakeLock = await navigator.wakeLock.request('screen');
        console.log('GasKo: Wake Lock acquired ✓');
        this._wakeLock.addEventListener('release', () => {
          // Re-acquire if trip still active (e.g. user plugged in charger)
          if (GasKo.state.tracking) this.startAmbient();
        });
      } catch(e) { console.warn('GasKo: Wake Lock unavailable:', e.message); }
    }

    // 2. Persistent notification in notification bar
    if ('Notification' in window) {
      if (Notification.permission === 'default') {
        await Notification.requestPermission();
      }
      this._updateTrackingNotif();
    }

    // 3. Tracking status bar
    const bar = document.getElementById('tracking-bar');
    if (bar) bar.classList.remove('hidden');

    // 4. Detect background / foreground switch
    this._wasPaused = false;
    this._visibilityHandler = () => {
      if (document.hidden && GasKo.state.tracking) {
        this._wasPaused = true;
      } else if (!document.hidden && this._wasPaused) {
        this._wasPaused = false;
        this._showBgWarning();
      }
    };
    document.addEventListener('visibilitychange', this._visibilityHandler);

    // 5. Warn before closing tab/browser
    this._unloadHandler = e => {
      e.preventDefault();
      e.returnValue = 'A trip is being recorded. Leave anyway?';
    };
    window.addEventListener('beforeunload', this._unloadHandler);
  },

  stopAmbient() {
    // Release wake lock
    if (this._wakeLock) { this._wakeLock.release(); this._wakeLock = null; }
    // Close notification
    if (this._trackingNotif) { this._trackingNotif.close(); this._trackingNotif = null; }
    // Hide tracking bar
    const bar = document.getElementById('tracking-bar');
    if (bar) bar.classList.add('hidden');
    const warn = document.getElementById('bg-warning-banner');
    if (warn) warn.classList.add('hidden');
    // Remove event listeners
    if (this._visibilityHandler) document.removeEventListener('visibilitychange', this._visibilityHandler);
    if (this._unloadHandler) window.removeEventListener('beforeunload', this._unloadHandler);
    this._visibilityHandler = null; this._unloadHandler = null;
  },

  _updateTrackingNotif() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!GasKo.state.tracking) return;
    const st = GasKo.state;
    const dist = st.totalDistance.toFixed(2);
    const speed = st.currentSpeed;
    const elapsed = Date.now() - (st.tripStart || Date.now());
    const min = Math.floor(elapsed / 60000);
    if (this._trackingNotif) this._trackingNotif.close();
    this._trackingNotif = new Notification('GasKo — Trip Recording 🚗', {
      body: `📍 ${dist} km  ⚡ ${speed} km/h  ⏱ ${min} min\nKeep GasKo open for continuous GPS tracking.`,
      tag: 'gasko-tracking',
      silent: true,
      requireInteraction: true
    });
    this._trackingNotif.onclick = () => { window.focus(); this._trackingNotif.close(); };
  },

  _showBgWarning() {
    const warn = document.getElementById('bg-warning-banner');
    if (warn) {
      warn.classList.remove('hidden');
      // Auto-hide after 10s
      clearTimeout(this._warnTimeout);
      this._warnTimeout = setTimeout(() => warn.classList.add('hidden'), 10000);
    }
    this.toast('⚠️ GPS paused while app was in background', 'error');
  },


  // ---- Update Dashboard ----
  updateDashboard() {
    const st = GasKo.state;
    document.getElementById('stat-speed').textContent = st.currentSpeed;
    document.getElementById('stat-distance').textContent = st.totalDistance.toFixed(2);
    const maxSpeedEl = document.getElementById('stat-max-speed');
    if (maxSpeedEl) maxSpeedEl.textContent = Math.round(st.maxSpeed);
    const fuel = GasKo.calcFuel(st.totalDistance);
    const cost = GasKo.calcCost(fuel);
    document.getElementById('stat-fuel').textContent = fuel.toFixed(3);
    document.getElementById('stat-cost').textContent = '₱' + cost.toFixed(2);

    // Speed gauge
    const pct = Math.min(st.currentSpeed / 200, 1);
    const arc = document.getElementById('gauge-arc');
    if (arc) arc.style.strokeDashoffset = 251.2 * (1 - pct);
    const gt = document.getElementById('gauge-speed-text');
    if (gt) gt.textContent = st.currentSpeed;

    // Map
    this.updateMap();

    // Behavior insight
    const insight = GasKo.getBehaviorInsight();
    const ib = document.getElementById('behavior-insight');
    const it = document.getElementById('insight-text');
    if (insight && ib && it) {
      ib.classList.remove('hidden');
      it.textContent = insight.text;
    }
  },

  // ---- Charts ----
  initCharts() {
    const gridColor = 'rgba(255,255,255,0.05)';
    const textColor = '#64748b';
    const defaults = { responsive: true, maintainAspectRatio: true,
      plugins: { legend: { labels: { color: textColor, font: { family: 'Inter', size: 11 } } } },
      scales: { x: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor } },
               y: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor } } }
    };

    this.charts.efficiency = new Chart(document.getElementById('chart-efficiency'), {
      type: 'line',
      data: { labels: [], datasets: [{ label: 'Efficiency (km/L)', data: [], borderColor: '#a855f7', backgroundColor: 'rgba(168,85,247,0.1)', fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: '#a855f7' }] },
      options: { ...defaults }
    });

    this.charts.cost = new Chart(document.getElementById('chart-cost'), {
      type: 'bar',
      data: { labels: [], datasets: [{ label: 'Cost (₱)', data: [], backgroundColor: 'rgba(74,222,128,0.6)', borderColor: '#4ade80', borderWidth: 1, borderRadius: 4 }] },
      options: { ...defaults }
    });

    this.charts.fuelDist = new Chart(document.getElementById('chart-fuel-dist'), {
      type: 'doughnut',
      data: { labels: [], datasets: [{ data: [], backgroundColor: ['#a855f7','#4ade80','#22d3ee','#fbbf24','#f43f5e','#818cf8','#fb923c','#2dd4bf'], borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: true,
        plugins: { legend: { position: 'bottom', labels: { color: textColor, font: { family: 'Inter', size: 11 }, padding: 12 } } } }
    });

    this.charts.calEff = new Chart(document.getElementById('chart-cal-efficiency'), {
      type: 'line',
      data: { labels: [], datasets: [{ label: 'Calibrated Efficiency', data: [], borderColor: '#4ade80', backgroundColor: 'rgba(74,222,128,0.1)', fill: true, tension: 0.4, pointRadius: 5, pointBackgroundColor: '#4ade80' }] },
      options: { ...defaults }
    });
  },

  updateChartsData() {
    const trips = GasKo.getTrips().slice().reverse();
    const labels = trips.map((t, i) => 'Trip ' + (i + 1));

    // Efficiency chart
    this.charts.efficiency.data.labels = labels;
    this.charts.efficiency.data.datasets[0].data = trips.map(t => +(t.efficiencyUsed || 0).toFixed(1));
    this.charts.efficiency.update();

    // Cost chart
    this.charts.cost.data.labels = labels.slice(-10);
    this.charts.cost.data.datasets[0].data = trips.slice(-10).map(t => +t.cost.toFixed(2));
    this.charts.cost.update();

    // Fuel distribution
    const fuelData = trips.slice(-8);
    this.charts.fuelDist.data.labels = fuelData.map((t, i) => 'Trip ' + (trips.indexOf(t) + 1));
    this.charts.fuelDist.data.datasets[0].data = fuelData.map(t => +t.fuelUsed.toFixed(3));
    this.charts.fuelDist.update();
  },

  updateCalChart() {
    const logs = GasKo.getFuelLogs().slice().reverse();
    this.charts.calEff.data.labels = logs.map((l, i) => 'Log ' + (i + 1));
    this.charts.calEff.data.datasets[0].data = logs.map(l => +l.efficiency.toFixed(1));
    this.charts.calEff.update();
  },

  // ---- Trips Page ----
  renderTrips() {
    const trips = GasKo.getTrips();
    const list = document.getElementById('trips-list');
    const empty = document.getElementById('trips-empty');

    // Summary stats
    document.getElementById('total-trips-count').textContent = trips.length;
    document.getElementById('total-distance-all').textContent = trips.reduce((s,t) => s + t.distance, 0).toFixed(1) + ' km';
    document.getElementById('total-fuel-all').textContent = trips.reduce((s,t) => s + t.fuelUsed, 0).toFixed(1) + ' L';
    document.getElementById('total-cost-all').textContent = '₱' + trips.reduce((s,t) => s + t.cost, 0).toFixed(0);

    // Clear old cards (keep empty state)
    list.querySelectorAll('.trip-card').forEach(c => c.remove());

    if (!trips.length) { if (empty) empty.style.display = ''; return; }
    if (empty) empty.style.display = 'none';

    trips.forEach((t, i) => {
      const card = document.createElement('div');
      card.className = 'trip-card';
      card.innerHTML = `
        <div class="trip-card-number">${trips.length - i}</div>
        <div class="trip-card-info">
          <h3>${new Date(t.startTime).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</h3>
          <p>${new Date(t.startTime).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })} — ${((t.duration||0)/60000).toFixed(0)} min</p>
        </div>
        <div class="trip-card-metrics">
          <div class="trip-metric"><span class="trip-metric-val">${t.distance.toFixed(2)} km</span><span class="trip-metric-label">Distance</span></div>
          <div class="trip-metric"><span class="trip-metric-val">${t.fuelUsed.toFixed(2)} L</span><span class="trip-metric-label">Fuel</span></div>
          <div class="trip-metric"><span class="trip-metric-val">₱${t.cost.toFixed(0)}</span><span class="trip-metric-label">Cost</span></div>
        </div>`;
      card.addEventListener('click', () => this.showTripDetail(t));
      list.appendChild(card);
    });
  },

  showTripDetail(trip) {
    const modal = document.getElementById('trip-detail-modal');
    modal.classList.remove('hidden');
    document.getElementById('modal-trip-title').textContent = 'Trip — ' + new Date(trip.startTime).toLocaleDateString();

    // Stats
    const statsDiv = document.getElementById('trip-detail-stats');
    statsDiv.innerHTML = `
      <div class="trip-detail-stat"><div class="td-val">${trip.distance.toFixed(2)} km</div><div class="td-label">Distance</div></div>
      <div class="trip-detail-stat"><div class="td-val">${trip.fuelUsed.toFixed(3)} L</div><div class="td-label">Fuel Used</div></div>
      <div class="trip-detail-stat"><div class="td-val">₱${trip.cost.toFixed(2)}</div><div class="td-label">Cost</div></div>
      <div class="trip-detail-stat"><div class="td-val">${(trip.avgSpeed||0).toFixed(1)}</div><div class="td-label">Avg km/h</div></div>
      <div class="trip-detail-stat"><div class="td-val">${(trip.maxSpeed||0).toFixed(0)}</div><div class="td-label">Max km/h</div></div>
      <div class="trip-detail-stat"><div class="td-val">${(trip.drivingScore||0).toFixed(0)}/100</div><div class="td-label">Drive Score</div></div>`;

    // Insights
    const insDiv = document.getElementById('trip-detail-insights');
    insDiv.innerHTML = `<h3>Driving Insight</h3><p>${trip.behaviorInsight || 'No behavior data for this trip.'}</p>`;

    // Map
    const mapDiv = document.getElementById('trip-detail-map');
    if (this.detailMap) { this.detailMap.remove(); this.detailMap = null; }
    this.detailMap = L.map(mapDiv, { zoomControl: false }).setView([14.5995, 120.9842], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 19 }).addTo(this.detailMap);
    if (trip.route && trip.route.length > 0) {
      const latlngs = trip.route.map(p => [p.lat, p.lng]);
      L.polyline(latlngs, { color: '#a855f7', weight: 3, opacity: 0.6 }).addTo(this.detailMap);
      this.detailMap.fitBounds(latlngs);
      L.circleMarker(latlngs[0], { radius: 8, color: '#4ade80', fillColor: '#4ade80', fillOpacity: 1 }).bindTooltip('Start').addTo(this.detailMap);
      L.circleMarker(latlngs[latlngs.length-1], { radius: 8, color: '#f43f5e', fillColor: '#f43f5e', fillOpacity: 1 }).bindTooltip('End').addTo(this.detailMap);
    }
    setTimeout(() => this.detailMap.invalidateSize(), 200);

    // Replay button visibility
    const hasRoute = trip.route && trip.route.length > 1;
    const replayBtn = document.getElementById('btn-replay-trip');
    if (replayBtn) {
      replayBtn.style.display = hasRoute ? 'flex' : 'none';
      replayBtn.onclick = () => this.startReplay(trip);
    }

    // Close & delete handlers
    const closeModal = () => {
      this.stopReplay();
      modal.classList.add('hidden');
    };
    document.getElementById('btn-close-modal').onclick = closeModal;
    modal.querySelector('.modal-overlay').onclick = closeModal;
    document.getElementById('btn-delete-trip').onclick = () => {
      const trips = GasKo.getTrips().filter(t => t.id !== trip.id);
      GasKo.saveTrips(trips);
      // Also delete from cloud + mark as deleted to prevent re-sync
      if (CloudSync.isLoggedIn()) CloudSync.deleteTrip(trip.id).catch(() => {});
      closeModal();
      this.renderTrips();
      this.updateChartsData();
      this.toast('Trip deleted', 'info');
    };
  },

  // ---- Trip Replay ----
  _replay: { interval: null, index: 0, marker: null, speed: 1 },

  startReplay(trip) {
    this.stopReplay();
    const route = trip.route;
    if (!route || route.length < 2) { this.toast('No GPS data for this trip', 'info'); return; }

    // Show replay panel
    const panel = document.getElementById('replay-panel');
    panel.classList.remove('hidden');

    // Reset state
    this._replay.index = 0;
    this._replay.speed = parseInt(document.getElementById('replay-speed')?.value || '2');

    // Create animated marker
    const startLatLng = [route[0].lat, route[0].lng];
    this._replay.marker = L.circleMarker(startLatLng, {
      radius: 10, color: '#22d3ee', fillColor: '#22d3ee', fillOpacity: 0.9,
      className: 'replay-marker-pulse'
    }).addTo(this.detailMap);
    this.detailMap.setView(startLatLng, 16);

    // Draw ghost route
    const fullRoute = route.map(p => [p.lat, p.lng]);
    const ghostLine = L.polyline(fullRoute, { color: '#22d3ee', weight: 3, opacity: 0.3, dashArray: '4 6' }).addTo(this.detailMap);
    const activeLine = L.polyline([], { color: '#22d3ee', weight: 4, opacity: 0.9 }).addTo(this.detailMap);
    this._replay._ghostLine = ghostLine;
    this._replay._activeLine = activeLine;

    const totalPts = route.length;
    const progressBar = document.getElementById('replay-progress');
    const speedDisplay = document.getElementById('replay-speed-display');
    const timeDisplay = document.getElementById('replay-time-display');

    const step = () => {
      const i = this._replay.index;
      if (i >= totalPts) { this.stopReplay(); return; }

      const pt = route[i];
      const latlng = [pt.lat, pt.lng];
      this._replay.marker.setLatLng(latlng);
      this.detailMap.panTo(latlng, { animate: true, duration: 0.3 });

      // Extend active line
      activeLine.addLatLng(latlng);

      // Calculate speed from position diff
      let spd = 0;
      if (i > 0 && route[i].time && route[i-1].time) {
        const dt = (route[i].time - route[i-1].time) / 1000; // seconds
        const distKm = GasKo.haversine(route[i-1].lat, route[i-1].lng, pt.lat, pt.lng);
        spd = dt > 0 ? Math.round((distKm / dt) * 3600) : 0;
      }

      // Update UI
      if (progressBar) progressBar.value = Math.round((i / (totalPts - 1)) * 100);
      if (speedDisplay) speedDisplay.textContent = spd + ' km/h';
      if (timeDisplay && route[i].time) {
        const t = new Date(route[i].time);
        timeDisplay.textContent = t.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      }

      this._replay.index++;
    };

    // Interval speed = 500ms / playback multiplier
    const interval = Math.max(50, Math.round(500 / this._replay.speed));
    this._replay.interval = setInterval(step, interval);

    // Speed selector
    document.getElementById('replay-speed')?.addEventListener('change', e => {
      clearInterval(this._replay.interval);
      this._replay.speed = parseInt(e.target.value);
      const newInterval = Math.max(50, Math.round(500 / this._replay.speed));
      this._replay.interval = setInterval(step, newInterval);
    });

    document.getElementById('btn-stop-replay').onclick = () => this.stopReplay();
    this.toast('Replaying trip...', 'info');
  },

  stopReplay() {
    if (this._replay.interval) { clearInterval(this._replay.interval); this._replay.interval = null; }
    if (this._replay.marker && this.detailMap) {
      try { this.detailMap.removeLayer(this._replay.marker); } catch(e) {}
      this._replay.marker = null;
    }
    if (this._replay._ghostLine && this.detailMap) { try { this.detailMap.removeLayer(this._replay._ghostLine); } catch(e) {} }
    if (this._replay._activeLine && this.detailMap) { try { this.detailMap.removeLayer(this._replay._activeLine); } catch(e) {} }
    const panel = document.getElementById('replay-panel');
    if (panel) panel.classList.add('hidden');
  },

  // ---- Calibration ----
  bindCalibration() {
    const fuelInput = document.getElementById('cal-fuel-added');
    const distInput = document.getElementById('cal-distance');
    const odoPrev = document.getElementById('cal-odo-prev');
    const odoNow = document.getElementById('cal-odo-now');
    const odoResult = document.getElementById('cal-odo-result');
    const odoDistance = document.getElementById('cal-odo-distance');
    const preview = document.getElementById('cal-preview');
    const previewVal = document.getElementById('cal-computed-efficiency');
    const previewChange = document.getElementById('cal-change-indicator');

    // Auto-fill previous odometer from last fuel log
    const logs = GasKo.getFuelLogs();
    if (logs.length > 0 && logs[0].odometer) {
      odoPrev.value = logs[0].odometer;
      odoPrev.placeholder = `Last: ${logs[0].odometer}`;
    }

    // Odometer → distance calculation
    const updateOdoDistance = () => {
      const prev = parseFloat(odoPrev.value);
      const now = parseFloat(odoNow.value);
      if (prev > 0 && now > 0 && now > prev) {
        const dist = now - prev;
        odoResult.classList.remove('hidden');
        odoDistance.textContent = dist.toFixed(1) + ' km';
        distInput.value = dist.toFixed(1); // auto-fill distance field
        updatePreview();
      } else {
        odoResult.classList.add('hidden');
      }
    };
    odoPrev?.addEventListener('input', updateOdoDistance);
    odoNow?.addEventListener('input', updateOdoDistance);

    const updatePreview = () => {
      const fuel = parseFloat(fuelInput.value);
      const dist = parseFloat(distInput.value);
      if (fuel > 0 && dist > 0) {
        const eff = dist / fuel;
        const current = GasKo.getSettings().efficiency;
        const diff = ((eff - current) / current * 100).toFixed(1);
        preview.classList.remove('hidden');
        previewVal.textContent = eff.toFixed(1) + ' km/L';
        previewChange.textContent = diff > 0 ? `↑ ${diff}% from current` : `↓ ${Math.abs(diff)}% from current`;
        previewChange.style.color = diff > 0 ? '#4ade80' : '#f43f5e';
      } else { preview.classList.add('hidden'); }
    };
    fuelInput?.addEventListener('input', updatePreview);
    distInput?.addEventListener('input', updatePreview);

    document.getElementById('calibration-form')?.addEventListener('submit', e => {
      e.preventDefault();
      const fuel = parseFloat(fuelInput.value);
      const dist = parseFloat(distInput.value);
      const odoNowVal = parseFloat(odoNow.value) || 0;
      const notes = document.getElementById('cal-notes').value;
      if (!fuel || !dist) { this.toast('Enter fuel and distance (or use odometer)', 'error'); return; }

      const newEff = GasKo.addFuelLog(fuel, dist, odoNowVal, notes);
      this.toast(`Efficiency updated to ${GasKo.getSettings().efficiency.toFixed(1)} km/L`, 'success');
      document.getElementById('current-efficiency-display').textContent = GasKo.getSettings().efficiency.toFixed(1) + ' km/L';
      
      // After submit, set previous odometer for next time
      if (odoNowVal > 0) {
        odoPrev.value = odoNowVal;
      }
      
      e.target.reset();
      // Restore previous odo after reset
      if (odoNowVal > 0) {
        odoPrev.value = odoNowVal;
        odoPrev.placeholder = `Last: ${odoNowVal}`;
      }
      preview.classList.add('hidden');
      odoResult.classList.add('hidden');
      this.renderCalibrationLog();
      this.updateCalChart();
    });
  },

  renderCalibrationLog() {
    const logs = GasKo.getFuelLogs();
    const container = document.getElementById('calibration-log');
    const empty = document.getElementById('cal-empty');
    container.querySelectorAll('.cal-log-entry').forEach(e => e.remove());
    document.getElementById('current-efficiency-display').textContent = GasKo.getSettings().efficiency.toFixed(1) + ' km/L';

    if (!logs.length) { if (empty) empty.style.display = ''; return; }
    if (empty) empty.style.display = 'none';

    logs.forEach(l => {
      const d = document.createElement('div');
      d.className = 'cal-log-entry';
      d.innerHTML = `
        <span class="cal-log-date">${new Date(l.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</span>
        <span class="cal-log-eff">${l.efficiency.toFixed(1)} km/L</span>
        <span class="cal-log-detail">${l.fuelAdded}L / ${l.distance}km</span>`;
      container.appendChild(d);
    });
  },

  // ---- Settings ----
  bindSettings() {
    document.getElementById('settings-form')?.addEventListener('submit', e => {
      e.preventDefault();
      const s = GasKo.getSettings();
      s.vehicleName = document.getElementById('set-vehicle-name').value || s.vehicleName;
      s.fuelType = document.getElementById('set-fuel-type').value;
      s.efficiency = parseFloat(document.getElementById('set-efficiency').value) || s.efficiency;
      s.fuelPrice = parseFloat(document.getElementById('set-fuel-price').value) || s.fuelPrice;
      s.tankCapacity = parseFloat(document.getElementById('set-tank-capacity').value) || s.tankCapacity;
      GasKo.saveSettings(s);
      this.toast('Settings saved!', 'success');
      // Sync to cloud
      if (CloudSync.isLoggedIn() && navigator.onLine) {
        CloudSync.updateVehicle(s).catch(() => {});
      }
    });
  },

  loadSettings() {
    const s = GasKo.getSettings();
    document.getElementById('set-vehicle-name').value = s.vehicleName;
    document.getElementById('set-fuel-type').value = s.fuelType;
    document.getElementById('set-efficiency').value = s.efficiency;
    document.getElementById('set-fuel-price').value = s.fuelPrice;
    document.getElementById('set-tank-capacity').value = s.tankCapacity || '';
    document.getElementById('current-efficiency-display').textContent = s.efficiency.toFixed(1) + ' km/L';
  },

  // ---- Data Management ----
  bindDataMgmt() {
    document.getElementById('btn-export-all')?.addEventListener('click', () => GasKo.exportCSV());
    document.getElementById('btn-clear-trips')?.addEventListener('click', () => {
      if (confirm('Delete all trips?')) { GasKo.saveTrips([]); this.renderTrips(); this.updateChartsData(); this.toast('Trips cleared', 'info'); }
    });
    document.getElementById('btn-reset-all')?.addEventListener('click', () => {
      if (confirm('Reset ALL data? This cannot be undone.')) {
        localStorage.removeItem('gasko_trips');
        localStorage.removeItem('gasko_fuel_logs');
        localStorage.removeItem('gasko_settings');
        location.reload();
      }
    });

    // Import CSV
    const csvInput = document.getElementById('csv-import-input');
    document.getElementById('btn-import-csv')?.addEventListener('click', () => csvInput.click());
    csvInput?.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      if (!file.name.endsWith('.csv')) { this.toast('Please select a .csv file', 'error'); return; }
      const reader = new FileReader();
      reader.onload = ev => {
        const count = GasKo.importCSV(ev.target.result);
        if (count > 0) {
          this.toast(`Imported ${count} new trip${count > 1 ? 's' : ''}!`, 'success');
          this.renderTrips();
          this.updateChartsData();
        } else if (count === 0) {
          this.toast('No new trips found (all already exist)', 'info');
        }
        csvInput.value = ''; // reset so same file can be re-imported
      };
      reader.readAsText(file);
    });
  },
  // ---- Auth ----
  bindAuth() {
    // Tab switching
    const showLogin = () => {
      document.getElementById('tab-login').classList.add('active');
      document.getElementById('tab-signup').classList.remove('active');
      document.getElementById('form-login').style.display = 'flex';
      document.getElementById('form-signup').style.display = 'none';
    };
    const showSignup = () => {
      document.getElementById('tab-signup').classList.add('active');
      document.getElementById('tab-login').classList.remove('active');
      document.getElementById('form-signup').style.display = 'flex';
      document.getElementById('form-login').style.display = 'none';
    };
    document.getElementById('tab-login')?.addEventListener('click', showLogin);
    document.getElementById('tab-signup')?.addEventListener('click', showSignup);

    // Sign In
    let signingIn = false;
    document.getElementById('form-login')?.addEventListener('submit', async e => {
      e.preventDefault();
      if (signingIn) return;
      const email = document.getElementById('login-email').value.trim();
      const pw = document.getElementById('login-password').value;
      if (!email || !pw) { this.toast('Enter email and password', 'error'); return; }
      const btn = document.getElementById('btn-signin-submit');
      const loading = document.getElementById('signin-loading');
      const loadingMsg = document.getElementById('signin-loading-msg');
      signingIn = true;
      if (btn) { btn.disabled = true; btn.textContent = 'Signing in...'; }
      if (loading) loading.classList.remove('hidden');
      // Update message after a short delay to show progress
      const msgTimer = setTimeout(() => {
        if (loadingMsg) loadingMsg.textContent = 'Verifying credentials...';
      }, 2000);
      await CloudSync.signIn(email, pw);
      clearTimeout(msgTimer);
      signingIn = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Sign In'; }
      if (loading) loading.classList.add('hidden');
      if (loadingMsg) loadingMsg.textContent = 'Connecting to server...';
    });

    // Sign Up
    let signingUp = false;
    document.getElementById('form-signup')?.addEventListener('submit', async e => {
      e.preventDefault();
      if (signingUp) return;  // prevent double-submit
      const email = document.getElementById('signup-email').value.trim();
      const pw = document.getElementById('signup-password').value;
      const pw2 = document.getElementById('signup-password2').value;
      if (!email || !pw) { this.toast('Enter email and password', 'error'); return; }
      if (pw !== pw2) { this.toast('Passwords do not match', 'error'); return; }
      if (pw.length < 6) { this.toast('Password must be at least 6 characters', 'error'); return; }
      const btn = e.submitter || e.target.querySelector('button[type=submit]');
      signingUp = true;
      if (btn) { btn.disabled = true; btn.textContent = 'Creating account...'; }
      await CloudSync.signUp(email, pw);
      signingUp = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Create Account'; }
    });

    // Sign out
    document.getElementById('btn-signout')?.addEventListener('click', () => CloudSync.signOut());

    // Upload local data
    document.getElementById('btn-upload-local')?.addEventListener('click', async () => {
      if (!navigator.onLine) { this.toast('You are offline', 'error'); return; }
      await CloudSync.uploadLocalData();
    });

    // Sync from cloud
    document.getElementById('btn-sync-now')?.addEventListener('click', async () => {
      if (!navigator.onLine) { this.toast('You are offline', 'error'); return; }
      await CloudSync.syncFromCloud();
      this.toast('Synced from cloud!', 'success');
    });
  },

  // ---- Friends Page ----
  loadFriendsPage() {
    const loginReq = document.getElementById('friends-login-required');
    const friendsContent = document.getElementById('friends-content');
    if (!CloudSync.isLoggedIn()) {
      if (loginReq) loginReq.style.display = '';
      if (friendsContent) friendsContent.style.display = 'none';
      return;
    }
    if (loginReq) loginReq.style.display = 'none';
    if (friendsContent) friendsContent.style.display = '';

    // Populate my stats
    const trips = GasKo.getTrips();
    const email = CloudSync.user?.email || '';
    const letter = email.charAt(0).toUpperCase() || '?';
    const avatarEl = document.getElementById('my-avatar-letter');
    if (avatarEl) avatarEl.textContent = letter;
    const unameEl = document.getElementById('my-stats-username');
    if (unameEl) unameEl.textContent = email.split('@')[0] || email;

    const totalTrips = trips.length;
    const totalDist = trips.reduce((s, t) => s + (t.distance || 0), 0);
    const totalCost = trips.reduce((s, t) => s + (t.cost || 0), 0);
    const avgEff = trips.length ? (trips.reduce((s, t) => s + (t.efficiencyUsed || 0), 0) / trips.length) : 0;
    const bestMax = trips.length ? Math.max(...trips.map(t => t.maxSpeed || 0)) : 0;
    const avgScore = trips.length ? (trips.reduce((s, t) => s + (t.drivingScore || 0), 0) / trips.length) : 0;

    const el = id => document.getElementById(id);
    if (el('my-total-trips')) el('my-total-trips').textContent = totalTrips;
    if (el('my-total-distance')) el('my-total-distance').textContent = totalDist.toFixed(1);
    if (el('my-avg-efficiency')) el('my-avg-efficiency').textContent = avgEff.toFixed(1);
    if (el('my-max-speed-ever')) el('my-max-speed-ever').textContent = Math.round(bestMax) + ' km/h';
    if (el('my-avg-score')) el('my-avg-score').textContent = avgScore.toFixed(0) + '/100';
    if (el('my-total-cost')) el('my-total-cost').textContent = '\u20b1' + totalCost.toFixed(0);

    // Load friends from cloud
    CloudSync.getFriends().then(({ friends, requests }) => {
      this.renderFriendRequests(requests);
      this.renderFriendsList(friends);
    }).catch(() => {});
  },

  renderFriendRequests(requests) {
    const section = document.getElementById('friend-requests-section');
    const listEl = document.getElementById('friend-requests-list');
    if (!section || !listEl) return;
    if (!requests || !requests.length) { section.style.display = 'none'; return; }
    section.style.display = '';
    listEl.innerHTML = '';
    requests.forEach(req => {
      const card = document.createElement('div');
      card.className = 'friend-card';
      const letter = (req.requester_email || '?').charAt(0).toUpperCase();
      card.innerHTML = `
        <div class="friend-avatar" style="background: linear-gradient(135deg,#f59e0b,#d97706)">${letter}</div>
        <div class="friend-info">
          <div class="friend-name">${req.requester_email || 'Unknown'}</div>
          <div class="friend-meta">Wants to be your friend</div>
        </div>
        <div class="friend-actions">
          <button class="btn-friend-action accept" onclick="App.respondFriend('${req.id}', true)">✓ Accept</button>
          <button class="btn-friend-action remove" onclick="App.respondFriend('${req.id}', false)">✕ Decline</button>
        </div>`;
      listEl.appendChild(card);
    });
  },

  renderFriendsList(friends) {
    const container = document.getElementById('friends-list-container');
    const emptyEl = document.getElementById('friends-empty');
    if (!container) return;
    container.querySelectorAll('.friend-card').forEach(c => c.remove());
    if (!friends || !friends.length) {
      if (emptyEl) emptyEl.style.display = '';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    friends.forEach(f => {
      const card = document.createElement('div');
      card.className = 'friend-card';
      const letter = (f.friend_email || '?').charAt(0).toUpperCase();
      const trips = f.trips || 0;
      const dist = f.total_distance ? f.total_distance.toFixed(1) : '—';
      const score = f.avg_score ? f.avg_score.toFixed(0) : '—';
      card.innerHTML = `
        <div class="friend-avatar">${letter}</div>
        <div class="friend-info">
          <div class="friend-name">${f.friend_email || 'Unknown'}</div>
          <div class="friend-meta">${trips} trips · ${dist} km driven</div>
        </div>
        <div class="friend-stats-mini">
          <div class="fsm-item">
            <div class="fsm-val">${dist} km</div>
            <div class="fsm-label">Distance</div>
          </div>
          <div class="fsm-item">
            <div class="fsm-val">${score}/100</div>
            <div class="fsm-label">Drive Score</div>
          </div>
        </div>
        <div class="friend-actions">
          <button class="btn-friend-action remove" onclick="App.removeFriend('${f.friendship_id}')">Remove</button>
        </div>`;
      container.appendChild(card);
    });
  },

  async addFriend() {
    if (!CloudSync.isLoggedIn()) { this.toast('Sign in first', 'error'); return; }
    const emailInput = document.getElementById('friend-email-input');
    const email = emailInput?.value.trim();
    if (!email) { this.toast('Enter a friend\'s email', 'error'); return; }
    if (email === CloudSync.user?.email) { this.toast('You cannot add yourself!', 'error'); return; }
    const btn = document.getElementById('btn-add-friend');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
    const ok = await CloudSync.sendFriendRequest(email);
    if (btn) { btn.disabled = false; btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg> Add Friend`; }
    if (ok && emailInput) emailInput.value = '';
  },

  async respondFriend(requestId, accept) {
    await CloudSync.respondFriendRequest(requestId, accept);
    this.loadFriendsPage();
  },

  async removeFriend(friendshipId) {
    if (!confirm('Remove this friend?')) return;
    await CloudSync.removeFriend(friendshipId);
    this.loadFriendsPage();
  },

  shareMyStats() {
    const trips = GasKo.getTrips();
    if (!trips.length) { this.toast('No trips to share yet!', 'info'); return; }
    const totalTrips = trips.length;
    const totalDist = trips.reduce((s, t) => s + (t.distance || 0), 0);
    const totalCost = trips.reduce((s, t) => s + (t.cost || 0), 0);
    const avgEff = (trips.reduce((s, t) => s + (t.efficiencyUsed || 0), 0) / trips.length);
    const bestMax = Math.max(...trips.map(t => t.maxSpeed || 0));
    const avgScore = (trips.reduce((s, t) => s + (t.drivingScore || 0), 0) / trips.length);
    const vehicle = GasKo.getSettings().vehicleName;
    const email = CloudSync.user?.email || 'Driver';

    const shareText = `\uD83D\uDE97 GasKo Stats — ${email.split('@')[0]}\n` +
      `Vehicle: ${vehicle}\n` +
      `Trips: ${totalTrips} | Distance: ${totalDist.toFixed(1)} km\n` +
      `Avg Efficiency: ${avgEff.toFixed(1)} km/L\n` +
      `Best Max Speed: ${Math.round(bestMax)} km/h\n` +
      `Avg Drive Score: ${avgScore.toFixed(0)}/100\n` +
      `Total Fuel Cost: \u20b1${totalCost.toFixed(0)}\n` +
      `Tracked with GasKo`;

    // Show share modal
    this._showShareModal(shareText, { totalTrips, totalDist: totalDist.toFixed(1), avgEff: avgEff.toFixed(1), bestMax: Math.round(bestMax), avgScore: avgScore.toFixed(0), totalCost: totalCost.toFixed(0) });
  },

  _showShareModal(text, stats) {
    // Remove existing
    document.getElementById('gasko-share-modal')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'gasko-share-modal';
    overlay.className = 'share-modal-overlay';
    overlay.innerHTML = `
      <div class="share-modal">
        <div class="share-modal-header">
          <h2>\uD83D\uDE97 Share My Stats</h2>
          <button class="modal-close" onclick="document.getElementById('gasko-share-modal').remove()">&times;</button>
        </div>
        <div class="share-stats-grid">
          <div class="share-stat-item"><span class="ssi-val">${stats.totalTrips}</span><span class="ssi-label">Total Trips</span></div>
          <div class="share-stat-item"><span class="ssi-val">${stats.totalDist} km</span><span class="ssi-label">Distance</span></div>
          <div class="share-stat-item"><span class="ssi-val">${stats.avgEff} km/L</span><span class="ssi-label">Avg Efficiency</span></div>
          <div class="share-stat-item"><span class="ssi-val">${stats.bestMax} km/h</span><span class="ssi-label">Best Max Speed</span></div>
          <div class="share-stat-item"><span class="ssi-val">${stats.avgScore}/100</span><span class="ssi-label">Drive Score</span></div>
          <div class="share-stat-item"><span class="ssi-val">\u20b1${stats.totalCost}</span><span class="ssi-label">Total Spent</span></div>
        </div>
        <div class="share-copy-area" id="share-text-area">${text}</div>
        <div class="share-actions">
          <button class="btn btn-outline" onclick="
            const el = document.getElementById('share-text-area');
            navigator.clipboard.writeText(el.textContent).then(() => App.toast('Copied to clipboard!','success'));
          ">\uD83D\uDCCB Copy</button>
          <button class="btn btn-primary" onclick="
            if(navigator.share){navigator.share({title:'GasKo Stats',text:document.getElementById('share-text-area').textContent}).catch(()=>{});}else{App.toast('Sharing not supported on this browser','info');}
          ">\uD83D\uDCE4 Share</button>
        </div>
      </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }
};

// ---- Boot ----
document.addEventListener('DOMContentLoaded', () => App.init());

// ---- Show/Hide Password Toggle ----
function togglePw(inputId, btn) {
  const input = document.getElementById(inputId);
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  btn.querySelector('.eye-icon').style.display     = isHidden ? 'none'  : '';
  btn.querySelector('.eye-off-icon').style.display = isHidden ? ''      : 'none';
  btn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
}

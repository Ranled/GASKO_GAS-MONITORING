// ===== GasKo App: UI Controller =====

const App = {
  map: null, marker: null, routeLine: null, detailMap: null,
  charts: {}, currentPage: 'dashboard',

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

  // ---- Timer ----
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
    }, 1000);
  },
  stopTimer() { clearInterval(GasKo.state.timerInterval); },

  // ---- Update Dashboard ----
  updateDashboard() {
    const st = GasKo.state;
    document.getElementById('stat-speed').textContent = st.currentSpeed;
    document.getElementById('stat-distance').textContent = st.totalDistance.toFixed(2);
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
    if (this.detailMap) this.detailMap.remove();
    this.detailMap = L.map(mapDiv, { zoomControl: false }).setView([14.5995, 120.9842], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 19 }).addTo(this.detailMap);
    if (trip.route && trip.route.length > 0) {
      const latlngs = trip.route.map(p => [p.lat, p.lng]);
      L.polyline(latlngs, { color: '#a855f7', weight: 3 }).addTo(this.detailMap);
      this.detailMap.fitBounds(latlngs);
      L.circleMarker(latlngs[0], { radius: 6, color: '#4ade80', fillOpacity: 1 }).addTo(this.detailMap);
      L.circleMarker(latlngs[latlngs.length-1], { radius: 6, color: '#f43f5e', fillOpacity: 1 }).addTo(this.detailMap);
    }
    setTimeout(() => this.detailMap.invalidateSize(), 200);

    // Close & delete handlers
    const closeModal = () => modal.classList.add('hidden');
    document.getElementById('btn-close-modal').onclick = closeModal;
    modal.querySelector('.modal-overlay').onclick = closeModal;
    document.getElementById('btn-delete-trip').onclick = () => {
      const trips = GasKo.getTrips().filter(t => t.id !== trip.id);
      GasKo.saveTrips(trips);
      closeModal();
      this.renderTrips();
      this.updateChartsData();
      this.toast('Trip deleted', 'info');
    };
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

    // Sign In — use button click, not form submit (avoids hidden required field issue)
    document.getElementById('form-login')?.addEventListener('submit', async e => {
      e.preventDefault();
      const email = document.getElementById('login-email').value.trim();
      const pw = document.getElementById('login-password').value;
      if (!email || !pw) { this.toast('Enter email and password', 'error'); return; }
      const btn = e.submitter || e.target.querySelector('button[type=submit]');
      if (btn) btn.textContent = 'Signing in...';
      await CloudSync.signIn(email, pw);
      if (btn) btn.textContent = 'Sign In';
    });

    // Sign Up — use button click with manual validation
    document.getElementById('form-signup')?.addEventListener('submit', async e => {
      e.preventDefault();
      const email = document.getElementById('signup-email').value.trim();
      const pw = document.getElementById('signup-password').value;
      const pw2 = document.getElementById('signup-password2').value;
      if (!email || !pw) { this.toast('Enter email and password', 'error'); return; }
      if (pw !== pw2) { this.toast('Passwords do not match', 'error'); return; }
      if (pw.length < 6) { this.toast('Password must be at least 6 characters', 'error'); return; }
      const btn = e.submitter || e.target.querySelector('button[type=submit]');
      if (btn) btn.textContent = 'Creating...';
      await CloudSync.signUp(email, pw);
      if (btn) btn.textContent = 'Create Account';
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
  }
};

// ---- Boot ----
document.addEventListener('DOMContentLoaded', () => App.init());

// ===== GasKo Engine: GPS, Fuel Calc, Behavior =====

const GasKo = {
  // ---- State ----
  state: {
    tracking: false,
    simulating: false,
    watchId: null,
    simInterval: null,
    positions: [],
    totalDistance: 0,
    currentSpeed: 0,
    maxSpeed: 0,
    tripStart: null,
    timerInterval: null,
    stopCount: 0,
    highSpeedCount: 0,
    lastSpeed: 0,
  },

  // ---- Settings (from localStorage) ----
  getSettings() {
    return JSON.parse(localStorage.getItem('gasko_settings') || JSON.stringify({
      vehicleName: 'My Vehicle',
      fuelType: 'gasoline',
      efficiency: 12,
      fuelPrice: 65.50,
      tankCapacity: 42
    }));
  },
  saveSettings(s) { localStorage.setItem('gasko_settings', JSON.stringify(s)); },

  // ---- Trips (localStorage) ----
  getTrips() { return JSON.parse(localStorage.getItem('gasko_trips') || '[]'); },
  saveTrips(t) { localStorage.setItem('gasko_trips', JSON.stringify(t)); },

  // ---- Fuel Logs (localStorage) ----
  getFuelLogs() { return JSON.parse(localStorage.getItem('gasko_fuel_logs') || '[]'); },
  saveFuelLogs(l) { localStorage.setItem('gasko_fuel_logs', JSON.stringify(l)); },

  // ---- Haversine Distance (km) ----
  haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  },

  // ---- Fuel & Cost ----
  calcFuel(distKm) {
    const eff = this.getAdjustedEfficiency();
    return distKm / eff;
  },
  calcCost(fuelL) { return fuelL * this.getSettings().fuelPrice; },

  // ---- Driving Behavior ----
  getAdjustedEfficiency() {
    const s = this.getSettings();
    let eff = s.efficiency;
    const st = this.state;
    if (st.positions.length < 3) return eff;

    let modifier = 0;
    const highRatio = st.highSpeedCount / Math.max(st.positions.length, 1);
    if (highRatio > 0.3) modifier -= eff * 0.12;
    else if (highRatio > 0.1) modifier -= eff * 0.06;

    const stopRatio = st.stopCount / Math.max(st.positions.length, 1);
    if (stopRatio > 0.25) modifier -= eff * 0.10;
    else if (stopRatio > 0.1) modifier -= eff * 0.05;

    if (highRatio < 0.05 && stopRatio < 0.08) modifier += eff * 0.05;

    return Math.max(eff + modifier, 1);
  },

  getBehaviorInsight() {
    const s = this.getSettings();
    const st = this.state;
    if (st.positions.length < 5) return null;
    const adjusted = this.getAdjustedEfficiency();
    const diff = ((adjusted - s.efficiency) / s.efficiency * 100).toFixed(1);
    const highRatio = st.highSpeedCount / Math.max(st.positions.length, 1);
    const stopRatio = st.stopCount / Math.max(st.positions.length, 1);

    if (diff > 0) return { text: `Smooth driving improved efficiency by ${diff}%! 🎉`, type: 'good' };
    if (highRatio > 0.2) return { text: `High-speed driving reduced efficiency by ${Math.abs(diff)}%. Slow down to save fuel.`, type: 'warn' };
    if (stopRatio > 0.15) return { text: `Frequent stops reduced efficiency by ${Math.abs(diff)}%. Try steadier driving.`, type: 'warn' };
    return { text: `Your driving style changed efficiency by ${diff}%.`, type: 'info' };
  },

  // ---- GPS Position Handler ----
  onPosition(lat, lng, speed) {
    const st = this.state;
    const speedKmh = (speed != null && speed >= 0) ? speed * 3.6 : 0;
    st.currentSpeed = Math.round(speedKmh);
    if (speedKmh > st.maxSpeed) st.maxSpeed = speedKmh;
    if (speedKmh > 100) st.highSpeedCount++;
    if (speedKmh < 2 && st.lastSpeed >= 2) st.stopCount++;
    st.lastSpeed = speedKmh;

    if (st.positions.length > 0) {
      const last = st.positions[st.positions.length - 1];
      const d = this.haversine(last.lat, last.lng, lat, lng);
      if (d > 0.001) {
        st.totalDistance += d;
        st.positions.push({ lat, lng, time: Date.now() });
      }
    } else {
      st.positions.push({ lat, lng, time: Date.now() });
    }
  },

  // ---- Start Tracking ----
  startTracking() {
    if (this.state.tracking) return;
    this.state = { ...this.state, tracking: true, positions: [], totalDistance: 0, currentSpeed: 0, maxSpeed: 0, tripStart: Date.now(), stopCount: 0, highSpeedCount: 0, lastSpeed: 0 };

    if (!navigator.geolocation) { App.toast('Geolocation not supported', 'error'); return; }
    this.state.watchId = navigator.geolocation.watchPosition(
      pos => this.onPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.speed),
      err => App.toast('GPS Error: ' + err.message, 'error'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  },

  stopTracking() {
    if (this.state.watchId != null) navigator.geolocation.clearWatch(this.state.watchId);
    this.state.watchId = null;
    this.state.tracking = false;
  },

  // ---- Simulation Mode ----
  startSimulation() {
    if (this.state.simulating) return;
    this.state = { ...this.state, simulating: true, tracking: true, positions: [], totalDistance: 0, currentSpeed: 0, maxSpeed: 0, tripStart: Date.now(), stopCount: 0, highSpeedCount: 0, lastSpeed: 0 };
    let lat = 14.5995, lng = 120.9842;
    const self = this;
    this.state.simInterval = setInterval(() => {
      const angle = Math.random() * 2 * Math.PI;
      const dist = 0.0003 + Math.random() * 0.0008;
      lat += Math.cos(angle) * dist;
      lng += Math.sin(angle) * dist;
      const speed = (15 + Math.random() * 45) / 3.6;
      self.onPosition(lat, lng, speed);
      App.updateDashboard();
    }, 1500);
  },

  stopSimulation() {
    clearInterval(this.state.simInterval);
    this.state.simulating = false;
    this.state.tracking = false;
  },

  // ---- End Trip & Save ----
  endTrip() {
    const st = this.state;
    if (st.simulating) this.stopSimulation();
    else this.stopTracking();

    const fuel = this.calcFuel(st.totalDistance);
    const cost = this.calcCost(fuel);
    const duration = Date.now() - st.tripStart;
    const insight = this.getBehaviorInsight();

    const trip = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      startTime: st.tripStart,
      endTime: Date.now(),
      distance: st.totalDistance,
      fuelUsed: fuel,
      cost: cost,
      fuelPrice: this.getSettings().fuelPrice,
      avgSpeed: st.positions.length > 1 ? (st.totalDistance / (duration / 3600000)) : 0,
      maxSpeed: st.maxSpeed,
      efficiencyUsed: this.getAdjustedEfficiency(),
      drivingScore: Math.max(0, Math.min(100, 80 + (this.getAdjustedEfficiency() - this.getSettings().efficiency) / this.getSettings().efficiency * 100)),
      route: st.positions.slice(0, 500),
      behaviorInsight: insight ? insight.text : '',
      duration: duration
    };

    const trips = this.getTrips();
    trips.unshift(trip);
    this.saveTrips(trips);
    return trip;
  },

  // ---- Calibration ----
  addFuelLog(fuelAdded, distKm, odometer, notes) {
    const newEff = distKm / fuelAdded;
    const logs = this.getFuelLogs();
    logs.unshift({ id: Date.now(), fuelAdded, distance: distKm, efficiency: newEff, odometer: odometer || null, notes: notes || '', date: Date.now() });
    this.saveFuelLogs(logs);

    const s = this.getSettings();
    s.efficiency = Math.round(((s.efficiency * 0.3) + (newEff * 0.7)) * 100) / 100;
    this.saveSettings(s);
    return newEff;
  },

  // ---- CSV Export ----
  // Format: raw ms timestamps + base64-encoded GPS route for 100% accurate re-import
  exportCSV() {
    const trips = this.getTrips();
    if (!trips.length) { App.toast('No data to export', 'info'); return; }
    let csv = 'Trip ID,Date,StartTime_ms,EndTime_ms,Duration_ms,Distance (km),Fuel Used (L),Cost (PHP),Fuel Price,Avg Speed (km/h),Max Speed (km/h),Efficiency Used (km/L),Driving Score,Route_b64\n';
    trips.forEach(t => {
      const date = new Date(t.startTime).toISOString();
      const routeB64 = (t.route && t.route.length > 0)
        ? btoa(unescape(encodeURIComponent(JSON.stringify(t.route))))
        : '';
      csv += `${t.id},${date},${t.startTime},${t.endTime || ''},${t.duration || ''},${t.distance.toFixed(4)},${t.fuelUsed.toFixed(4)},${t.cost.toFixed(4)},${t.fuelPrice || 0},${(t.avgSpeed||0).toFixed(2)},${(t.maxSpeed||0).toFixed(2)},${(t.efficiencyUsed||0).toFixed(2)},${(t.drivingScore||0).toFixed(1)},${routeB64}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `gasko_trips_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    App.toast('CSV exported!', 'success');
  },

  // ---- CSV Import ----
  // Supports: new format (StartTime_ms, Route_b64) AND all legacy formats
  importCSV(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) { App.toast('CSV file is empty or invalid', 'error'); return 0; }

    const rawHeader = lines[0];
    const header = rawHeader.toLowerCase();
    if (!header.includes('trip id') || !header.includes('distance')) {
      App.toast('Invalid CSV: use a GasKo-exported file.', 'error');
      return 0;
    }

    // Dynamic column mapping — works for all GasKo CSV versions
    const headerCols = rawHeader.split(',').map(c => c.trim().toLowerCase());
    const col = name => headerCols.findIndex(c => c.includes(name));

    const idxId        = col('trip id');
    const idxDate      = col('date');
    const idxStart     = col('starttime_ms');
    const idxEnd       = col('endtime_ms');
    const idxDurMs     = col('duration_ms');
    const idxTimestamp = col('timestamp');       // legacy v2
    const idxDurMin    = col('duration (min)');  // legacy v1
    const idxDist      = col('distance');
    const idxFuel      = col('fuel used');
    const idxCost      = col('cost');
    const idxFuelPx    = col('fuel price');
    const idxAvgSpd    = col('avg speed');
    const idxMaxSpd    = col('max speed');
    const idxEff       = col('efficiency');
    const idxScore     = col('driving score');
    const idxRoute     = col('route_b64');

    const existing = this.getTrips();
    const existingIds = new Set(existing.map(t => t.id));
    let imported = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Proper quoted CSV parser — handles commas inside quoted fields
      const p = [];
      let inQ = false, cur = '';
      for (const ch of line + ',') {
        if (ch === '"') { inQ = !inQ; }
        else if (ch === ',' && !inQ) { p.push(cur); cur = ''; }
        else { cur += ch; }
      }
      if (p.length < 5) continue;

      const id = (p[idxId] || '').trim();
      if (!id || existingIds.has(id)) continue;

      // Timestamps — prefer raw ms, fall back to ISO string, then locale string
      let startTime = 0;
      if (idxStart >= 0 && p[idxStart]) startTime = parseInt(p[idxStart], 10);
      if (!startTime && idxTimestamp >= 0 && p[idxTimestamp]) startTime = parseInt(p[idxTimestamp], 10);
      if (!startTime && idxDate >= 0 && p[idxDate]) startTime = new Date(p[idxDate].trim()).getTime() || 0;
      if (!startTime || isNaN(startTime)) startTime = Date.now();

      let endTime = 0;
      if (idxEnd >= 0 && p[idxEnd]) endTime = parseInt(p[idxEnd], 10) || 0;

      let durationMs = 0;
      if (idxDurMs >= 0 && p[idxDurMs]) durationMs = parseInt(p[idxDurMs], 10) || 0;
      else if (idxDurMin >= 0 && p[idxDurMin]) durationMs = Math.round(parseFloat(p[idxDurMin]) * 60000) || 0;
      if (!endTime && durationMs) endTime = startTime + durationMs;
      if (!durationMs && endTime > startTime) durationMs = endTime - startTime;

      // Route — decode base64 JSON for GPS replay
      let route = [];
      if (idxRoute >= 0 && p[idxRoute] && p[idxRoute].trim()) {
        try { route = JSON.parse(decodeURIComponent(escape(atob(p[idxRoute].trim())))); }
        catch(e) { route = []; }
      }

      existing.push({
        id, startTime, endTime, duration: durationMs,
        distance:       idxDist   >= 0 ? (parseFloat(p[idxDist])   || 0) : 0,
        fuelUsed:       idxFuel   >= 0 ? (parseFloat(p[idxFuel])   || 0) : 0,
        cost:           idxCost   >= 0 ? (parseFloat(p[idxCost])   || 0) : 0,
        fuelPrice:      idxFuelPx >= 0 ? (parseFloat(p[idxFuelPx]) || this.getSettings().fuelPrice) : this.getSettings().fuelPrice,
        avgSpeed:       idxAvgSpd >= 0 ? (parseFloat(p[idxAvgSpd]) || 0) : 0,
        maxSpeed:       idxMaxSpd >= 0 ? (parseFloat(p[idxMaxSpd]) || 0) : 0,
        efficiencyUsed: idxEff    >= 0 ? (parseFloat(p[idxEff])    || 0) : 0,
        drivingScore:   idxScore  >= 0 ? (parseFloat(p[idxScore])  || 0) : 0,
        route,
        behaviorInsight: route.length > 0 ? 'Imported from CSV (with GPS)' : 'Imported from CSV'
      });
      existingIds.add(id);
      imported++;
    }

    existing.sort((a, b) => b.startTime - a.startTime);
    this.saveTrips(existing);
    return imported;
  }
};

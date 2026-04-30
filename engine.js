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
    // High speed penalty
    const highRatio = st.highSpeedCount / Math.max(st.positions.length, 1);
    if (highRatio > 0.3) modifier -= eff * 0.12;
    else if (highRatio > 0.1) modifier -= eff * 0.06;

    // Stop frequency penalty
    const stopRatio = st.stopCount / Math.max(st.positions.length, 1);
    if (stopRatio > 0.25) modifier -= eff * 0.10;
    else if (stopRatio > 0.1) modifier -= eff * 0.05;

    // Smooth driving bonus
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
      if (d > 0.001) { // filter GPS jitter < 1m
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
    // Start near Manila
    let lat = 14.5995, lng = 120.9842;
    const self = this;
    this.state.simInterval = setInterval(() => {
      const angle = Math.random() * 2 * Math.PI;
      const dist = 0.0003 + Math.random() * 0.0008;
      lat += Math.cos(angle) * dist;
      lng += Math.sin(angle) * dist;
      const speed = (15 + Math.random() * 45) / 3.6; // 15-60 km/h in m/s
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
      route: st.positions.slice(0, 500), // cap stored points
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

    // Update vehicle efficiency (weighted average with history)
    const s = this.getSettings();
    s.efficiency = Math.round(((s.efficiency * 0.3) + (newEff * 0.7)) * 100) / 100;
    this.saveSettings(s);
    return newEff;
  },

  // ---- CSV Export ----
  exportCSV() {
    const trips = this.getTrips();
    if (!trips.length) { App.toast('No data to export', 'info'); return; }
    let csv = 'Trip ID,Date,Distance (km),Fuel Used (L),Cost (PHP),Avg Speed (km/h),Max Speed (km/h),Efficiency Used (km/L),Driving Score,Duration (min)\n';
    trips.forEach(t => {
      csv += `${t.id},${new Date(t.startTime).toLocaleString()},${t.distance.toFixed(2)},${t.fuelUsed.toFixed(2)},${t.cost.toFixed(2)},${(t.avgSpeed||0).toFixed(1)},${(t.maxSpeed||0).toFixed(1)},${(t.efficiencyUsed||0).toFixed(1)},${(t.drivingScore||0).toFixed(0)},${((t.duration||0)/60000).toFixed(1)}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `gasko_trips_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    App.toast('CSV exported!', 'success');
  },

  // ---- CSV Import ----
  importCSV(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) { App.toast('CSV file is empty or invalid', 'error'); return 0; }

    const header = lines[0].toLowerCase();
    const isGaskoFormat = header.includes('trip id') && header.includes('distance');
    if (!isGaskoFormat) {
      App.toast('Invalid CSV format. Use a GasKo-exported file.', 'error');
      return 0;
    }

    const existing = this.getTrips();
    const existingIds = new Set(existing.map(t => t.id));
    let imported = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      // Split by comma, handle quoted values
      const cols = line.match(/(\'[^\']*\'|"[^"]*"|[^,]+)/g) || line.split(',');
      if (cols.length < 10) continue;

      const id = cols[0].trim().replace(/[\'"]/g, '');
      if (existingIds.has(id)) continue; // skip duplicates

      const dateStr = cols[1].trim().replace(/[\'"]/g, '');
      const startTime = new Date(dateStr).getTime() || Date.now();

      const trip = {
        id,
        startTime,
        endTime: startTime + (parseFloat(cols[9]) || 0) * 60000,
        distance: parseFloat(cols[2]) || 0,
        fuelUsed: parseFloat(cols[3]) || 0,
        cost: parseFloat(cols[4]) || 0,
        fuelPrice: this.getSettings().fuelPrice,
        avgSpeed: parseFloat(cols[5]) || 0,
        maxSpeed: parseFloat(cols[6]) || 0,
        efficiencyUsed: parseFloat(cols[7]) || 0,
        drivingScore: parseFloat(cols[8]) || 0,
        duration: (parseFloat(cols[9]) || 0) * 60000,
        route: [],
        behaviorInsight: 'Imported from CSV'
      };
      existing.push(trip);
      existingIds.add(id);
      imported++;
    }

    // Sort newest first
    existing.sort((a, b) => b.startTime - a.startTime);
    this.saveTrips(existing);
    return imported;
  }
};

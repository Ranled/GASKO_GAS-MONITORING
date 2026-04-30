// ===== GasKo Supabase Integration =====
// Handles auth, cloud sync, and data persistence

const SUPABASE_URL = 'https://lkyzrbwnzmrceyprmrxp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxreXpyYnduem1yY2V5cHJtcnhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MzYwOTcsImV4cCI6MjA5MzExMjA5N30.KXkPN9ZvCuinr9_micQyf8hFjDdFK0pp-NXxWq_Ip4g';

let supabase = null;

const CloudSync = {
  user: null,
  vehicleId: null,
  initialized: false,

  // ---- Initialize Supabase ----
  init() {
    if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
      console.warn('Supabase SDK not loaded, running in offline mode');
      this.initialized = false;
      return;
    }
    if (SUPABASE_ANON_KEY === 'YOUR_ANON_KEY_HERE') {
      console.warn('Supabase anon key not set, running in offline mode');
      this.initialized = false;
      return;
    }
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    this.initialized = true;
    this.checkSession();
    this.listenAuthChanges();
  },

  // ---- Auth State ----
  async checkSession() {
    if (!this.initialized) return null;
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      this.user = session.user;
      await this.ensureVehicle();
      this.updateAuthUI();
      this.syncFromCloud();
    }
    return session;
  },

  listenAuthChanges() {
    if (!this.initialized) return;
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        this.user = session.user;
        await this.ensureVehicle();
        this.updateAuthUI();
        this.syncFromCloud();
        App.toast('Signed in! Data syncing...', 'success');
      } else if (event === 'SIGNED_OUT') {
        this.user = null;
        this.vehicleId = null;
        this.updateAuthUI();
        App.toast('Signed out', 'info');
      }
    });
  },

  // ---- Sign Up ----
  async signUp(email, password) {
    if (!this.initialized) { App.toast('Cloud sync not available', 'error'); return; }
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) { App.toast(error.message, 'error'); return null; }
    App.toast('Check your email to confirm your account!', 'success');
    return data;
  },

  // ---- Sign In ----
  async signIn(email, password) {
    if (!this.initialized) { App.toast('Cloud sync not available', 'error'); return; }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { App.toast(error.message, 'error'); return null; }
    return data;
  },

  // ---- Sign Out ----
  async signOut() {
    if (!this.initialized) return;
    await supabase.auth.signOut();
  },

  // ---- Ensure Vehicle Exists ----
  async ensureVehicle() {
    if (!this.initialized || !this.user) return;
    const { data: vehicles } = await supabase
      .from('vehicles')
      .select('id, name, fuel_efficiency, fuel_price, fuel_type, tank_capacity, last_odometer')
      .eq('user_id', this.user.id)
      .limit(1);

    if (vehicles && vehicles.length > 0) {
      this.vehicleId = vehicles[0].id;
      // Sync vehicle settings to local
      const s = GasKo.getSettings();
      s.vehicleName = vehicles[0].name;
      s.efficiency = vehicles[0].fuel_efficiency;
      s.fuelPrice = vehicles[0].fuel_price;
      s.fuelType = vehicles[0].fuel_type;
      s.tankCapacity = vehicles[0].tank_capacity || 42;
      GasKo.saveSettings(s);
    } else {
      // Create default vehicle
      const s = GasKo.getSettings();
      const { data } = await supabase.from('vehicles').insert({
        user_id: this.user.id,
        name: s.vehicleName,
        fuel_efficiency: s.efficiency,
        fuel_price: s.fuelPrice,
        fuel_type: s.fuelType,
        tank_capacity: s.tankCapacity || 42,
        last_odometer: 0
      }).select().single();
      if (data) this.vehicleId = data.id;
    }
  },

  // ---- Save Trip to Cloud ----
  async saveTrip(trip) {
    if (!this.initialized || !this.user) return;
    await supabase.from('trips').insert({
      user_id: this.user.id,
      vehicle_id: this.vehicleId,
      start_time: new Date(trip.startTime).toISOString(),
      end_time: new Date(trip.endTime).toISOString(),
      distance_km: trip.distance,
      fuel_used_liters: trip.fuelUsed,
      cost: trip.cost,
      fuel_price: trip.fuelPrice,
      avg_speed_kmh: trip.avgSpeed || 0,
      max_speed_kmh: trip.maxSpeed || 0,
      efficiency_used: trip.efficiencyUsed || 0,
      driving_score: trip.drivingScore || 0,
      route_data: trip.route || [],
      behavior_insight: trip.behaviorInsight || '',
      duration_ms: trip.duration || 0
    });
  },

  // ---- Save Fuel Log to Cloud ----
  async saveFuelLog(log) {
    if (!this.initialized || !this.user) return;
    await supabase.from('fuel_logs').insert({
      user_id: this.user.id,
      vehicle_id: this.vehicleId,
      fuel_added_liters: log.fuelAdded,
      distance_km: log.distance,
      computed_efficiency: log.efficiency,
      odometer_reading: log.odometer || 0,
      notes: log.notes || ''
    });
  },

  // ---- Update Vehicle Settings in Cloud ----
  async updateVehicle(settings) {
    if (!this.initialized || !this.user || !this.vehicleId) return;
    await supabase.from('vehicles').update({
      name: settings.vehicleName,
      fuel_efficiency: settings.efficiency,
      fuel_price: settings.fuelPrice,
      fuel_type: settings.fuelType,
      tank_capacity: settings.tankCapacity || 42,
      updated_at: new Date().toISOString()
    }).eq('id', this.vehicleId);
  },

  // ---- Delete Trip from Cloud ----
  async deleteTrip(tripId) {
    if (!this.initialized || !this.user) return;
    // Find by start_time since local IDs differ from cloud UUIDs
    // We use the local trip's startTime to match
  },

  // ---- Sync from Cloud ----
  async syncFromCloud() {
    if (!this.initialized || !this.user) return;

    // Fetch trips
    const { data: cloudTrips } = await supabase
      .from('trips')
      .select('*')
      .eq('user_id', this.user.id)
      .order('start_time', { ascending: false });

    if (cloudTrips && cloudTrips.length > 0) {
      const localTrips = cloudTrips.map(t => ({
        id: t.id,
        startTime: new Date(t.start_time).getTime(),
        endTime: new Date(t.end_time).getTime(),
        distance: t.distance_km,
        fuelUsed: t.fuel_used_liters,
        cost: t.cost,
        fuelPrice: t.fuel_price,
        avgSpeed: t.avg_speed_kmh,
        maxSpeed: t.max_speed_kmh,
        efficiencyUsed: t.efficiency_used,
        drivingScore: t.driving_score,
        route: t.route_data || [],
        behaviorInsight: t.behavior_insight || '',
        duration: t.duration_ms
      }));
      GasKo.saveTrips(localTrips);
    }

    // Fetch fuel logs
    const { data: cloudLogs } = await supabase
      .from('fuel_logs')
      .select('*')
      .eq('user_id', this.user.id)
      .order('created_at', { ascending: false });

    if (cloudLogs && cloudLogs.length > 0) {
      const localLogs = cloudLogs.map(l => ({
        id: l.id,
        fuelAdded: l.fuel_added_liters,
        distance: l.distance_km,
        efficiency: l.computed_efficiency,
        odometer: l.odometer_reading,
        notes: l.notes || '',
        date: new Date(l.created_at).getTime()
      }));
      GasKo.saveFuelLogs(localLogs);
    }

    // Refresh UI
    App.loadSettings();
    App.renderTrips();
    App.renderCalibrationLog();
    App.updateChartsData();
  },

  // ---- Upload Local Data to Cloud ----
  async uploadLocalData() {
    if (!this.initialized || !this.user) return;
    const trips = GasKo.getTrips();
    const logs = GasKo.getFuelLogs();

    for (const trip of trips) {
      await this.saveTrip(trip);
    }
    for (const log of logs) {
      await this.saveFuelLog(log);
    }
    App.toast(`Uploaded ${trips.length} trips and ${logs.length} logs to cloud`, 'success');
  },

  // ---- Update Auth UI ----
  updateAuthUI() {
    const authPage = document.getElementById('page-auth');
    const authStatus = document.getElementById('auth-status');
    const loginForm = document.getElementById('auth-login-form');
    const loggedInView = document.getElementById('auth-logged-in');
    const userEmail = document.getElementById('auth-user-email');
    const navAuth = document.getElementById('nav-auth');
    const syncBadge = document.getElementById('sync-badge');

    if (this.user) {
      if (loginForm) loginForm.style.display = 'none';
      if (loggedInView) loggedInView.style.display = 'block';
      if (userEmail) userEmail.textContent = this.user.email;
      if (navAuth) navAuth.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg><span>${this.user.email.split('@')[0]}</span>`;
      if (syncBadge) syncBadge.classList.remove('hidden');
    } else {
      if (loginForm) loginForm.style.display = 'block';
      if (loggedInView) loggedInView.style.display = 'none';
      if (navAuth) navAuth.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg><span>Sign In</span>`;
      if (syncBadge) syncBadge.classList.add('hidden');
    }
  },

  isLoggedIn() { return !!this.user; }
};

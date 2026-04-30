// ===== GasKo Supabase Integration =====
// Handles auth, cloud sync, and data persistence
// NOTE: We use `sbClient` internally to avoid name conflict with the Supabase CDN
// which declares `window.supabase` globally.

const SUPABASE_URL = 'https://lkyzrbwnzmrceyprmrxp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxreXpyYnduem1yY2V5cHJtcnhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MzYwOTcsImV4cCI6MjA5MzExMjA5N30.KXkPN9ZvCuinr9_micQyf8hFjDdFK0pp-NXxWq_Ip4g';

let sbClient = null; // renamed from `supabase` to avoid CDN naming conflict

const CloudSync = {
  user: null,
  vehicleId: null,
  initialized: false,

  // ---- Initialize Supabase ----
  init() {
    const sbLib = window.supabase;
    if (!sbLib || typeof sbLib.createClient !== 'function') {
      console.error('GasKo: Supabase SDK not loaded. Check CDN script tag.');
      this.initialized = false;
      return;
    }
    try {
      sbClient = sbLib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          storageKey: 'gasko-auth-token',
          storage: window.localStorage,
          flowType: 'implicit',
          autoRefreshToken: true,
          detectSessionInUrl: false,
          // Disable Web Locks — eliminates the 5-second lock delay in vanilla JS
          lock: (_name, _timeout, fn) => fn()
        }
      });
      this.initialized = true;
      console.log('GasKo: Supabase initialized successfully.');
      this.checkSession();
      this.listenAuthChanges();
    } catch (e) {
      console.error('GasKo: Supabase init error:', e);
      this.initialized = false;
    }
  },

  // ---- Auth State ----
  async checkSession() {
    if (!this.initialized) return null;
    const { data: { session } } = await sbClient.auth.getSession();
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
    sbClient.auth.onAuthStateChange(async (event, session) => {
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
    console.log('GasKo: signUp called', email);
    if (!this.initialized) {
      App.toast('Cloud sync unavailable — check connection', 'error');
      console.error('GasKo: signUp failed — not initialized');
      return;
    }
    try {
      const { data, error } = await sbClient.auth.signUp({ email, password });
      console.log('GasKo: signUp result', { data, error });
      if (error) { App.toast(error.message, 'error'); return null; }
      App.toast('Account created! Check your email to confirm.', 'success');
      return data;
    } catch (e) {
      console.error('GasKo: signUp exception:', e);
      App.toast('Sign up failed: ' + e.message, 'error');
    }
  },

  // ---- Sign In ----
  async signIn(email, password) {
    console.log('GasKo: signIn called', email);
    if (!this.initialized) {
      App.toast('Cloud sync unavailable — check connection', 'error');
      console.error('GasKo: signIn failed — not initialized');
      return;
    }
    try {
      const { data, error } = await sbClient.auth.signInWithPassword({ email, password });
      console.log('GasKo: signIn result', { data, error });
      if (error) { App.toast(error.message, 'error'); return null; }
      return data;
    } catch (e) {
      console.error('GasKo: signIn exception:', e);
      App.toast('Sign in failed: ' + e.message, 'error');
    }
  },

  // ---- Sign Out ----
  async signOut() {
    if (!this.initialized) return;
    await sbClient.auth.signOut();
  },

  // ---- Ensure Vehicle Exists ----
  async ensureVehicle() {
    if (!this.initialized || !this.user) return;
    try {
      const { data: vehicles, error } = await sbClient
        .from('vehicles')
        .select('id, name, fuel_efficiency, fuel_price, fuel_type, tank_capacity, last_odometer')
        .eq('user_id', this.user.id)
        .limit(1);

      if (error) { console.error('GasKo: ensureVehicle fetch error:', error.message); return; }

      if (vehicles && vehicles.length > 0) {
        this.vehicleId = vehicles[0].id;
        const s = GasKo.getSettings();
        s.vehicleName = vehicles[0].name;
        s.efficiency = vehicles[0].fuel_efficiency;
        s.fuelPrice = vehicles[0].fuel_price;
        s.fuelType = vehicles[0].fuel_type;
        s.tankCapacity = vehicles[0].tank_capacity || 42;
        GasKo.saveSettings(s);
        console.log('GasKo: Vehicle loaded from cloud, id:', this.vehicleId);
      } else {
        const s = GasKo.getSettings();
        const { data, error: insertErr } = await sbClient.from('vehicles').insert({
          user_id: this.user.id,
          name: s.vehicleName,
          fuel_efficiency: s.efficiency,
          fuel_price: s.fuelPrice,
          fuel_type: s.fuelType,
          tank_capacity: s.tankCapacity || 42,
          last_odometer: 0
        }).select().single();
        if (insertErr) { console.error('GasKo: ensureVehicle insert error:', insertErr.message); return; }
        if (data) { this.vehicleId = data.id; console.log('GasKo: New vehicle created, id:', this.vehicleId); }
      }
    } catch (e) { console.error('GasKo: ensureVehicle exception:', e); }
  },

  // ---- Save Trip to Cloud ----
  async saveTrip(trip) {
    if (!this.initialized || !this.user) return;
    try {
      const { error } = await sbClient.from('trips').insert({
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
      if (error) {
        console.error('GasKo: saveTrip error:', error.message, error.code);
        App.toast('Cloud save failed: ' + error.message, 'error');
      } else {
        console.log('GasKo: Trip saved to cloud ✓');
      }
    } catch (e) {
      console.error('GasKo: saveTrip exception:', e);
      App.toast('Cloud save failed: ' + e.message, 'error');
    }
  },

  // ---- Save Fuel Log to Cloud ----
  async saveFuelLog(log) {
    if (!this.initialized || !this.user) return;
    try {
      const { error } = await sbClient.from('fuel_logs').insert({
        user_id: this.user.id,
        vehicle_id: this.vehicleId,
        fuel_added_liters: log.fuelAdded,
        distance_km: log.distance,
        computed_efficiency: log.efficiency,
        odometer_reading: log.odometer || 0,
        notes: log.notes || ''
      });
      if (error) { console.error('GasKo: saveFuelLog error:', error.message); }
      else { console.log('GasKo: Fuel log saved to cloud ✓'); }
    } catch (e) { console.error('GasKo: saveFuelLog exception:', e); }
  },

  // ---- Update Vehicle Settings in Cloud ----
  async updateVehicle(settings) {
    if (!this.initialized || !this.user || !this.vehicleId) return;
    await sbClient.from('vehicles').update({
      name: settings.vehicleName,
      fuel_efficiency: settings.efficiency,
      fuel_price: settings.fuelPrice,
      fuel_type: settings.fuelType,
      tank_capacity: settings.tankCapacity || 42,
      updated_at: new Date().toISOString()
    }).eq('id', this.vehicleId);
  },

  // ---- Sync from Cloud ----
  async syncFromCloud() {
    if (!this.initialized || !this.user) return;

    const { data: cloudTrips } = await sbClient
      .from('trips').select('*')
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

    const { data: cloudLogs } = await sbClient
      .from('fuel_logs').select('*')
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

    App.loadSettings();
    App.renderTrips();
    App.renderCalibrationLog();
    App.updateChartsData();
  },

  // ---- Upload Local Data to Cloud ----
  async uploadLocalData() {
    if (!this.initialized || !this.user) {
      App.toast('Not signed in to cloud', 'error');
      return;
    }
    await this.ensureVehicle();
    const trips = GasKo.getTrips();
    const logs = GasKo.getFuelLogs();
    let tripsFailed = 0, logsFailed = 0;
    App.toast(`Uploading ${trips.length} trips...`, 'info');
    for (const trip of trips) {
      try { await this.saveTrip(trip); }
      catch (e) { tripsFailed++; console.error('Upload trip failed:', e); }
    }
    for (const log of logs) {
      try { await this.saveFuelLog(log); }
      catch (e) { logsFailed++; console.error('Upload log failed:', e); }
    }
    if (tripsFailed + logsFailed === 0) {
      App.toast(`Uploaded ${trips.length} trips and ${logs.length} logs ✓`, 'success');
    } else {
      App.toast(`Upload done. ${tripsFailed} trips and ${logsFailed} logs failed — check console`, 'error');
    }
  },

  // ---- Diagnose Cloud Issues ----
  diagnose() {
    console.log('=== GasKo Cloud Diagnose ===');
    console.log('Initialized:', this.initialized);
    console.log('User:', this.user ? this.user.email : 'NOT SIGNED IN');
    console.log('Vehicle ID:', this.vehicleId || 'NONE');
    console.log('Online:', navigator.onLine);
    if (!this.initialized) console.warn('⚠ Supabase not initialized — check CDN script');
    if (!this.user) console.warn('⚠ Not signed in — go to Account page and sign in');
    if (!this.vehicleId) console.warn('⚠ No vehicle — run database.sql in Supabase SQL editor');
    console.log('============================');
  },

  // ---- Update Auth UI ----
  updateAuthUI() {
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

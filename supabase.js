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
          lock: async (_name, _acquireTimeout, fn) => await fn()
        }
      });
      this.initialized = true;
      console.log('GasKo: Supabase initialized successfully.');
      // Warm up connection so sign-in responds faster (avoids cold start delay)
      fetch(`${SUPABASE_URL}/auth/v1/settings`, {
        headers: { 'apikey': SUPABASE_ANON_KEY }
      }).catch(() => {});
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
      // Update UI immediately — DB setup runs in background
      this.updateAuthUI();
      this.ensureVehicle()
        .then(() => this.syncFromCloud())
        .catch(e => console.error('GasKo: checkSession sync error:', e));
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


  async signUp(email, password) {
    console.log('GasKo: signUp called', email);
    if (!this.initialized) {
      App.toast('Cloud sync unavailable — check connection', 'error');
      return;
    }
    try {
      const { data, error } = await sbClient.auth.signUp({ email, password });
      console.log('GasKo: signUp result', { data, error });
      if (error) {
        // "User already registered" → guide them to Sign In instead
        if (error.message.toLowerCase().includes('already registered') ||
            error.message.toLowerCase().includes('already been registered') ||
            error.status === 422) {
          App.toast('Account already exists — switching to Sign In', 'info');
          // Auto-switch to Sign In tab
          document.getElementById('tab-login')?.click();
          // Pre-fill the email in sign-in form
          const loginEmail = document.getElementById('login-email');
          if (loginEmail) loginEmail.value = email;
          document.getElementById('login-password')?.focus();
          return null;
        }
        App.toast(error.message, 'error');
        return null;
      }
      App.toast('Account created! You can now sign in.', 'success');
      // Auto-switch to Sign In tab after successful signup
      document.getElementById('tab-login')?.click();
      const loginEmail = document.getElementById('login-email');
      if (loginEmail) loginEmail.value = email;
      document.getElementById('login-password')?.focus();
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
      return;
    }
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Sign in timed out — please try again')), 10000)
    );
    try {
      const { data, error } = await Promise.race([
        sbClient.auth.signInWithPassword({ email, password }),
        timeout
      ]);
      console.log('GasKo: signIn result', { data, error });
      if (error) { App.toast(error.message, 'error'); return null; }
      return data;
    } catch (e) {
      console.error('GasKo: signIn exception:', e);
      App.toast(e.message, 'error');
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
  // Smart merge: cloud is authoritative, but locally-deleted trips stay deleted.
  // A trip is treated as "locally deleted" if it was once synced (has a UUID id)
  // but no longer appears in localStorage.
  async syncFromCloud() {
    if (!this.initialized || !this.user) return;

    const { data: cloudTrips, error: tripErr } = await sbClient
      .from('trips').select('*')
      .eq('user_id', this.user.id)
      .order('start_time', { ascending: false });

    if (!tripErr && cloudTrips && cloudTrips.length > 0) {
      const localTrips = GasKo.getTrips();
      const localIds = new Set(localTrips.map(t => t.id));

      // Build list of ids that the user explicitly deleted locally
      const deletedIds = this._getDeletedTripIds();

      // Merge: keep local + add cloud trips not deleted locally
      const merged = [...localTrips];
      cloudTrips.forEach(ct => {
        if (!localIds.has(ct.id) && !deletedIds.has(ct.id)) {
          merged.push({
            id: ct.id,
            startTime: new Date(ct.start_time).getTime(),
            endTime: new Date(ct.end_time).getTime(),
            distance: ct.distance_km,
            fuelUsed: ct.fuel_used_liters,
            cost: ct.cost,
            fuelPrice: ct.fuel_price,
            avgSpeed: ct.avg_speed_kmh,
            maxSpeed: ct.max_speed_kmh,
            efficiencyUsed: ct.efficiency_used,
            drivingScore: ct.driving_score,
            route: ct.route_data || [],
            behaviorInsight: ct.behavior_insight || '',
            duration: ct.duration_ms
          });
        }
      });
      merged.sort((a, b) => b.startTime - a.startTime);
      GasKo.saveTrips(merged);
    }

    const { data: cloudLogs, error: logErr } = await sbClient
      .from('fuel_logs').select('*')
      .eq('user_id', this.user.id)
      .order('created_at', { ascending: false });

    if (!logErr && cloudLogs && cloudLogs.length > 0) {
      const localLogs = GasKo.getFuelLogs();
      const localLogIds = new Set(localLogs.map(l => l.id));
      cloudLogs.forEach(cl => {
        if (!localLogIds.has(cl.id)) {
          localLogs.push({
            id: cl.id,
            fuelAdded: cl.fuel_added_liters,
            distance: cl.distance_km,
            efficiency: cl.computed_efficiency,
            odometer: cl.odometer_reading,
            notes: cl.notes || '',
            date: new Date(cl.created_at).getTime()
          });
        }
      });
      localLogs.sort((a, b) => b.date - a.date);
      GasKo.saveFuelLogs(localLogs);
    }

    App.loadSettings();
    App.renderTrips();
    App.renderCalibrationLog();
    App.updateChartsData();
  },

  // Track locally-deleted cloud trip IDs to prevent re-sync
  _getDeletedTripIds() {
    return new Set(JSON.parse(localStorage.getItem('gasko_deleted_trip_ids') || '[]'));
  },
  _markTripDeleted(id) {
    const ids = this._getDeletedTripIds();
    ids.add(id);
    localStorage.setItem('gasko_deleted_trip_ids', JSON.stringify([...ids]));
  },

  // ---- Delete Trip from Cloud ----
  async deleteTrip(tripId) {
    // Mark as deleted locally first (prevents re-sync)
    this._markTripDeleted(tripId);
    if (!this.initialized || !this.user) return;
    try {
      // Only delete if it's a UUID (cloud trip), not a locally-generated ID
      if (tripId && tripId.includes('-')) {
        const { error } = await sbClient.from('trips').delete().eq('id', tripId).eq('user_id', this.user.id);
        if (error) console.error('GasKo: deleteTrip error:', error.message);
        else console.log('GasKo: Trip deleted from cloud ✓');
      }
    } catch (e) { console.error('GasKo: deleteTrip exception:', e); }
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
    // Refresh friends page if currently open
    if (App.currentPage === 'friends') App.loadFriendsPage();
  },

  isLoggedIn() { return !!this.user; },

  // ========== FRIENDS SYSTEM ==========

  // ---- Send Friend Request ----
  async sendFriendRequest(toEmail) {
    if (!this.initialized || !this.user) return false;
    try {
      // Look up user id by email via friends_profiles view
      const { data: profile, error: profileErr } = await sbClient
        .from('user_profiles')
        .select('user_id, email')
        .eq('email', toEmail)
        .maybeSingle();

      if (profileErr || !profile) {
        App.toast('User not found. Make sure they have a GasKo account.', 'error');
        return false;
      }
      if (profile.user_id === this.user.id) {
        App.toast('Cannot add yourself!', 'error');
        return false;
      }

      // Check if already friends or request pending
      const { data: existing } = await sbClient
        .from('friendships')
        .select('id, status')
        .or(`requester_id.eq.${this.user.id},addressee_id.eq.${this.user.id}`)
        .or(`requester_id.eq.${profile.user_id},addressee_id.eq.${profile.user_id}`);

      const alreadyExists = existing && existing.some(f =>
        (f.requester_id === this.user.id && f.addressee_id === profile.user_id) ||
        (f.requester_id === profile.user_id && f.addressee_id === this.user.id)
      );
      if (alreadyExists) {
        App.toast('Friend request already sent or already friends!', 'info');
        return false;
      }

      const { error } = await sbClient.from('friendships').insert({
        requester_id: this.user.id,
        addressee_id: profile.user_id,
        status: 'pending'
      });
      if (error) { App.toast('Failed to send request: ' + error.message, 'error'); return false; }
      App.toast(`Friend request sent to ${toEmail}!`, 'success');
      return true;
    } catch (e) {
      console.error('GasKo: sendFriendRequest exception:', e);
      App.toast('Failed to send friend request', 'error');
      return false;
    }
  },

  // ---- Get Friends and Pending Requests ----
  async getFriends() {
    if (!this.initialized || !this.user) return { friends: [], requests: [] };
    try {
      // Accepted friendships where I am either side
      const { data: friendships } = await sbClient
        .from('friendships')
        .select('id, requester_id, addressee_id, status')
        .or(`requester_id.eq.${this.user.id},addressee_id.eq.${this.user.id}`);

      if (!friendships) return { friends: [], requests: [] };

      const accepted = friendships.filter(f => f.status === 'accepted');
      const pending = friendships.filter(f => f.status === 'pending' && f.addressee_id === this.user.id);

      // Get friend user ids
      const friendUserIds = accepted.map(f =>
        f.requester_id === this.user.id ? f.addressee_id : f.requester_id
      );
      const requesterIds = pending.map(f => f.requester_id);
      const allIds = [...new Set([...friendUserIds, ...requesterIds])];

      // Get profiles
      let profiles = {};
      if (allIds.length > 0) {
        const { data: profileData } = await sbClient
          .from('user_profiles')
          .select('user_id, email')
          .in('user_id', allIds);
        if (profileData) profileData.forEach(p => { profiles[p.user_id] = p.email; });
      }

      // Get friend trip stats
      let friendStats = {};
      if (friendUserIds.length > 0) {
        const { data: tripData } = await sbClient
          .from('trips')
          .select('user_id, distance_km, driving_score')
          .in('user_id', friendUserIds);
        if (tripData) {
          tripData.forEach(t => {
            if (!friendStats[t.user_id]) friendStats[t.user_id] = { trips: 0, total_distance: 0, score_sum: 0 };
            friendStats[t.user_id].trips++;
            friendStats[t.user_id].total_distance += t.distance_km || 0;
            friendStats[t.user_id].score_sum += t.driving_score || 0;
          });
        }
      }

      const friends = accepted.map(f => {
        const friendId = f.requester_id === this.user.id ? f.addressee_id : f.requester_id;
        const stats = friendStats[friendId] || {};
        return {
          friendship_id: f.id,
          friend_email: profiles[friendId] || friendId,
          trips: stats.trips || 0,
          total_distance: stats.total_distance || 0,
          avg_score: stats.trips ? stats.score_sum / stats.trips : 0
        };
      });

      const requests = pending.map(f => ({
        id: f.id,
        requester_email: profiles[f.requester_id] || f.requester_id
      }));

      return { friends, requests };
    } catch (e) {
      console.error('GasKo: getFriends exception:', e);
      return { friends: [], requests: [] };
    }
  },

  // ---- Respond to Friend Request ----
  async respondFriendRequest(requestId, accept) {
    if (!this.initialized || !this.user) return;
    try {
      if (accept) {
        await sbClient.from('friendships').update({ status: 'accepted' }).eq('id', requestId).eq('addressee_id', this.user.id);
        App.toast('Friend request accepted! 🎉', 'success');
      } else {
        await sbClient.from('friendships').delete().eq('id', requestId).eq('addressee_id', this.user.id);
        App.toast('Friend request declined.', 'info');
      }
    } catch (e) { console.error('GasKo: respondFriendRequest exception:', e); }
  },

  // ---- Remove Friend ----
  async removeFriend(friendshipId) {
    if (!this.initialized || !this.user) return;
    try {
      await sbClient.from('friendships').delete().eq('id', friendshipId);
      App.toast('Friend removed.', 'info');
    } catch (e) { console.error('GasKo: removeFriend exception:', e); }
  }

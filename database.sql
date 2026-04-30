-- =============================================
-- GasKo Database Schema
-- Run this in Supabase SQL Editor (supabase.com → your project → SQL Editor)
-- =============================================

-- 1. Vehicles table
CREATE TABLE IF NOT EXISTS vehicles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL DEFAULT 'My Vehicle',
  fuel_type TEXT NOT NULL DEFAULT 'gasoline',
  fuel_efficiency FLOAT NOT NULL DEFAULT 12.0,
  fuel_price FLOAT NOT NULL DEFAULT 65.50,
  tank_capacity FLOAT DEFAULT 42.0,
  last_odometer FLOAT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Trips table
CREATE TABLE IF NOT EXISTS trips (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  distance_km FLOAT NOT NULL DEFAULT 0,
  fuel_used_liters FLOAT NOT NULL DEFAULT 0,
  cost FLOAT NOT NULL DEFAULT 0,
  fuel_price FLOAT DEFAULT 0,
  avg_speed_kmh FLOAT DEFAULT 0,
  max_speed_kmh FLOAT DEFAULT 0,
  efficiency_used FLOAT DEFAULT 0,
  driving_score FLOAT DEFAULT 0,
  route_data JSONB DEFAULT '[]'::jsonb,
  behavior_insight TEXT DEFAULT '',
  duration_ms BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Fuel logs table (for calibration)
CREATE TABLE IF NOT EXISTS fuel_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  fuel_added_liters FLOAT NOT NULL,
  distance_km FLOAT NOT NULL,
  computed_efficiency FLOAT NOT NULL,
  odometer_reading FLOAT DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Row Level Security (RLS) - users can only see their own data
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_logs ENABLE ROW LEVEL SECURITY;

-- Vehicles policies
CREATE POLICY "Users can view own vehicles" ON vehicles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own vehicles" ON vehicles
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own vehicles" ON vehicles
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own vehicles" ON vehicles
  FOR DELETE USING (auth.uid() = user_id);

-- Trips policies
CREATE POLICY "Users can view own trips" ON trips
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own trips" ON trips
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own trips" ON trips
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own trips" ON trips
  FOR DELETE USING (auth.uid() = user_id);

-- Fuel logs policies
CREATE POLICY "Users can view own fuel_logs" ON fuel_logs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own fuel_logs" ON fuel_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own fuel_logs" ON fuel_logs
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own fuel_logs" ON fuel_logs
  FOR DELETE USING (auth.uid() = user_id);

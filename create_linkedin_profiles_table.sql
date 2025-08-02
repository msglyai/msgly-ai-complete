-- LinkedIn Profiles Table for Bright Data Integration
-- Complete schema to capture ALL Bright Data LinkedIn fields

CREATE TABLE IF NOT EXISTS linkedin_profiles (
    id SERIAL PRIMARY KEY,
    profile_url TEXT UNIQUE NOT NULL,
    
    -- Basic Profile Information
    full_name TEXT,
    first_name TEXT,
    last_name TEXT,
    headline TEXT,
    summary TEXT,
    location TEXT,
    industry TEXT,
    
    -- Professional Information
    current_company TEXT,
    current_position TEXT,
    
    -- Social Metrics
    connections_count INTEGER,
    followers_count INTEGER,
    
    -- Media
    profile_image_url TEXT,
    background_image_url TEXT,
    
    -- Complex Data as JSONB (stores arrays and objects)
    experience JSONB DEFAULT '[]'::JSONB,
    education JSONB DEFAULT '[]'::JSONB,
    skills JSONB DEFAULT '[]'::JSONB,
    certifications JSONB DEFAULT '[]'::JSONB,
    courses JSONB DEFAULT '[]'::JSONB,
    projects JSONB DEFAULT '[]'::JSONB,
    publications JSONB DEFAULT '[]'::JSONB,
    volunteer_work JSONB DEFAULT '[]'::JSONB,
    honors_awards JSONB DEFAULT '[]'::JSONB,
    languages JSONB DEFAULT '[]'::JSONB,
    activity JSONB DEFAULT '[]'::JSONB,
    articles JSONB DEFAULT '[]'::JSONB,
    recommendations JSONB DEFAULT '[]'::JSONB,
    
    -- Complete Raw Data Storage
    raw_json JSONB,
    
    -- Metadata
    extraction_status VARCHAR(50) DEFAULT 'pending',
    extraction_method VARCHAR(50),
    bright_data_snapshot_id VARCHAR(255),
    extraction_started_at TIMESTAMP DEFAULT NOW(),
    extraction_completed_at TIMESTAMP,
    extraction_error TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_linkedin_profiles_url ON linkedin_profiles(profile_url);
CREATE INDEX IF NOT EXISTS idx_linkedin_profiles_status ON linkedin_profiles(extraction_status);
CREATE INDEX IF NOT EXISTS idx_linkedin_profiles_created ON linkedin_profiles(created_at);
CREATE INDEX IF NOT EXISTS idx_linkedin_profiles_company ON linkedin_profiles(current_company);
CREATE INDEX IF NOT EXISTS idx_linkedin_profiles_name ON linkedin_profiles(full_name);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_linkedin_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER linkedin_profiles_updated_at 
    BEFORE UPDATE ON linkedin_profiles 
    FOR EACH ROW 
    EXECUTE FUNCTION update_linkedin_profiles_updated_at();
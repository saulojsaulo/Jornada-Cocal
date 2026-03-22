-- Run this in the Supabase SQL Editor to schedule the edge functions to run every 5 minutes.
-- IMPORTANT: Replace 'YOUR_SUPABASE_ANON_KEY' with the actual anon key or service role key of your project.

-- 1. Enable extensions if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Schedule 'autotrac-sync' every 5 minutes
SELECT cron.schedule(
    'invoke-autotrac-sync',
    '*/5 * * * *', -- cron format: every 5 minutes
    $$
    SELECT net.http_post(
        url:='https://logxhbphjtgobvppmyve.supabase.co/functions/v1/autotrac-sync',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SUPABASE_ANON_KEY"}'::jsonb,
        body:='{}'::jsonb
    ) as request_id;
    $$
);

-- 3. Schedule 'telemetry-sync' every 5 minutes
SELECT cron.schedule(
    'invoke-telemetry-sync',
    '*/5 * * * *', -- cron format: every 5 minutes
    $$
    SELECT net.http_post(
        url:='https://logxhbphjtgobvppmyve.supabase.co/functions/v1/telemetry-sync',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SUPABASE_ANON_KEY"}'::jsonb,
        body:='{}'::jsonb
    ) as request_id;
    $$
);

-- NOTE: To view logs or delete the cron jobs later, you can use:
-- SELECT * FROM cron.job;
-- SELECT cron.unschedule('invoke-autotrac-sync');

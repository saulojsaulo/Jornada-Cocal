-- Add senha (password) column to motoristas table for driver identification
ALTER TABLE public.motoristas ADD COLUMN IF NOT EXISTS senha TEXT UNIQUE;

-- Add driver_password column to autotrac_eventos so we can link events to drivers
ALTER TABLE public.autotrac_eventos ADD COLUMN IF NOT EXISTS driver_password TEXT;

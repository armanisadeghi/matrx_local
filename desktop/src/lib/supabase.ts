import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error(
        '[supabase] Missing env vars. Ensure VITE_SUPABASE_URL and ' +
        'VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY are set at build time.'
    );
}

const supabase = createClient(supabaseUrl ?? '', supabaseKey ?? '');

export default supabase;
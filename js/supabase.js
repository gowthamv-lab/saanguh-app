// ===============================
// Supabase Client Setup
// ===============================
// For now, we use localStorage as a lightweight data store.
// When you're ready to go live, create a Supabase project and
// replace these with your real credentials.

const SUPABASE_URL = 'https://thkauenrvaekmtvwaqzs.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_bIYAYe9W5v1RM6fAneuVUg_hi46AwR6'

// Check if Supabase is configured
const isSupabaseConfigured = SUPABASE_URL && SUPABASE_ANON_KEY;

// Local Storage fallback for development
const LocalDB = {
    get(key) {
        try {
            const data = localStorage.getItem(`saanguh_${key}`);
            return data ? JSON.parse(data) : null;
        } catch { return null; }
    },
    set(key, value) {
        localStorage.setItem(`saanguh_${key}`, JSON.stringify(value));
    },
    remove(key) {
        localStorage.removeItem(`saanguh_${key}`);
    }
};

// Initialize default data if not exists
if (!LocalDB.get('playlists')) {
    LocalDB.set('playlists', []);
}
if (!LocalDB.get('favorites')) {
    LocalDB.set('favorites', []);
}
if (!LocalDB.get('recent')) {
    LocalDB.set('recent', []);
}

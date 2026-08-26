// Supabase connection for cloud sync — project "The money app".
// The anon (publishable) key is safe to keep here — every table is protected by
// row level security, so a key alone cannot read anyone's data.
// Get it at: Supabase dashboard -> Project Settings -> API -> anon / publishable key.
// You can also paste it once inside the app: Settings -> Cloud sync.
window.STASH_CONFIG = window.STASH_CONFIG || {
  url: 'https://yshiopubnvibpimpbqdj.supabase.co',
  anonKey: ''
};

let supabase = null;
let authInitPromise = null;
let authState = {
  ready: false,
  enabled: false,
  user: null,
  session: null,
};
const listeners = new Set();

function emit() {
  const snapshot = getAuthState();
  listeners.forEach((listener) => listener(snapshot));
}

function publicUser(user) {
  if (!user) return null;
  const meta = user.user_metadata || {};
  return {
    id: user.id,
    email: user.email || '',
    name: meta.full_name || meta.name || user.email || 'Signed-in scholar',
    avatarUrl: meta.avatar_url || meta.picture || '',
  };
}

export function getAuthState() {
  return {
    ready: authState.ready,
    enabled: authState.enabled,
    user: authState.user,
    session: authState.session,
    signedIn: !!authState.user,
  };
}

export function onAuthChange(listener) {
  listeners.add(listener);
  listener(getAuthState());
  return () => listeners.delete(listener);
}

export async function initAuth() {
  if (authState.ready) return getAuthState();
  if (authInitPromise) return authInitPromise;

  authInitPromise = (async () => {
    try {
      const res = await fetch('/api/auth/config', { cache: 'no-store' });
      const config = await res.json();
      if (!config.enabled || !config.supabaseUrl || !config.supabaseKey) {
        authState = { ready: true, enabled: false, user: null, session: null };
        emit();
        return getAuthState();
      }

      const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
      supabase = createClient(config.supabaseUrl, config.supabaseKey, {
        auth: {
          detectSessionInUrl: true,
          persistSession: true,
          autoRefreshToken: true,
        },
      });

      const { data } = await supabase.auth.getSession();
      authState = {
        ready: true,
        enabled: true,
        session: data.session || null,
        user: publicUser(data.session?.user),
      };

      supabase.auth.onAuthStateChange((_event, session) => {
        authState = {
          ready: true,
          enabled: true,
          session: session || null,
          user: publicUser(session?.user),
        };
        emit();
      });

      emit();
      return getAuthState();
    } catch {
      authState = { ready: true, enabled: false, user: null, session: null };
      emit();
      return getAuthState();
    }
  })();

  return authInitPromise;
}

export async function signInWithGoogle() {
  await initAuth();
  if (!supabase) throw new Error('Google sign-in is not configured yet.');

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/workspace`,
      queryParams: {
        access_type: 'offline',
        prompt: 'select_account',
      },
    },
  });

  if (error) throw error;
}

export async function signOut() {
  await initAuth();
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function getAccessToken() {
  await initAuth();
  if (!supabase) return '';
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || '';
}

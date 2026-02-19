# Chrome Extension Auth Rewrite -- Extension Side (matrx-chrome)

This document describes exactly what needs to change in the Chrome extension to implement proper authentication using `chrome.identity.launchWebAuthFlow` with Supabase OAuth.

## Current Problems

1. The extension uses `signInWithOAuth({ redirectTo: chrome.runtime.getURL('options/options.html') })` which tries to redirect the OAuth callback to a `chrome-extension://` URL. This does not work reliably because Supabase and OAuth providers don't support `chrome-extension://` as a redirect scheme.
2. The extension requires users to manually enter Supabase URL and anon key in settings. These should be hardcoded since the extension is built specifically for your Supabase project.
3. The `lib/auth.js` has a manual token refresh implementation that fights with Supabase's built-in auto-refresh.

## The Correct Pattern: `chrome.identity.launchWebAuthFlow`

Chrome provides `chrome.identity.launchWebAuthFlow()` specifically for OAuth in extensions. It:
- Opens the OAuth provider in a popup window
- Handles the entire redirect chain
- Returns the final redirect URL (with tokens) back to your extension code
- Uses the special URL `https://<extension-id>.chromiumapp.org/` as the redirect target
- This URL is automatically handled by Chrome -- no web server needed

## Required Changes

### 1. Update `manifest.json`

Remove unnecessary permissions and ensure `identity` is present:

```json
{
  "permissions": [
    "activeTab",
    "storage",
    "contextMenus",
    "identity",
    "tabs",
    "scripting",
    "sidePanel"
  ]
}
```

Remove `cookies`, `clipboardWrite`, and `downloads` if not needed for other features.

### 2. Rewrite `lib/auth.js`

Replace the entire file with this implementation:

```javascript
// lib/auth.js
// Supabase Authentication for Chrome Extension using chrome.identity

// HARDCODED -- this extension only works with the AI Matrx Supabase project
const SUPABASE_URL = 'https://txzxabzwovsujtloxrus.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_4pvkRT-9-_dB0PWqF1sp1w_W9leRIoW';

// Fallback to legacy key if publishable key doesn't work yet
const SUPABASE_KEY = SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4enhhYnp3b3ZzdWp0bG94cnVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjIxMTU5NzEsImV4cCI6MjAzNzY5MTk3MX0.7mmSbQYGIdc_yZuwawXKSEYr2OUBDfDHqnqUSrIUamk';

class SupabaseAuth {
    constructor() {
        this.supabase = null;
        this.user = null;
        this.session = null;
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;

        try {
            // Load Supabase client library if not already loaded
            if (typeof window !== 'undefined' && !window.supabase) {
                await this.loadSupabaseScript();
            }

            // Initialize Supabase client with Chrome storage adapter
            this.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
                auth: {
                    storage: new ChromeStorageAdapter(),
                    autoRefreshToken: true,
                    persistSession: true,
                    detectSessionInUrl: false, // We handle URL parsing ourselves
                }
            });

            // Load existing session from storage
            const { data: { session } } = await this.supabase.auth.getSession();
            if (session) {
                this.session = session;
                this.user = session.user;
            }

            // Listen for auth state changes
            this.supabase.auth.onAuthStateChange((event, session) => {
                console.log('[Auth] State changed:', event);
                this.session = session;
                this.user = session?.user || null;
            });

            this.initialized = true;
            console.log('[Auth] Initialized', this.user ? `for ${this.user.email}` : '(no user)');
        } catch (error) {
            console.error('[Auth] Initialization failed:', error);
            throw error;
        }
    }

    async loadSupabaseScript() {
        return new Promise((resolve, reject) => {
            if (typeof window !== 'undefined' && window.supabase) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = chrome.runtime.getURL('lib/supabase.js');
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load Supabase'));
            document.head.appendChild(script);
        });
    }

    // -----------------------------------------------------------------------
    // OAuth Sign-In using chrome.identity.launchWebAuthFlow
    // This is the CORRECT way to do OAuth in a Chrome extension.
    // -----------------------------------------------------------------------

    async signInWithGoogle() {
        return this._signInWithOAuth('google');
    }

    async signInWithGitHub() {
        return this._signInWithOAuth('github');
    }

    async signInWithApple() {
        return this._signInWithOAuth('apple');
    }

    async _signInWithOAuth(provider) {
        if (!this.supabase) throw new Error('Not initialized');

        // Get the extension's redirect URL (Chrome handles this automatically)
        const redirectUrl = chrome.identity.getRedirectURL();
        // This returns: https://<extension-id>.chromiumapp.org/

        // Build the Supabase OAuth URL manually
        // We need the URL but don't want Supabase to open it in a tab
        const { data, error } = await this.supabase.auth.signInWithOAuth({
            provider,
            options: {
                redirectTo: redirectUrl,
                skipBrowserRedirect: true, // CRITICAL: Don't open in a tab
            }
        });

        if (error) throw error;
        if (!data?.url) throw new Error('No OAuth URL returned');

        // Launch the OAuth flow in a Chrome identity popup
        const resultUrl = await new Promise((resolve, reject) => {
            chrome.identity.launchWebAuthFlow(
                {
                    url: data.url,
                    interactive: true, // Show the popup to the user
                },
                (callbackUrl) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else if (!callbackUrl) {
                        reject(new Error('No callback URL received'));
                    } else {
                        resolve(callbackUrl);
                    }
                }
            );
        });

        // Extract tokens from the callback URL fragment
        // The URL looks like: https://<id>.chromiumapp.org/#access_token=...&refresh_token=...
        const hashParams = new URLSearchParams(resultUrl.split('#')[1]);
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');

        if (!accessToken || !refreshToken) {
            throw new Error('No tokens in callback URL');
        }

        // Set the session in Supabase client
        const { data: sessionData, error: sessionError } = await this.supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
        });

        if (sessionError) throw sessionError;

        this.session = sessionData.session;
        this.user = sessionData.user;

        return { session: this.session, user: this.user };
    }

    // -----------------------------------------------------------------------
    // Email/Password Sign-In (works as-is, no changes needed)
    // -----------------------------------------------------------------------

    async signIn(email, password) {
        if (!this.supabase) throw new Error('Not initialized');
        const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        this.session = data.session;
        this.user = data.user;
        return data;
    }

    async signUp(email, password, userData = {}) {
        if (!this.supabase) throw new Error('Not initialized');
        const { data, error } = await this.supabase.auth.signUp({
            email,
            password,
            options: { data: userData }
        });
        if (error) throw error;
        return data;
    }

    async signOut() {
        if (!this.supabase) throw new Error('Not initialized');
        const { error } = await this.supabase.auth.signOut();
        if (error) throw error;
        this.user = null;
        this.session = null;
    }

    // -----------------------------------------------------------------------
    // Session helpers
    // -----------------------------------------------------------------------

    async getAccessToken() {
        if (!this.session) return null;
        // Supabase auto-refreshes tokens via the client. Just return current token.
        // If it's expired, getSession() will refresh it automatically.
        const { data: { session } } = await this.supabase.auth.getSession();
        this.session = session;
        return session?.access_token || null;
    }

    getUserId() {
        return this.user?.id || null;
    }

    getUser() {
        return this.user;
    }

    isAuthenticated() {
        return !!this.user && !!this.session;
    }

    async getAuthHeaders() {
        const token = await this.getAccessToken();
        if (!token) return {};
        return {
            'Authorization': `Bearer ${token}`,
            'apikey': SUPABASE_KEY,
        };
    }

    getSupabaseClient() {
        return this.supabase;
    }
}

// Chrome Storage Adapter for Supabase Auth
// Supabase expects localStorage-like API. This bridges to chrome.storage.local.
class ChromeStorageAdapter {
    async getItem(key) {
        return new Promise((resolve) => {
            chrome.storage.local.get([key], (result) => {
                resolve(result[key] || null);
            });
        });
    }

    async setItem(key, value) {
        return new Promise((resolve) => {
            chrome.storage.local.set({ [key]: value }, resolve);
        });
    }

    async removeItem(key) {
        return new Promise((resolve) => {
            chrome.storage.local.remove([key], resolve);
        });
    }
}

// Export
if (typeof window !== 'undefined') {
    window.SupabaseAuth = SupabaseAuth;
}

const supabaseAuth = new SupabaseAuth();
```

### 3. Update `options/options.js` -- Auth Section

Remove the manual Supabase URL/key configuration fields. The extension is hardcoded to your project. The options page should only show:

- Sign in with Google / GitHub / Apple buttons
- Email/password sign in
- Current user info when logged in
- Sign out button

Remove:
- The "Supabase URL" input field
- The "Supabase Anon Key" input field
- The "Test Connection" button for Supabase
- Any code that reads/writes `supabaseUrl` and `supabaseAnonKey` from `chrome.storage.sync`

The `handleGoogleSignIn()` and `handleGitHubSignIn()` functions should call `supabaseAuth.signInWithGoogle()` and `supabaseAuth.signInWithGitHub()` -- which now use `launchWebAuthFlow` internally.

Remove `handleOAuthRedirect()` -- the new flow doesn't redirect to the options page.

### 4. Update `options/options.html`

Remove the Supabase configuration form fields (URL, key, table name). Replace with a simpler auth-focused UI:
- "Sign in with Google" button
- "Sign in with GitHub" button  
- Email/password fields
- Signed-in user display

### 5. Update `content/content.js`

Instead of reading `supabaseUrl` and `supabaseAnonKey` from `chrome.storage.sync`, hardcode them or import from `lib/auth.js`. The content script should get auth tokens from the background/auth module via message passing.

### 6. Update `background/background.js`

Update the `onInstalled` handler to remove `supabaseUrl` and `supabaseAnonKey` from default config. These are now hardcoded.

Remove from default config:
```javascript
// REMOVE these from chrome.storage.sync defaults:
// supabaseUrl: '',
// supabaseAnonKey: '',
```

Keep `supabaseTableName` and any other non-auth config.

### 7. Files to Delete

These are no longer needed:
- Nothing to delete from the extension itself. All existing files get modified.

## Supabase Dashboard Setup (REQUIRED)

1. Go to **Supabase Dashboard > Authentication > URL Configuration**
2. Under **Redirect URLs**, add:
   ```
   https://<YOUR-EXTENSION-ID>.chromiumapp.org/
   ```
   Get your extension ID from `chrome://extensions/` (with Developer Mode on).
   
3. For development, you can add a wildcard:
   ```
   https://*.chromiumapp.org/
   ```

4. Ensure Google, GitHub, and/or Apple OAuth providers are enabled in:
   **Supabase Dashboard > Authentication > Providers**

## How It Works After Changes

```
1. User clicks "Sign in with Google" in extension options/popup
2. Extension calls supabaseAuth.signInWithGoogle()
3. auth.js builds the Supabase OAuth URL with skipBrowserRedirect: true
4. chrome.identity.launchWebAuthFlow() opens a popup with the OAuth flow
5. User authenticates with Google
6. Google redirects to Supabase, Supabase redirects to https://<id>.chromiumapp.org/#tokens
7. Chrome catches the redirect and returns the URL to the extension
8. Extension extracts access_token + refresh_token from URL fragment
9. Extension calls supabase.auth.setSession() with the tokens
10. User is now authenticated -- Supabase client has a valid session
11. Session persists in chrome.storage.local via ChromeStorageAdapter
12. Tokens auto-refresh via Supabase client's built-in mechanism
```

## Testing

1. Load the updated extension at `chrome://extensions/`
2. Note the Extension ID
3. Add `https://<extension-id>.chromiumapp.org/` to Supabase redirect allowlist
4. Open the extension options page
5. Click "Sign in with Google"
6. A popup should appear with the Google sign-in flow
7. After signing in, the popup closes and the extension shows your user info
8. Refresh the options page -- session should persist
9. Close and reopen Chrome -- session should still persist

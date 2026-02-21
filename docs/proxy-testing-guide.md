# Proxy Setup Testing & Troubleshooting Guide (React Frontend)

This guide is for the React frontend team to validate that a user's local proxy is functioning correctly and to help users troubleshoot issues.

## How the Proxy Works

The Matrx Local Python engine runs an HTTP forward proxy server on `127.0.0.1:22180` (port range 22180-22189). It starts automatically on engine startup when `proxy_enabled` is `true` in settings (default).

The proxy supports:
- HTTP CONNECT (for HTTPS tunneling)
- Plain HTTP forwarding
- No authentication required (localhost only)

## Frontend Validation Steps

### 1. Check Proxy Status

```typescript
import { engine } from "@/lib/api";

const status = await engine.proxyStatus();
// Returns: { running: boolean, port: number, proxy_url: string, ... }

if (status.running) {
  console.log(`Proxy running at ${status.proxy_url}`);
} else {
  console.log("Proxy is not running");
}
```

### 2. Test Proxy Connectivity

```typescript
const testResult = await engine.proxyTest();
// Returns: { success: boolean, status_code?: number, body?: string, error?: string, proxy_url: string }

if (testResult.success) {
  console.log("Proxy is working correctly");
  console.log("User's public IP via proxy:", testResult.body);
} else {
  console.error("Proxy test failed:", testResult.error);
}
```

### 3. Start/Stop Proxy Manually

```typescript
// Start proxy (0 = auto-select port)
const startResult = await engine.proxyStart(0);
console.log(`Proxy started on port ${startResult.port}`);

// Stop proxy
await engine.proxyStop();
```

## Settings Page Integration

The Settings page (`desktop/src/pages/Settings.tsx`) already includes:

1. **Enable Proxy toggle** - `proxyEnabled` setting (default: true)
2. **Proxy Status badge** - Shows Running/Stopped with port
3. **Proxy URL display** - Shows the URL with copy button
4. **Stats dashboard** - Request count, bytes forwarded, active connections
5. **Test Connection button** - Runs the proxy test
6. **Refresh Status button** - Reloads proxy status from engine

## Troubleshooting Decision Tree

### Proxy shows "Stopped" but user has it enabled

1. **Check engine status** - Is the engine connected? The proxy only starts when the engine starts.
2. **Check port availability** - Port 22180 might be occupied by another process.
   - User can check: Settings > Local Proxy > Proxy Status
   - Resolution: The engine auto-scans ports 22180-22189. If all are taken, the proxy won't start.
3. **Restart engine** - Settings > Engine Connection > Restart Engine

### Test Connection fails

1. **"Proxy server is not running"**
   - The proxy hasn't started. Check the enable toggle and restart the engine.

2. **Connection timeout**
   - The user's network may be blocking outbound connections from the proxy.
   - Check if a firewall (OS-level or network) is blocking port 22180.
   - On macOS: System Settings > Network > Firewall
   - On Windows: Windows Security > Firewall & network protection
   - On Linux: `sudo ufw status` or `sudo iptables -L`

3. **DNS resolution failure**
   - The proxy inherits the user's DNS settings. If DNS isn't working locally, the proxy won't be able to resolve hostnames.
   - Ask user to try `ping httpbin.org` in terminal.

4. **SSL/TLS errors**
   - The proxy does HTTPS tunneling via CONNECT method. If the user has a corporate proxy or SSL inspection, this can interfere.
   - Resolution: The user may need to disable SSL inspection for the proxy port.

### Proxy is running but remote service can't reach it

- The proxy binds to `127.0.0.1` (localhost only). Remote services **cannot** connect to it directly.
- The proxy is intended for use by code running **on the same machine** (the Matrx Local engine).
- For cloud-to-local proxy routing, a reverse tunnel or relay service is needed.

## Browser-based Diagnostics

If a user opens their browser to test the proxy, they can:

1. **Open the Matrx Local app** - Navigate to Settings page
2. **Check the Local Proxy card** for status, URL, and stats
3. **Click "Test Connection"** to verify the proxy can reach the internet
4. **Check the result banner**:
   - Green: "Connected via http://127.0.0.1:22180" = working
   - Red: Shows the specific error message

### Manual Browser Test (Advanced)

Users can test the proxy manually by configuring their browser:

1. **Chrome/Edge**: Settings > System > Open your computer's proxy settings
2. **Firefox**: Settings > Network Settings > Manual proxy configuration
   - HTTP Proxy: `127.0.0.1`, Port: `22180`
   - Check "Also use this proxy for HTTPS"
3. Visit `http://httpbin.org/ip` - should show their normal IP
4. **Remember to remove the proxy setting after testing**

### cURL Test (Advanced)

```bash
# Test HTTP
curl -x http://127.0.0.1:22180 http://httpbin.org/ip

# Test HTTPS (via CONNECT tunnel)
curl -x http://127.0.0.1:22180 https://httpbin.org/ip
```

## Viewing All Settings from Browser

Users can view their full settings by navigating to the Settings page in the Matrx Local app. The page shows:

- **Engine Connection** - Status, port, reconnect/restart
- **Local Proxy** - Enable/disable, status, URL, stats, test
- **Scraping** - Headless mode, request delay
- **Application** - Theme, launch on startup, minimize to tray
- **Cloud Sync** - Sync status, instance ID, registered devices, push/pull controls
- **Account** - User info, sign out
- **System Information** - Platform, OS, CPU, RAM, Python version
- **About** - App version, engine version, updates

### Pushing Settings to Cloud

1. Change any setting locally
2. Click **"Save to Cloud"** in the Cloud Sync card
3. The status banner will show "Push pushed" on success

### Pulling Settings from Cloud

1. Click **"Pull from Cloud"** in the Cloud Sync card
2. Cloud settings overwrite local settings
3. The page reloads with updated values

### Auto-Sync

Settings sync automatically:
- **On startup**: Engine configures cloud sync and runs initial sync
- **On settings change**: Local changes are persisted immediately; cloud push happens on explicit action

## Error Reference

| Error | Cause | Fix |
|-------|-------|-----|
| `Proxy server is not running` | Engine didn't start proxy | Enable proxy in settings, restart engine |
| `Connection refused` | Port not listening | Restart engine; check if port is available |
| `Connection timed out` | Firewall blocking | Check OS firewall settings |
| `DNS resolution failed` | DNS not working | Check network connection |
| `SSL handshake failed` | Corporate SSL inspection | Whitelist proxy port in SSL inspector |
| `Cloud sync failed` | No internet / auth expired | Check connection; re-sign in |
| `Push failed: not_configured` | Not signed in | Sign in via Account section |

## API Endpoints Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/proxy/status` | Proxy running state and stats |
| POST | `/proxy/start` | Start proxy (body: `{"port": 0}`) |
| POST | `/proxy/stop` | Stop proxy |
| POST | `/proxy/test` | Test proxy connectivity |
| POST | `/cloud/configure` | Configure cloud sync |
| GET | `/cloud/settings` | Get all settings |
| PUT | `/cloud/settings` | Update settings |
| POST | `/cloud/sync` | Bidirectional sync |
| POST | `/cloud/sync/push` | Force push to cloud |
| POST | `/cloud/sync/pull` | Force pull from cloud |
| GET | `/cloud/instance` | This instance's info |
| GET | `/cloud/instances` | All user's instances |
| POST | `/cloud/heartbeat` | Update last_seen |

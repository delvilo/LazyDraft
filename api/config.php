<?php
/**
 * Google OAuth and Redis Configuration
 */

// Your Google OAuth 2.0 Web Client ID from Google Cloud Console:
// e.g. '1234567890-abcdefg.apps.googleusercontent.com'
// Leave empty or set your client ID when ready.
define('GOOGLE_CLIENT_ID', getenv('GOOGLE_CLIENT_ID') ?: '');

// Redis Connection Settings
define('REDIS_HOST', '127.0.0.1');
define('REDIS_PORT', 6379);
define('REDIS_AUTH', null); // Set password if Redis requires auth

// Sync Data TTL (Time-To-Live): 48 hours = 172800 seconds
define('SYNC_TTL', 48 * 3600);

// Key prefix in Redis
define('REDIS_KEY_PREFIX', 'note_sync:user:');

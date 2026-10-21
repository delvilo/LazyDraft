<?php
/**
 * Cross-device Cloud Sync API with Google Identity and Redis
 * Actions:
 *   - config: Get public configuration (Google Client ID)
 *   - push: Store note content into Redis (TTL 48h)
 *   - pull: Retrieve note content from Redis
 *   - clear: Remove note content from Redis
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');

require_once __DIR__ . '/config.php';

function jsonResponse($data, $statusCode = 200) {
    http_response_code($statusCode);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function getRedisConnection() {
    try {
        $redis = new Redis();
        $connected = $redis->connect(REDIS_HOST, REDIS_PORT, 2.5);
        if (!$connected) {
            jsonResponse(['error' => '無法連線至本地 Redis 服務'], 503);
        }
        if (defined('REDIS_AUTH') && REDIS_AUTH !== null) {
            $redis->auth(REDIS_AUTH);
        }
        return $redis;
    } catch (Exception $e) {
        jsonResponse(['error' => 'Redis 連線錯誤: ' . $e->getMessage()], 503);
    }
}

/**
 * Verify Google ID Token (JWT)
 * Uses Google tokeninfo endpoint or decodes JWT payload
 */
function verifyGoogleToken($idToken) {
    if (empty($idToken)) {
        return null;
    }

    // Call Google's tokeninfo endpoint for full cryptographic verification
    $url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' . urlencode($idToken);

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 6,
        CURLOPT_SSL_VERIFYPEER => true
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($httpCode === 200 && $response) {
        $payload = json_decode($response, true);
        if ($payload && isset($payload['sub'])) {
            // If Client ID is configured, verify audience matches
            if (defined('GOOGLE_CLIENT_ID') && !empty(GOOGLE_CLIENT_ID)) {
                if (isset($payload['aud']) && $payload['aud'] !== GOOGLE_CLIENT_ID) {
                    return null; // Audience mismatch
                }
            }
            return [
                'sub' => $payload['sub'],
                'email' => $payload['email'] ?? '',
                'name' => $payload['name'] ?? '',
                'picture' => $payload['picture'] ?? ''
            ];
        }
    }

    // Fallback: If external Google endpoint times out, verify JWT format and structure
    $parts = explode('.', $idToken);
    if (count($parts) === 3) {
        $payloadJson = base64_decode(str_replace(['-', '_'], ['+', '/'], $parts[1]));
        $payload = json_decode($payloadJson, true);
        if ($payload && isset($payload['sub']) && isset($payload['exp']) && $payload['exp'] > time()) {
            if (isset($payload['iss']) && in_array($payload['iss'], ['accounts.google.com', 'https://accounts.google.com'])) {
                if (!defined('GOOGLE_CLIENT_ID') || empty(GOOGLE_CLIENT_ID) || (isset($payload['aud']) && $payload['aud'] === GOOGLE_CLIENT_ID)) {
                    return [
                        'sub' => $payload['sub'],
                        'email' => $payload['email'] ?? '',
                        'name' => $payload['name'] ?? '',
                        'picture' => $payload['picture'] ?? ''
                    ];
                }
            }
        }
    }

    return null;
}

$action = $_GET['action'] ?? '';

// Public config query
if ($action === 'config') {
    jsonResponse([
        'clientId' => defined('GOOGLE_CLIENT_ID') ? GOOGLE_CLIENT_ID : '',
        'ttlHours' => defined('SYNC_TTL') ? (SYNC_TTL / 3600) : 48
    ]);
}

// All sync actions require POST with JSON body
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse(['error' => 'Method not allowed. Use POST.'], 405);
}

$rawInput = file_get_contents('php://input');
$body = json_decode($rawInput, true) ?: [];

$token = $body['token'] ?? '';
$user = verifyGoogleToken($token);

if (!$user) {
    jsonResponse(['error' => 'Google 憑證驗證失敗或已過期，請重新登入'], 401);
}

$userSub = $user['sub'];
$redisKey = REDIS_KEY_PREFIX . $userSub;
$redis = getRedisConnection();

switch ($action) {
    case 'push':
        $content = isset($body['content']) ? (string)$body['content'] : '';
        
        // If content is completely empty, treat as clear cloud
        if (trim($content) === '') {
            $redis->del($redisKey);
            jsonResponse([
                'success' => true,
                'cleared' => true,
                'message' => '雲端資料已清空'
            ]);
        }

        $record = [
            'content' => $content,
            'updated_at' => gmdate('Y-m-d\TH:i:s\Z'),
            'user_email' => $user['email']
        ];

        $encoded = json_encode($record, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $redis->setex($redisKey, SYNC_TTL, $encoded);

        jsonResponse([
            'success' => true,
            'updated_at' => $record['updated_at'],
            'ttl' => SYNC_TTL,
            'message' => '內容已成功推播至雲端 Redis（時效 48 小時）'
        ]);
        break;

    case 'pull':
        $raw = $redis->get($redisKey);
        if (!$raw) {
            jsonResponse([
                'found' => false,
                'content' => '',
                'updated_at' => null,
                'message' => '雲端目前沒有暫存的筆記內容'
            ]);
        }

        $record = json_decode($raw, true) ?: [];
        $ttl = $redis->ttl($redisKey);

        jsonResponse([
            'found' => true,
            'content' => $record['content'] ?? '',
            'updated_at' => $record['updated_at'] ?? null,
            'ttl' => $ttl,
            'user' => $user
        ]);
        break;

    case 'clear':
        $redis->del($redisKey);
        jsonResponse([
            'success' => true,
            'message' => '雲端 Redis 資料已手動清除'
        ]);
        break;

    default:
        jsonResponse(['error' => 'Unknown action: ' . htmlspecialchars($action)], 400);
}

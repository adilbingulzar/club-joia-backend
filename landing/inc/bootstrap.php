<?php
declare(strict_types=1);

/** Shared setup: settings, database, security headers and small helpers. Not reachable from the web. */

const TIERS = ['Ruby Red', 'Pearly White', 'Ultra Black', 'Not sure yet'];

function config(): array
{
    static $config;
    if ($config === null) {
        $file = dirname(__DIR__) . '/config.php';
        if (!is_file($file)) {
            http_response_code(503);
            exit('Pre-registration is not configured yet: copy config.sample.php to config.php.');
        }
        $config = require $file;
        if (strlen((string) ($config['secret'] ?? '')) < 32) {
            http_response_code(503);
            exit('Pre-registration is not configured yet: set a 32+ character secret in config.php.');
        }
    }
    return $config;
}

function db(): PDO
{
    static $pdo;
    if ($pdo) return $pdo;
    $c = config()['db'];
    $options = [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false];
    if ($c['driver'] === 'sqlite') {
        @mkdir(dirname($c['sqlite_path']), 0700, true);
        $pdo = new PDO('sqlite:' . $c['sqlite_path'], null, null, $options);
    } else {
        $pdo = new PDO("mysql:host={$c['host']};dbname={$c['name']};charset=utf8mb4", $c['user'], $c['password'], $options);
    }
    migrate($pdo, $c['driver']);
    return $pdo;
}

function migrate(PDO $pdo, string $driver): void
{
    if ($driver === 'sqlite') {
        $pdo->exec('CREATE TABLE IF NOT EXISTS registrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
            phone TEXT NOT NULL, country TEXT NOT NULL, tier_interest TEXT NOT NULL,
            source TEXT, message TEXT, marketing_opt_in INTEGER NOT NULL DEFAULT 0,
            consent_at TEXT NOT NULL, ip_hash TEXT, user_agent TEXT)');
        $pdo->exec('CREATE TABLE IF NOT EXISTS rate_limits (ip_hash TEXT NOT NULL, created_at INTEGER NOT NULL)');
    } else {
        $pdo->exec('CREATE TABLE IF NOT EXISTS registrations (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
            first_name VARCHAR(80) NOT NULL, last_name VARCHAR(80) NOT NULL, email VARCHAR(190) NOT NULL UNIQUE,
            phone VARCHAR(32) NOT NULL, country VARCHAR(80) NOT NULL, tier_interest VARCHAR(20) NOT NULL,
            source VARCHAR(120) NULL, message TEXT NULL, marketing_opt_in TINYINT(1) NOT NULL DEFAULT 0,
            consent_at DATETIME NOT NULL, ip_hash CHAR(64) NULL, user_agent VARCHAR(255) NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
        $pdo->exec('CREATE TABLE IF NOT EXISTS rate_limits (ip_hash CHAR(64) NOT NULL, created_at INT UNSIGNED NOT NULL, INDEX (ip_hash, created_at)) ENGINE=InnoDB');
    }
}

function security_headers(): void
{
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: same-origin');
    header("Content-Security-Policy: default-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
}

/** Anonymised connection id (the raw IP address is never stored). */
function ip_hash(): string
{
    return hash_hmac('sha256', $_SERVER['REMOTE_ADDR'] ?? 'unknown', config()['secret']);
}

function now(): string
{
    return gmdate('Y-m-d H:i:s');
}

function clean(?string $v, int $max): string
{
    $v = trim(preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', (string) $v) ?? '');
    return mb_substr($v, 0, $max);
}

function h(?string $v): string
{
    return htmlspecialchars((string) $v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function send_mail(string $to, string $subject, string $body): bool
{
    $from = config()['mail_from'] ?? '';
    if ($to === '' || $from === '') return false;
    $headers = "From: {$from}\r\nContent-Type: text/plain; charset=UTF-8\r\nX-Mailer: CLUBJOIA300";
    return @mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $body, $headers);
}

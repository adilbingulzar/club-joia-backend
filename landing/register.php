<?php
declare(strict_types=1);

/**
 * Receives the pre-registration form (POST, JSON reply).
 * Spam protection: same-site check, hidden honeypot field, minimum fill time, rate limit per connection.
 * A repeat registration with the same email updates the earlier one (no duplicates, nothing revealed).
 */
require __DIR__ . '/inc/bootstrap.php';
security_headers();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function reply(int $status, array $body): never
{
    http_response_code($status);
    echo json_encode($body);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') reply(405, ['ok' => false, 'error' => 'Method not allowed.']);

// Only accept submissions sent from this site's own page.
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$host = $_SERVER['HTTP_HOST'] ?? '';
if ($origin !== '' && parse_url($origin, PHP_URL_HOST) . (parse_url($origin, PHP_URL_PORT) ? ':' . parse_url($origin, PHP_URL_PORT) : '') !== $host) {
    reply(403, ['ok' => false, 'error' => 'Please submit the form from the CLUB JOIA 300 website.']);
}

// Bots: hidden field filled in, or form sent faster than a person could fill it. Pretend success.
$started = (int) ($_POST['started'] ?? 0);
if (($_POST['website'] ?? '') !== '' || ($started > 0 && (time() * 1000 - $started) < 3000)) {
    reply(200, ['ok' => true]);
}

$f = [
    'first_name' => clean($_POST['first_name'] ?? '', 80),
    'last_name' => clean($_POST['last_name'] ?? '', 80),
    'email' => mb_strtolower(clean($_POST['email'] ?? '', 190)),
    'phone' => clean($_POST['phone'] ?? '', 32),
    'country' => clean($_POST['country'] ?? '', 80),
    'tier_interest' => clean($_POST['tier_interest'] ?? '', 20),
    'source' => clean($_POST['source'] ?? '', 120),
    'message' => clean($_POST['message'] ?? '', 1000),
    'marketing_opt_in' => isset($_POST['marketing']) ? 1 : 0,
];
$consent = isset($_POST['consent']);

$errors = [];
if ($f['first_name'] === '') $errors['first_name'] = 'Please enter your first name.';
if ($f['last_name'] === '') $errors['last_name'] = 'Please enter your last name.';
if (!filter_var($f['email'], FILTER_VALIDATE_EMAIL)) $errors['email'] = 'Please enter a valid email address.';
$digits = preg_replace('/[^\d]/', '', $f['phone']);
if (!preg_match('/^\+?[\d\s().-]{7,32}$/', $f['phone']) || strlen((string) $digits) < 7) $errors['phone'] = 'Please enter your mobile number, including the country code.';
if ($f['country'] === '') $errors['country'] = 'Please enter your country of residence.';
if (!in_array($f['tier_interest'], TIERS, true)) $errors['tier_interest'] = 'Please choose a membership.';
if (!$consent) $errors['consent'] = 'Please agree so we can contact you about your pre-registration.';
if ($errors) reply(422, ['ok' => false, 'error' => 'Please check the highlighted fields.', 'fields' => $errors]);

try {
    $pdo = db();
    $ip = ip_hash();
    $limit = (int) (config()['rate_limit_per_hour'] ?? 5);
    $pdo->prepare('DELETE FROM rate_limits WHERE created_at < ?')->execute([time() - 3600]);
    $count = $pdo->prepare('SELECT COUNT(*) FROM rate_limits WHERE ip_hash = ?');
    $count->execute([$ip]);
    if ((int) $count->fetchColumn() >= $limit) {
        reply(429, ['ok' => false, 'error' => 'Too many attempts from this connection. Please try again in an hour.']);
    }
    $pdo->prepare('INSERT INTO rate_limits (ip_hash, created_at) VALUES (?, ?)')->execute([$ip, time()]);

    $existing = $pdo->prepare('SELECT id FROM registrations WHERE email = ?');
    $existing->execute([$f['email']]);
    $id = $existing->fetchColumn();
    $ua = mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255);
    if ($id) {
        $pdo->prepare('UPDATE registrations SET updated_at=?, first_name=?, last_name=?, phone=?, country=?, tier_interest=?, source=?, message=?, marketing_opt_in=?, consent_at=?, ip_hash=?, user_agent=? WHERE id=?')
            ->execute([now(), $f['first_name'], $f['last_name'], $f['phone'], $f['country'], $f['tier_interest'], $f['source'], $f['message'], $f['marketing_opt_in'], now(), $ip, $ua, $id]);
    } else {
        $pdo->prepare('INSERT INTO registrations (created_at, updated_at, first_name, last_name, email, phone, country, tier_interest, source, message, marketing_opt_in, consent_at, ip_hash, user_agent) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
            ->execute([now(), now(), $f['first_name'], $f['last_name'], $f['email'], $f['phone'], $f['country'], $f['tier_interest'], $f['source'], $f['message'], $f['marketing_opt_in'], now(), $ip, $ua]);
    }
} catch (Throwable $e) {
    error_log('[joia-preregister] ' . $e->getMessage());
    reply(500, ['ok' => false, 'error' => 'Something went wrong on our side. Please try again in a moment.']);
}

// Emails are best-effort: the registration is already saved.
$c = config();
if (!empty($c['notify_email'])) {
    send_mail($c['notify_email'], ($id ? 'Updated' : 'New') . " pre-registration: {$f['first_name']} {$f['last_name']}",
        "Name: {$f['first_name']} {$f['last_name']}\nEmail: {$f['email']}\nMobile: {$f['phone']}\nCountry: {$f['country']}\n" .
        "Membership interest: {$f['tier_interest']}\nHeard about us: {$f['source']}\nMarketing emails: " . ($f['marketing_opt_in'] ? 'yes' : 'no') .
        "\n\nMessage:\n{$f['message']}\n");
}
if (!empty($c['send_confirmation'])) {
    send_mail($f['email'], 'Your CLUB JOIA 300 pre-registration',
        "Dear {$f['first_name']},\n\nThank you for pre-registering for CLUB JOIA 300.\n\n" .
        "Membership is limited to 300 members and is by invitation only. Our team will review your pre-registration and contact you personally.\n\n" .
        "CLUB JOIA 300\n");
}

reply(200, ['ok' => true]);

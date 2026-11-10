<?php
declare(strict_types=1);

/** Password-protected list of pre-registrations, with CSV download. */
require dirname(__DIR__) . '/inc/bootstrap.php';
security_headers();
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');

session_name('joia_admin');
session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off', 'httponly' => true, 'samesite' => 'Strict']);
session_start();

$hash = (string) (config()['admin_password_hash'] ?? '');
if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(16));
$csrf = $_SESSION['csrf'];
$error = '';

if (($_POST['action'] ?? '') === 'login') {
    $_SESSION['tries'] = ($_SESSION['tries'] ?? 0) + 1;
    usleep(400000); // slows down password guessing
    if ($_SESSION['tries'] > 8) {
        $error = 'Too many attempts. Close the browser and try again later.';
    } elseif ($hash !== '' && hash_equals($csrf, (string) ($_POST['csrf'] ?? '')) && password_verify((string) ($_POST['password'] ?? ''), $hash)) {
        session_regenerate_id(true);
        $_SESSION = ['admin' => true, 'csrf' => bin2hex(random_bytes(16))];
        header('Location: ./');
        exit;
    } else {
        $error = $hash === '' ? 'The admin password is not set in config.php yet.' : 'Wrong password.';
    }
}
if (($_POST['action'] ?? '') === 'logout' && hash_equals($csrf, (string) ($_POST['csrf'] ?? ''))) {
    $_SESSION = [];
    session_destroy();
    header('Location: ./');
    exit;
}

$authed = !empty($_SESSION['admin']);

if ($authed && ($_GET['export'] ?? '') === 'csv') {
    $rows = db()->query('SELECT created_at, updated_at, first_name, last_name, email, phone, country, tier_interest, source, message, marketing_opt_in FROM registrations ORDER BY created_at')->fetchAll();
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="clubjoia300-preregistrations-' . gmdate('Y-m-d') . '.csv"');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF"); // so Excel opens accented names correctly
    fputcsv($out, ['Registered (UTC)', 'Updated (UTC)', 'First name', 'Last name', 'Email', 'Mobile', 'Country', 'Membership interest', 'Heard about us', 'Message', 'Marketing emails']);
    foreach ($rows as $r) {
        $r['marketing_opt_in'] = $r['marketing_opt_in'] ? 'yes' : 'no';
        // Neutralise spreadsheet formulas in user-entered text.
        fputcsv($out, array_map(fn($v) => preg_match('/^[=+\-@\t\r]/', (string) $v) ? "'" . $v : $v, array_values($r)));
    }
    exit;
}

$rows = $authed ? db()->query('SELECT * FROM registrations ORDER BY created_at DESC')->fetchAll() : [];
$byTier = [];
foreach ($rows as $r) $byTier[$r['tier_interest']] = ($byTier[$r['tier_interest']] ?? 0) + 1;
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Pre-registrations · CLUB JOIA 300</title>
<link rel="icon" href="../assets/img/icon-192.png">
<link rel="stylesheet" href="../assets/admin.css">
</head>
<body>
<header class="bar">
  <img src="../assets/img/logo-white.png" alt="CLUB JOIA 300" width="150">
  <?php if ($authed): ?>
  <form method="post"><input type="hidden" name="csrf" value="<?= h($_SESSION['csrf']) ?>"><button name="action" value="logout">Sign out</button></form>
  <?php endif; ?>
</header>
<main>
<?php if (!$authed): ?>
  <form method="post" class="login">
    <h1>Pre-registrations</h1>
    <?php if ($error): ?><p class="error" role="alert"><?= h($error) ?></p><?php endif; ?>
    <label for="password">Admin password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
    <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
    <button name="action" value="login">Sign in</button>
  </form>
<?php else: ?>
  <div class="head">
    <div>
      <h1>Pre-registrations</h1>
      <p class="muted"><?= count($rows) ?> in total<?php foreach (TIERS as $t) if (!empty($byTier[$t])) echo ' · ' . h($t) . ': ' . $byTier[$t]; ?></p>
    </div>
    <a class="button" href="?export=csv">Download CSV</a>
  </div>
  <?php if (!$rows): ?>
    <p class="empty">No pre-registrations yet.</p>
  <?php else: ?>
  <div class="table">
  <table>
    <thead><tr><th>Registered</th><th>Name</th><th>Email</th><th>Mobile</th><th>Country</th><th>Interest</th><th>Heard about us</th><th>Message</th><th>Marketing</th></tr></thead>
    <tbody>
    <?php foreach ($rows as $r): ?>
      <tr>
        <td class="nowrap"><?= h(substr($r['created_at'], 0, 16)) ?> UTC</td>
        <td><?= h($r['first_name'] . ' ' . $r['last_name']) ?></td>
        <td><a href="mailto:<?= h($r['email']) ?>"><?= h($r['email']) ?></a></td>
        <td class="nowrap"><?= h($r['phone']) ?></td>
        <td><?= h($r['country']) ?></td>
        <td><?= h($r['tier_interest']) ?></td>
        <td><?= h($r['source']) ?></td>
        <td class="msg"><?= nl2br(h($r['message'])) ?></td>
        <td><?= $r['marketing_opt_in'] ? 'Yes' : 'No' ?></td>
      </tr>
    <?php endforeach; ?>
    </tbody>
  </table>
  </div>
  <?php endif; ?>
<?php endif; ?>
</main>
</body>
</html>

<?php
/**
 * CLUB JOIA 300 pre-registration — settings.
 * Copy this file to config.php and fill it in. config.php is never served to visitors (.htaccess).
 */
return [
    // Database. On GoDaddy cPanel: create it under "MySQL® Database Wizard", then fill in below.
    // The registrations table is created automatically on the first registration.
    'db' => [
        'driver'   => 'mysql',              // 'mysql' (hosting) or 'sqlite' (local testing only)
        'host'     => 'localhost',
        'name'     => 'cpaneluser_joia',
        'user'     => 'cpaneluser_joia',
        'password' => 'CHANGE_ME',
        'sqlite_path' => __DIR__ . '/data/registrations.sqlite',
    ],

    // Team inbox that is told about every new pre-registration (leave '' to switch off).
    'notify_email' => '',
    // Sender address for emails. Use an address on your own domain, e.g. no-reply@clubjoia300.com.
    'mail_from' => 'CLUB JOIA 300 <no-reply@your-domain.example>',
    // Send a short "we received your pre-registration" email to the guest.
    'send_confirmation' => true,

    // Admin page (/admin/): list and download registrations.
    // Generate the hash on any computer with PHP:  php -r "echo password_hash('your-password', PASSWORD_DEFAULT);"
    'admin_password_hash' => '',

    // Random secret (32+ characters) used to anonymise IP addresses for spam protection.
    // Generate: php -r "echo bin2hex(random_bytes(32));"
    'secret' => '',

    // Maximum registrations from one connection per hour (spam protection).
    'rate_limit_per_hour' => 5,
];

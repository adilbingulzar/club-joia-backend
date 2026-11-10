# CLUB JOIA 300 pre-registration page

A branded landing page with a pre-registration form. Registrations are saved in a MySQL database, and a private admin page lets you list them and download them as a spreadsheet (CSV). It runs on standard **GoDaddy cPanel hosting** (PHP + MySQL). Nothing else is needed.

| Part | Address once online |
|---|---|
| Landing page | `https://your-domain/` (or a sub-folder, e.g. `/register/`) |
| Admin (registrations + CSV download) | `https://your-domain/admin/` |
| Privacy notice | `https://your-domain/privacy.html` |

## Before going live: things only you can fill in

1. **Privacy notice** (`privacy.html`): replace the four red highlighted placeholders: company name and address, privacy contact email, and retention period. Have it checked by whoever handles legal for CLUB JOIA 300.
2. **Settings** (`config.php`, step 3 below): database details, admin password, and the team email for notifications.

## Installing on GoDaddy (cPanel)

1. **Create the database.** cPanel → **MySQL® Database Wizard**:
   - create a database, e.g. `joia`;
   - create a user with a strong password;
   - give that user **All Privileges** on the database.

   Note the full names cPanel shows; they include a prefix, e.g. `abc123_joia`.
2. **Upload.** cPanel → **File Manager** → `public_html`, or a sub-folder such as `public_html/register`:
   - upload `CJ300_PreRegistration.zip`;
   - right-click it → **Extract**;
   - delete the zip afterwards.
3. **Settings.** In File Manager, copy `config.sample.php` to `config.php`, then right-click → **Edit**:
   - `db`: the database name, user and password from step 1. Leave `host` as `localhost`.
   - `secret`: a random string of 32+ characters. Any long random text works, e.g. from a password manager.
   - `admin_password_hash`: the admin password, stored as a hash. To make one, choose a password and run this command on any computer with PHP, then paste the result:
     ```bash
     php -r "echo password_hash('your-admin-password', PASSWORD_DEFAULT);"
     ```
     Or ask me to generate it.
   - `notify_email`: the team inbox that should be told about each new registration.
   - `mail_from`: a sender address on your own domain, e.g. `no-reply@your-domain`.
4. **HTTPS.** Make sure the domain has SSL switched on: cPanel → **SSL/TLS Status**, where GoDaddy offers a free certificate. The page redirects to `https://` automatically.
5. **Test.** Open the page, submit a test registration, then sign in at `/admin/` to see it.

The database table is created automatically on the first registration.

## Good to know

- **Repeat registrations:** if someone registers again with the same email, their entry is updated instead of duplicated.
- **Spam protection:**
  - a hidden field that bots fill in;
  - a minimum time to fill in the form;
  - only accepting submissions from this site;
  - at most 5 submissions per hour from one connection.
- **Privacy:** IP addresses are never stored, only an anonymised code. The fonts are hosted on the site itself, so visitors aren't sent to Google.
- **Emails:** sent through the hosting's own mail service. If notifications land in spam, set up the domain's SPF/DKIM records in cPanel → **Email Deliverability**.
- **Spreadsheet safety:** in the CSV, entries starting with `=`, `+`, `-` or `@` get a leading `'` so a spreadsheet can't run them as formulas. Phone numbers therefore show as `'+971…`.
- **Changing images or text:** images are in `assets/img/` and all page text is in `index.html`.

## Local testing (developers)

```bash
cp config.sample.php config.php   # set 'driver' => 'sqlite', a secret and an admin hash
php -S 127.0.0.1:8310
```

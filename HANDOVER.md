# CLUB JOIA 300: source code handover

Snapshot of the full project as of the date in the zip name. Installed packages (`node_modules`), build output, local databases, uploaded files and all `.env` secret files are **not** included. Each part has a `.env.example` or `config.sample.php` to start from.

## What's in this folder

| Folder | What it is | Stack |
|---|---|---|
| `/` (root) | **Member app + admin + scanner**, the main application (dark theme) | Next.js 16, React 19, Tailwind 4, Prisma 7, PostgreSQL |
| `JOIA_white /` | The **same application in a white theme**: a full, independent copy, with a release script for a self-contained Node server (`npm run release`) and server templates in `deploy/`. Note the trailing space in the folder name. | Same as above |
| `landing/` | **Pre-registration landing page** with an admin list and CSV export, made for GoDaddy cPanel hosting | PHP 8 + MySQL |
| `carousel/` | Instagram-style **6-slide carousel**: images and videos in `footage/` | Static HTML/JS |

The two app folders share the same code except the theme (colours, logo variants and a few components). A change to one usually needs making in the other too. Merging them into one codebase with a theme switch is a sensible first job.

## Where to start

- **Main app:** read `README.md`, then `docs/ARCHITECTURE.md`.
  - Local setup: `npm install`, `npm run db:start` (embedded PostgreSQL, no Docker needed), `npm run db:migrate`, `npm run db:seed`, `npm run dev`.
  - Tests: `npm test` (unit + integration) and `npm run test:e2e` (Playwright).
- **White app:** the same steps inside `JOIA_white /`; it runs on port 3001. For deployment, see `JOIA_white /deploy/README-DEPLOY.md`.
- **Landing page:** `landing/README.md`.
- **Carousel:** `carousel/README.md`.

## Important notes

- **Development passwords:** the seed creates demo accounts with publicly known development passwords. They're listed in `README.md`. Never seed a production database with them.
- **Hosting:** the client's current hosting is GoDaddy cPanel shared hosting, which only runs PHP/MySQL. The landing page and carousel fit it; the Next.js apps need a Node.js host (e.g. Vercel, Railway, Render or a VPS) plus PostgreSQL.
- **Open before launch:**
  - the email/WhatsApp providers;
  - legal texts;
  - the placeholders in `landing/privacy.html`;
  - multi-factor sign-in (MFA) for staff;
  - the final event programme;
  - the final app icon.

  The full list is in `README.md` under "Remaining production items".
- **Version control:** the project is a git repository with only the initial scaffold committed. Everything since is uncommitted, so please commit this snapshot as your starting point.

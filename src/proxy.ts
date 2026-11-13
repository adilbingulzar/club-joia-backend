import { NextResponse, type NextRequest } from "next/server";
import { allowlistVerdict } from "@/lib/security/ip-allowlist";
import { contentSecurityPolicy, newNonce } from "@/lib/security/csp";

/**
 * Optimistic route guard: requests to private pages without a session cookie are sent to
 * /login before rendering. This is only a UX shortcut — the real authorisation happens
 * server-side in the data access layer and in every service call.
 */
const PUBLIC_PATHS = ["/login", "/admin/login", "/activate", "/forgot-password", "/reset-password", "/offline", "/legal"];

// Paths the sign-in redirect looks at: not API routes (they authorise themselves), Next internals
// or static/public files.
const GUARDED = /^\/((?!api|_next\/static|_next\/image|brand|icons|sw.js|manifest.webmanifest|robots.txt|favicon.ico).*)$/;

/**
 * Runs for every request (no matcher). Every answer gets a Content-Security-Policy with a fresh
 * nonce (src/lib/security/csp.ts), also passed on in the request headers, where Next.js finds it for
 * its own scripts. /api/files/* sets its own, stricter policy. Then the IP allowlist (IP_ALLOWLIST, see
 * src/lib/security/ip-allowlist.ts): when set, any other address gets 403 for everything, files and
 * APIs included. Then the optimistic sign-in redirect below.
 */
export function proxy(request: NextRequest) {
  const nonce = newNonce();
  const policy = contentSecurityPolicy(nonce);
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const res = answer(request, { request: { headers } });
  if (!request.nextUrl.pathname.startsWith("/api/files/")) res.headers.set("Content-Security-Policy", policy);
  return res;
}

/** What the request gets; `pass` = the request headers with the nonce, for the page that renders. */
function answer(request: NextRequest, pass: { request: { headers: Headers } }): NextResponse {
  if (allowlistVerdict(request.headers) === false) {
    return new NextResponse("Access denied.", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
  const { pathname, search } = request.nextUrl;
  if (!GUARDED.test(pathname)) return NextResponse.next(pass);
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next(pass);

  const hasSession = request.cookies.has("joia_session") || request.cookies.has("__Host-joia_session");
  if (!hasSession) {
    const url = request.nextUrl.clone();
    // Staff areas have their own sign-in page.
    url.pathname = pathname.startsWith("/admin") || pathname.startsWith("/staff") ? "/admin/login" : "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next(pass);
}


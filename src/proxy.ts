import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic route guard: requests to private pages without a session cookie are sent to
 * /login before rendering. This is only a UX shortcut — the real authorisation happens
 * server-side in the data access layer and in every service call.
 */
const PUBLIC_PATHS = ["/login", "/admin/login", "/activate", "/forgot-password", "/reset-password", "/offline", "/legal"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();

  const hasSession = request.cookies.has("joia_session") || request.cookies.has("__Host-joia_session");
  if (!hasSession) {
    const url = request.nextUrl.clone();
    // Staff areas have their own sign-in page.
    url.pathname = pathname.startsWith("/admin") || pathname.startsWith("/staff") ? "/admin/login" : "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Skip API routes (they authorise themselves), Next internals, and static/public files.
  matcher: ["/((?!api|_next/static|_next/image|brand|icons|sw.js|manifest.webmanifest|robots.txt|favicon.ico).*)"],
};

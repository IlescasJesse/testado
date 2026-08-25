import { NextRequest, NextResponse } from "next/server";

const rutasPublicas = ["/login", "/api"];

function noCache(res: NextResponse) {
  res.headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
  return res;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) {
    return NextResponse.next();
  }

  if (rutasPublicas.some((r) => pathname === r || pathname.startsWith(r))) {
    return noCache(NextResponse.next());
  }

  const auth = req.cookies.get("testado-auth");
  if (auth?.value === "1") {
    return noCache(NextResponse.next());
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("redirect", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|favicon.ico).*)"],
};

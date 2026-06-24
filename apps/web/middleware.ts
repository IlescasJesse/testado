import { NextRequest, NextResponse } from "next/server";

const rutasPublicas = ["/login", "/api/login"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (rutasPublicas.some((r) => pathname === r || pathname.startsWith(r))) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) {
    return NextResponse.next();
  }

  const auth = req.cookies.get("testado-auth");
  if (auth?.value === "1") {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("redirect", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|favicon.ico).*)"],
};

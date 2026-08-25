import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { password } = (await req.json()) as { password?: string };
    const adminPwd = (process.env["ADMIN_PASSWORD"] ?? "testado2026").trim();

    if (!password || password.trim() !== adminPwd) {
      return NextResponse.json(
        { success: false, message: "Contraseña incorrecta" },
        { status: 401 },
      );
    }

    const res = NextResponse.json({ success: true });
    res.cookies.set("testado-auth", "1", {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8,
    });
    return res;
  } catch {
    return NextResponse.json(
      { success: false, message: "Error interno" },
      { status: 500 },
    );
  }
}

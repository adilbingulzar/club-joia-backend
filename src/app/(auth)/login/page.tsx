import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

// Closed: members sign in on the website (club-joia-300-next /login); staff at /admin/login.
const CLOSED = true;

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  if (CLOSED) redirect("/admin/login");
  return (
    <div className="animate-fade-up">
      <p className="eyebrow text-center">Members</p>
      <h1 className="display mt-3 text-center text-5xl">Welcome back</h1>
      <div className="mt-10">
        <Suspense fallback={<div className="skeleton h-64" aria-hidden />}>
          <LoginFormWithParams searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

async function LoginFormWithParams({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;
  return <LoginForm next={next} resetDone={sp.reset === "1"} />;
}

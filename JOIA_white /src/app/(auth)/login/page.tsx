import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
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

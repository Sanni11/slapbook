"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ALLOWED_EMAILS } from "@/lib/allowed";

export default function LoginPage() {
    const router = useRouter();
    const [email, setEmail] = useState("gsanni11@gmail.com");
    const [password, setPassword] = useState("");
    const [msg, setMsg] = useState("");

    const signIn = async () => {
        setMsg("");
        const e = email.trim().toLowerCase();

        if (!ALLOWED_EMAILS.has(e)) {
            setMsg("This account is not allowed.");
            return;
        }

        const { error } = await supabase.auth.signInWithPassword({
            email: e,
            password,
        });

        if (error) {
            setMsg(error.message);
            return;
        }

        router.push("/");
    };

    return (
        <main className="mx-auto mt-14 w-full max-w-md px-4">
            <h1 className="text-3xl font-extrabold">SlapBook</h1>
            <p className="mt-2 text-sm text-neutral-600">Private login (2 users only)</p>

            <div className="mt-6 space-y-3">
                <input
                    className="w-full rounded-xl border px-3 py-2"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email"
                />
                <input
                    className="w-full rounded-xl border px-3 py-2"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    type="password"
                />
                <button
                    className="w-full rounded-xl bg-black px-3 py-2 font-semibold text-white"
                    onClick={signIn}
                >
                    Sign in
                </button>

                {msg && <p className="text-sm text-red-600">{msg}</p>}
            </div>
        </main>
    );
}

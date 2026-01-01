"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ALLOWED_EMAILS } from "@/lib/allowed";

type Category = "study" | "skill" | "exercise";

type ProfileRow = {
    id: string;
    username: string;
    display_name: string;
    created_at: string;
};

type PostRow = {
    id: string;
    user_id: string;
    content: string;
    created_at: string;
    profiles: { username: string; display_name: string } | null;
};

type ActivityRow = {
    id: string;
    user_id: string;
    category: Category;
    title: string | null;
    minutes: number | null;
    occurred_at: string;
    profiles: { username: string; display_name: string } | null;
};

function startOfWeekMondayLocal(now: Date) {
    const d = new Date(now);
    const day = d.getDay(); // Sun=0..Sat=6
    const diff = (day === 0 ? -6 : 1) - day; // Monday
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

function dateKeyLocal(dt: Date) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

export default function ProfilePage() {
    const router = useRouter();
    const routeParams = useParams<{ username: string }>();
    const searchParams = useSearchParams();

    const tab = (searchParams.get("tab") ?? "posts") as "posts" | "activity";

    const usernameParamRaw = (routeParams?.username ?? "") as string;
    const usernameParam = useMemo(
        () => decodeURIComponent(usernameParamRaw).toLowerCase(),
        [usernameParamRaw]
    );

    const [me, setMe] = useState<{ id: string; email: string } | null>(null);
    const [profile, setProfile] = useState<ProfileRow | null>(null);
    const [posts, setPosts] = useState<PostRow[]>([]);
    const [logs, setLogs] = useState<ActivityRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [msg, setMsg] = useState("");

    const weekStart = useMemo(() => startOfWeekMondayLocal(new Date()), []);
    const weekStartISO = useMemo(() => weekStart.toISOString(), [weekStart]);

    const load = async (uname: string) => {
        setMsg("");
        setLoading(true);

        // auth + whitelist
        const { data: userRes } = await supabase.auth.getUser();
        const user = userRes.user;

        if (!user) {
            router.push("/login");
            return;
        }

        const email = (user.email || "").toLowerCase();
        if (!ALLOWED_EMAILS.has(email)) {
            await supabase.auth.signOut();
            router.push("/login");
            return;
        }

        setMe({ id: user.id, email });

        // profile by username
        const { data: prof, error: profErr } = await supabase
            .from("profiles")
            .select("id, username, display_name, created_at")
            .eq("username", uname)
            .limit(1)
            .maybeSingle();

        if (profErr || !prof) {
            setProfile(null);
            setPosts([]);
            setLogs([]);
            setMsg(profErr?.message || `Profile not found: @${uname}`);
            setLoading(false);
            return;
        }

        setProfile(prof as any);

        // posts for this profile
        const { data: postData, error: postErr } = await supabase
            .from("posts")
            .select("id,user_id,content,created_at,profiles(username,display_name)")
            .eq("user_id", prof.id)
            .order("created_at", { ascending: false })
            .limit(50);

        if (postErr) setMsg(postErr.message);
        setPosts((postData as any) ?? []);

        // activity logs for this profile (for streak + totals + list)
        const since = new Date();
        since.setDate(since.getDate() - 120);

        const { data: logData, error: logErr } = await supabase
            .from("activity_logs")
            .select("id,user_id,category,title,minutes,occurred_at,profiles(username,display_name)")
            .eq("user_id", prof.id)
            .gte("occurred_at", since.toISOString())
            .order("occurred_at", { ascending: false })
            .limit(1000);

        if (logErr) setMsg(logErr.message);
        setLogs((logData as any) ?? []);

        setLoading(false);
    };

    useEffect(() => {
        if (!usernameParam) return;
        load(usernameParam);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [usernameParam]);

    const weeklyTotals = useMemo(() => {
        const totals = { study: 0, skill: 0, exercise: 0, all: 0 };
        for (const l of logs) {
            if (new Date(l.occurred_at).getTime() < new Date(weekStartISO).getTime()) continue;
            const m = typeof l.minutes === "number" ? l.minutes : 0;
            totals[l.category] += m;
            totals.all += m;
        }
        return totals;
    }, [logs, weekStartISO]);

    const streak = useMemo(() => {
        const days = new Set<string>();
        for (const l of logs) days.add(dateKeyLocal(new Date(l.occurred_at)));

        const cursor = new Date();
        cursor.setHours(0, 0, 0, 0);

        // forgiving: if no log today, start from yesterday
        if (!days.has(dateKeyLocal(cursor))) cursor.setDate(cursor.getDate() - 1);

        let s = 0;
        while (days.has(dateKeyLocal(cursor))) {
            s++;
            cursor.setDate(cursor.getDate() - 1);
        }
        return s;
    }, [logs]);

    const deletePost = async (id: string) => {
        setMsg("");
        const { error } = await supabase.from("posts").delete().eq("id", id);
        if (error) setMsg(error.message);
        else await load(usernameParam);
    };

    const deleteLog = async (id: string) => {
        setMsg("");
        const { error } = await supabase.from("activity_logs").delete().eq("id", id);
        if (error) setMsg(error.message);
        else await load(usernameParam);
    };

    return (
        <main className="mx-auto mt-10 w-full max-w-4xl px-4">
            <div className="flex items-center justify-between gap-3">
                <button className="rounded-xl border px-3 py-2" onClick={() => router.back()}>
                    ← Back
                </button>
                <div className="flex gap-2">
                    <button className="rounded-xl border px-3 py-2" onClick={() => router.push("/")}>
                        Feed
                    </button>
                    <button className="rounded-xl border px-3 py-2" onClick={() => router.push("/activity")}>
                        Activity
                    </button>
                </div>
            </div>

            {msg && <p className="mt-3 text-sm text-red-600">{msg}</p>}

            {loading ? (
                <p className="mt-6 text-sm text-neutral-600">Loading…</p>
            ) : !profile ? (
                <p className="mt-6 text-sm text-neutral-600">Profile not found.</p>
            ) : (
                <>
                    {/* Profile header */}
                    <section className="mt-6 rounded-2xl border p-5">
                        <div className="text-2xl font-extrabold">{profile.display_name}</div>
                        <div className="mt-1 text-sm text-neutral-600">@{profile.username}</div>

                        <div className="mt-4 grid gap-3 md:grid-cols-4">
                            <div className="rounded-2xl border p-3">
                                <div className="text-xs text-neutral-600">Study (week)</div>
                                <div className="text-2xl font-extrabold">{weeklyTotals.study}m</div>
                            </div>
                            <div className="rounded-2xl border p-3">
                                <div className="text-xs text-neutral-600">Skill (week)</div>
                                <div className="text-2xl font-extrabold">{weeklyTotals.skill}m</div>
                            </div>
                            <div className="rounded-2xl border p-3">
                                <div className="text-xs text-neutral-600">Exercise (week)</div>
                                <div className="text-2xl font-extrabold">{weeklyTotals.exercise}m</div>
                            </div>
                            <div className="rounded-2xl border p-3">
                                <div className="text-xs text-neutral-600">Streak</div>
                                <div className="text-2xl font-extrabold">{streak} days</div>
                            </div>
                        </div>
                    </section>

                    {/* Tabs */}
                    <div className="mt-4 flex gap-2">
                        <button
                            className={`rounded-xl border px-3 py-2 ${tab === "posts" ? "bg-black text-white" : ""}`}
                            onClick={() => router.push(`/profile/${encodeURIComponent(profile.username)}?tab=posts`)}
                        >
                            Posts
                        </button>
                        <button
                            className={`rounded-xl border px-3 py-2 ${tab === "activity" ? "bg-black text-white" : ""}`}
                            onClick={() => router.push(`/profile/${encodeURIComponent(profile.username)}?tab=activity`)}
                        >
                            Activity
                        </button>
                    </div>

                    {/* Content */}
                    {tab === "posts" ? (
                        <section className="mt-4 space-y-3">
                            {posts.length === 0 ? (
                                <p className="text-sm text-neutral-600">No posts yet.</p>
                            ) : (
                                posts.map((p) => {
                                    const mine = me?.id === p.user_id;
                                    return (
                                        <article key={p.id} className="rounded-2xl border p-4">
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <div className="text-xs text-neutral-500">{new Date(p.created_at).toLocaleString()}</div>
                                                    <div className="mt-2 whitespace-pre-wrap">{p.content}</div>
                                                </div>
                                                {mine && (
                                                    <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => deletePost(p.id)}>
                                                        Delete
                                                    </button>
                                                )}
                                            </div>
                                        </article>
                                    );
                                })
                            )}
                        </section>
                    ) : (
                        <section className="mt-4 space-y-3">
                            {logs.length === 0 ? (
                                <p className="text-sm text-neutral-600">No activity yet.</p>
                            ) : (
                                logs.slice(0, 50).map((l) => {
                                    const mine = me?.id === l.user_id;
                                    return (
                                        <div key={l.id} className="rounded-2xl border p-4">
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <div className="text-xs text-neutral-500">{new Date(l.occurred_at).toLocaleString()}</div>
                                                    <div className="mt-1 text-sm">
                                                        <span className="font-semibold capitalize">{l.category}</span>
                                                        {typeof l.minutes === "number" ? <span> • {l.minutes}m</span> : null}
                                                        {l.title ? <span> • {l.title}</span> : null}
                                                    </div>
                                                </div>
                                                {mine && (
                                                    <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => deleteLog(l.id)}>
                                                        Delete
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </section>
                    )}
                </>
            )}
        </main>
    );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ALLOWED_EMAILS } from "@/lib/allowed";

type Category = "study" | "skill" | "exercise";

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
    const diff = (day === 0 ? -6 : 1) - day; // move to Monday
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

export default function ActivityPage() {
    const router = useRouter();

    const [me, setMe] = useState<{ id: string; email: string } | null>(null);
    const [myUsername, setMyUsername] = useState<string | null>(null);

    const [logs, setLogs] = useState<ActivityRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [msg, setMsg] = useState("");

    // Quick log form
    const [category, setCategory] = useState<Category>("study");
    const [minutes, setMinutes] = useState("30");
    const [title, setTitle] = useState("");
    const [occurredAt, setOccurredAt] = useState(""); // datetime-local

    const weekStart = useMemo(() => startOfWeekMondayLocal(new Date()), []);
    const weekStartISO = useMemo(() => weekStart.toISOString(), [weekStart]);

    const load = async () => {
        setMsg("");
        setLoading(true);

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

        const { data: myProf, error: myProfErr } = await supabase
            .from("profiles")
            .select("username")
            .eq("id", user.id)
            .limit(1)
            .maybeSingle();

        if (myProfErr) console.log("profile lookup error:", myProfErr.message);
        setMyUsername(myProf?.username ?? null);


        // Pull enough history for streaks + dashboard
        const since = new Date();
        since.setDate(since.getDate() - 120);

        const { data, error } = await supabase
            .from("activity_logs")
            .select("id,user_id,category,title,minutes,occurred_at,profiles(username,display_name)")
            .gte("occurred_at", since.toISOString())
            .order("occurred_at", { ascending: false })
            .limit(2000);

        if (error) setMsg(error.message);
        setLogs((data as any) ?? []);
        setLoading(false);
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const weeklyLogs = useMemo(
        () =>
            logs.filter(
                (l) =>
                    new Date(l.occurred_at).getTime() >= new Date(weekStartISO).getTime()
            ),
        [logs, weekStartISO]
    );

    // Totals grouped by user (for this week)
    const totalsByUser = useMemo(() => {
        const map: Record<
            string,
            {
                user_id: string;
                display_name: string;
                username: string;
                study: number;
                skill: number;
                exercise: number;
                all: number;
            }
        > = {};

        for (const l of weeklyLogs) {
            const uid = l.user_id;
            if (!map[uid]) {
                map[uid] = {
                    user_id: uid,
                    display_name: l.profiles?.display_name ?? "Unknown",
                    username: l.profiles?.username ?? "unknown",
                    study: 0,
                    skill: 0,
                    exercise: 0,
                    all: 0,
                };
            }
            const m = typeof l.minutes === "number" ? l.minutes : 0;
            map[uid][l.category] += m;
            map[uid].all += m;
        }

        return Object.values(map);
    }, [weeklyLogs]);

    // Simple grouped-bar chart data
    const chartData = useMemo(() => {
        const users = totalsByUser;
        const byCat = {
            study: {} as Record<string, number>,
            skill: {} as Record<string, number>,
            exercise: {} as Record<string, number>,
        };

        for (const u of users) {
            byCat.study[u.user_id] = u.study;
            byCat.skill[u.user_id] = u.skill;
            byCat.exercise[u.user_id] = u.exercise;
        }

        return { users, byCat };
    }, [totalsByUser]);

    const maxBar = useMemo(() => {
        let max = 1;
        for (const u of chartData.users) {
            max = Math.max(max, u.study, u.skill, u.exercise);
        }
        return max;
    }, [chartData.users]);

    // Streaks per user (shared) — based on viewer local date
    const streakByUser = useMemo(() => {
        const activeDays: Record<string, Set<string>> = {};

        for (const l of logs) {
            if (!activeDays[l.user_id]) activeDays[l.user_id] = new Set();
            const key = dateKeyLocal(new Date(l.occurred_at));
            activeDays[l.user_id].add(key);
        }

        const result: Record<string, number> = {};
        for (const uid of Object.keys(activeDays)) {
            const set = activeDays[uid];
            const cursor = new Date();
            cursor.setHours(0, 0, 0, 0);

            // forgiving streak: if no log today, start from yesterday
            if (!set.has(dateKeyLocal(cursor))) {
                cursor.setDate(cursor.getDate() - 1);
            }

            let streak = 0;
            while (set.has(dateKeyLocal(cursor))) {
                streak++;
                cursor.setDate(cursor.getDate() - 1);
            }
            result[uid] = streak;
        }

        return result;
    }, [logs]);

    const createLog = async () => {
        setMsg("");

        const { data: userRes } = await supabase.auth.getUser();
        const user = userRes.user;
        if (!user) {
            router.push("/login");
            return;
        }

        const m = minutes.trim() === "" ? null : Number(minutes);
        if (m !== null && (!Number.isFinite(m) || m < 0)) {
            setMsg("Minutes must be a non-negative number.");
            return;
        }

        const payload: any = {
            user_id: user.id,
            category,
            title: title.trim() ? title.trim() : null,
            minutes: m,
        };

        if (occurredAt.trim()) {
            const local = new Date(occurredAt); // treated as local time
            if (isNaN(local.getTime())) {
                setMsg("Invalid date/time.");
                return;
            }
            payload.occurred_at = local.toISOString();
        }

        const { error } = await supabase.from("activity_logs").insert(payload);
        if (error) {
            setMsg(error.message);
            return;
        }

        setTitle("");
        setOccurredAt("");
        await load();
    };

    const deleteLog = async (id: string) => {
        setMsg("");
        const { error } = await supabase.from("activity_logs").delete().eq("id", id);
        if (error) setMsg(error.message);
        else await load();
    };

    const signOut = async () => {
        await supabase.auth.signOut();
        router.push("/login");
    };

    return (
        <main className="mx-auto mt-10 w-full max-w-4xl px-4">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h1 className="text-3xl font-extrabold">Activity Dashboard</h1>
                    <p className="mt-1 text-sm text-neutral-600">
                        Week of{" "}
                        <span className="font-semibold text-black">
                            {weekStart.toLocaleDateString()}
                        </span>
                    </p>
                </div>
                <div className="flex gap-2">
                    <button className="rounded-xl border px-3 py-2" onClick={() => router.push("/")}>
                        Feed
                    </button>

                    <button
                        className="rounded-xl border px-3 py-2 disabled:opacity-40"
                        disabled={!myUsername}
                        onClick={() => myUsername && router.push(`/profile/${myUsername}?tab=activity`)}
                        title="Open your profile"
                    >
                        My Profile
                    </button>

                    <button className="rounded-xl border px-3 py-2" onClick={signOut}>
                        Sign out
                    </button>
                </div>
            </div>

            {msg && <p className="mt-3 text-sm text-red-600">{msg}</p>}

            {/* Weekly by user */}
            <section className="mt-6 rounded-2xl border p-4">
                <div className="mb-3 text-lg font-bold">This week — by user</div>

                {totalsByUser.length === 0 ? (
                    <p className="text-sm text-neutral-600">No activity logged this week yet.</p>
                ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                        {totalsByUser.map((u) => (
                            <div key={u.user_id} className="rounded-2xl border p-4">
                                {/* Clickable user card header */}
                                <button
                                    className="text-left hover:underline"
                                    onClick={() => router.push(`/profile/${u.username}?tab=activity`)}
                                >
                                    <div className="font-bold">
                                        {u.display_name}{" "}
                                        <span className="font-normal text-neutral-600">@{u.username}</span>
                                    </div>
                                </button>

                                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                                    <div className="rounded-xl border p-2">
                                        <div className="text-neutral-600">Study</div>
                                        <div className="text-xl font-extrabold">{u.study}m</div>
                                    </div>
                                    <div className="rounded-xl border p-2">
                                        <div className="text-neutral-600">Skill</div>
                                        <div className="text-xl font-extrabold">{u.skill}m</div>
                                    </div>
                                    <div className="rounded-xl border p-2">
                                        <div className="text-neutral-600">Exercise</div>
                                        <div className="text-xl font-extrabold">{u.exercise}m</div>
                                    </div>
                                    <div className="rounded-xl border p-2">
                                        <div className="text-neutral-600">Total</div>
                                        <div className="text-xl font-extrabold">{u.all}m</div>
                                    </div>
                                </div>

                                <div className="mt-3 text-sm text-neutral-600">
                                    Streak:{" "}
                                    <span className="font-semibold text-black">
                                        {streakByUser[u.user_id] ?? 0}
                                    </span>{" "}
                                    days
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* Mini bar chart */}
            <section className="mt-4 rounded-2xl border p-4">
                <div className="mb-3 text-lg font-bold">Weekly chart</div>

                {totalsByUser.length === 0 ? (
                    <p className="text-sm text-neutral-600">Log something to see the chart.</p>
                ) : (
                    <div className="space-y-4">
                        {(["study", "skill", "exercise"] as Category[]).map((cat) => (
                            <div key={cat}>
                                <div className="mb-2 flex items-center justify-between text-sm">
                                    <div className="font-semibold capitalize">{cat}</div>
                                    <div className="text-neutral-600">Max scale: {maxBar}m</div>
                                </div>

                                <div className="space-y-2">
                                    {chartData.users.map((u) => {
                                        const v = (u as any)[cat] as number;
                                        const pct = Math.round((v / maxBar) * 100);
                                        return (
                                            <div key={`${cat}-${u.user_id}`}>
                                                <div className="mb-1 flex justify-between text-xs text-neutral-600">
                                                    <span>{u.display_name}</span>
                                                    <span>{v}m</span>
                                                </div>
                                                <div className="h-3 w-full rounded-full bg-neutral-200">
                                                    <div className="h-3 rounded-full bg-black" style={{ width: `${pct}%` }} />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* Quick log */}
            <section className="mt-4 rounded-2xl border p-4">
                <div className="text-lg font-bold">Quick log</div>

                <div className="mt-3 grid gap-3 md:grid-cols-4">
                    <label className="grid gap-1">
                        <span className="text-xs text-neutral-600">Category</span>
                        <select
                            className="rounded-xl border px-3 py-2"
                            value={category}
                            onChange={(e) => setCategory(e.target.value as Category)}
                        >
                            <option value="study">Study</option>
                            <option value="skill">Skill</option>
                            <option value="exercise">Exercise</option>
                        </select>
                    </label>

                    <label className="grid gap-1">
                        <span className="text-xs text-neutral-600">Minutes</span>
                        <input
                            className="rounded-xl border px-3 py-2"
                            value={minutes}
                            onChange={(e) => setMinutes(e.target.value)}
                            placeholder="e.g. 45"
                        />
                    </label>

                    <label className="grid gap-1 md:col-span-2">
                        <span className="text-xs text-neutral-600">When (optional)</span>
                        <input
                            className="rounded-xl border px-3 py-2"
                            type="datetime-local"
                            value={occurredAt}
                            onChange={(e) => setOccurredAt(e.target.value)}
                        />
                    </label>

                    <label className="grid gap-1 md:col-span-4">
                        <span className="text-xs text-neutral-600">Title / notes (optional)</span>
                        <input
                            className="rounded-xl border px-3 py-2"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="e.g. AI assignment / Guitar scales / Run"
                        />
                    </label>
                </div>

                <button className="mt-3 rounded-xl bg-black px-4 py-2 font-semibold text-white" onClick={createLog}>
                    Add activity
                </button>
            </section>

            {/* Recent shared logs */}
            <section className="mt-4 rounded-2xl border p-4">
                <div className="mb-3 flex items-center justify-between">
                    <div className="text-lg font-bold">Recent activity (shared)</div>
                    <button className="rounded-xl border px-3 py-2 text-sm" onClick={load}>
                        Refresh
                    </button>
                </div>

                {loading ? (
                    <p className="text-sm text-neutral-600">Loading…</p>
                ) : logs.length === 0 ? (
                    <p className="text-sm text-neutral-600">No activity yet.</p>
                ) : (
                    <div className="space-y-3">
                        {logs.slice(0, 50).map((l) => {
                            const mine = me?.id === l.user_id;
                            const username = l.profiles?.username ?? "unknown";

                            return (
                                <div key={l.id} className="rounded-2xl border p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            {/* Clickable name -> profile */}
                                            <button
                                                className="text-left hover:underline"
                                                onClick={() => router.push(`/profile/${username}?tab=activity`)}
                                            >
                                                <div className="font-bold">
                                                    {l.profiles?.display_name ?? "Unknown"}
                                                    <span className="ml-2 font-normal text-neutral-600">
                                                        @{username}
                                                    </span>
                                                </div>
                                            </button>

                                            <div className="mt-1 text-sm">
                                                <span className="font-semibold capitalize">{l.category}</span>
                                                {typeof l.minutes === "number" ? <span> • {l.minutes}m</span> : null}
                                                {l.title ? <span> • {l.title}</span> : null}
                                            </div>
                                        </div>

                                        <div className="text-right text-xs text-neutral-500">
                                            <div>{new Date(l.occurred_at).toLocaleString()}</div>
                                            {mine && (
                                                <button
                                                    className="mt-2 rounded-lg border px-2 py-1 text-xs"
                                                    onClick={() => deleteLog(l.id)}
                                                >
                                                    Delete
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>
        </main>
    );
}

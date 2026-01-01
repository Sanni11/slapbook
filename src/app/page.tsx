"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ALLOWED_EMAILS } from "@/lib/allowed";

type PostRow = {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  profiles: { username: string; display_name: string } | null;
};

export default function FeedPage() {
  const router = useRouter();

  const [me, setMe] = useState<{ id: string; email: string } | null>(null);
  const [myUsername, setMyUsername] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  const remaining = useMemo(() => 280 - text.length, [text]);

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


    // Load feed
    const { data, error } = await supabase
      .from("posts")
      .select("id,user_id,content,created_at,profiles(username,display_name)")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) setMsg(error.message);
    setPosts((data as any) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const createPost = async () => {
    setMsg("");
    const content = text.trim();

    if (!content) {
      setMsg("Write something first.");
      return;
    }
    if (content.length > 280) {
      setMsg("Max 280 characters.");
      return;
    }

    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes.user;
    if (!user) {
      router.push("/login");
      return;
    }

    const { error } = await supabase.from("posts").insert({
      user_id: user.id,
      content,
    });

    if (error) {
      setMsg(error.message);
      return;
    }

    setText("");
    await load();
  };

  const deletePost = async (postId: string) => {
    setMsg("");
    const { error } = await supabase.from("posts").delete().eq("id", postId);
    if (error) setMsg(error.message);
    else await load();
  };

  return (
    <main className="mx-auto mt-10 w-full max-w-2xl px-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold">SlapBook</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Logged in as{" "}
            <span className="font-semibold text-black">{me?.email || "…"}</span>
          </p>
        </div>

        <div className="flex gap-2">
          <button
            className="rounded-xl border px-3 py-2"
            onClick={() => router.push("/activity")}
            title="Go to Activity Dashboard"
          >
            Activity
          </button>

          <button
            className="rounded-xl border px-3 py-2 disabled:opacity-40"
            disabled={!myUsername}
            onClick={() => myUsername && router.push(`/profile/${myUsername}?tab=posts`)}
            title="Open your profile"
          >
            My Profile
          </button>

          <button className="rounded-xl border px-3 py-2" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>

      {/* Composer */}
      <section className="mt-6 rounded-2xl border p-4">
        <textarea
          className="w-full resize-none rounded-xl border p-3 outline-none"
          placeholder="What's happening?"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
        />
        <div className="mt-2 flex items-center justify-between">
          <div className={`text-sm ${remaining < 0 ? "text-red-600" : "text-neutral-600"}`}>
            {remaining} characters left
          </div>
          <button
            className="rounded-xl bg-black px-4 py-2 font-semibold text-white disabled:opacity-40"
            onClick={createPost}
            disabled={text.trim().length === 0 || text.length > 280}
          >
            Post
          </button>
        </div>
        {msg && <p className="mt-2 text-sm text-red-600">{msg}</p>}
      </section>

      {/* Feed */}
      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-bold">Feed</h2>
          <button className="rounded-xl border px-3 py-2 text-sm" onClick={load}>
            Refresh
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-neutral-600">Loading…</p>
        ) : posts.length === 0 ? (
          <p className="text-sm text-neutral-600">No posts yet.</p>
        ) : (
          <div className="space-y-3">
            {posts.map((p) => {
              const mine = me?.id === p.user_id;

              return (
                <article key={p.id} className="rounded-2xl border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      {/* Clickable name -> profile */}
                      <button
                        className="text-left hover:underline"
                        onClick={() => {
                          const u = p.profiles?.username;
                          if (u) router.push(`/profile/${u}?tab=posts`);
                        }}
                      >
                        <div className="font-bold">
                          {p.profiles?.display_name ?? "Unknown"}
                          <span className="ml-2 font-normal text-neutral-600">
                            @{p.profiles?.username ?? "unknown"}
                          </span>
                        </div>
                      </button>

                      <div className="mt-1 whitespace-pre-wrap">{p.content}</div>
                    </div>

                    <div className="text-right text-xs text-neutral-500">
                      <div>{new Date(p.created_at).toLocaleString()}</div>
                      {mine && (
                        <button
                          className="mt-2 rounded-lg border px-2 py-1 text-xs"
                          onClick={() => deletePost(p.id)}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ALLOWED_EMAILS } from "@/lib/allowed";

type PostRow = {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  profiles: { username: string; display_name: string } | null;
};

type CommentRow = {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  created_at: string;
  profiles: { username: string; display_name: string } | null;
};

export default function PostDiscussionPage() {
  const router = useRouter();
  const routeParams = useParams<{ id: string }>();

  const postId = useMemo(() => {
    const raw = (routeParams?.id ?? "") as string;
    return decodeURIComponent(raw);
  }, [routeParams?.id]);

  const [me, setMe] = useState<{ id: string; email: string } | null>(null);
  const [post, setPost] = useState<PostRow | null>(null);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!postId) return;

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

    const { data: postData, error: postErr } = await supabase
      .from("posts")
      .select("id,user_id,content,created_at,profiles(username,display_name)")
      .eq("id", postId)
      .limit(1)
      .maybeSingle();

    if (postErr || !postData) {
      setPost(null);
      setComments([]);
      setMsg(postErr?.message || "Post not found.");
      setLoading(false);
      return;
    }

    setPost(postData as any);

    const { data: cData, error: cErr } = await supabase
      .from("comments")
      .select("id,post_id,user_id,content,created_at,profiles(username,display_name)")
      .eq("post_id", postId)
      .order("created_at", { ascending: true })
      .limit(300);

    if (cErr) setMsg(cErr.message);
    setComments((cData as any) ?? []);

    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  const addComment = async () => {
    setMsg("");
    const content = text.trim();
    if (!content) {
      setMsg("Write a comment first.");
      return;
    }
    if (content.length > 500) {
      setMsg("Max 500 characters.");
      return;
    }

    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes.user;
    if (!user) {
      router.push("/login");
      return;
    }

    const { error } = await supabase.from("comments").insert({
      post_id: postId,
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

  const deleteComment = async (commentId: string) => {
    setMsg("");
    const { error } = await supabase.from("comments").delete().eq("id", commentId);
    if (error) setMsg(error.message);
    else await load();
  };

  return (
    <main className="mx-auto mt-10 w-full max-w-3xl px-4">
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
        <p className="mt-6 text-sm text-neutral-300">Loading…</p>
      ) : !post ? (
        <p className="mt-6 text-sm text-neutral-300">Post not found.</p>
      ) : (
        <>
          {/* Post */}
          <section className="mt-6 rounded-2xl border p-5">
            <button
              className="text-left hover:underline"
              onClick={() => {
                const u = post.profiles?.username;
                if (u) router.push(`/profile/${encodeURIComponent(u)}?tab=posts`);
              }}
            >
              <div className="font-bold">
                {post.profiles?.display_name ?? "Unknown"}
                <span className="ml-2 font-normal text-neutral-300">@{post.profiles?.username ?? "unknown"}</span>
              </div>
            </button>

            <div className="mt-2 whitespace-pre-wrap">{post.content}</div>
            <div className="mt-3 text-xs text-neutral-300">{new Date(post.created_at).toLocaleString()}</div>
          </section>

          {/* Add comment */}
          <section className="mt-4 rounded-2xl border p-4">
            <div className="text-lg font-bold">Discuss</div>
            <textarea
              className="mt-3 w-full resize-none rounded-xl border p-3 outline-none"
              placeholder="Write a comment…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
            />
            <div className="mt-2 flex items-center justify-between">
              <div className={`text-sm ${text.length > 500 ? "text-red-400" : "text-neutral-300"}`}>
                {500 - text.length} left
              </div>
              <button
                className="rounded-xl bg-black px-4 py-2 font-semibold text-white disabled:opacity-40"
                onClick={addComment}
                disabled={text.trim().length === 0 || text.length > 500}
              >
                Comment
              </button>
            </div>
          </section>

          {/* Comments */}
          <section className="mt-4 rounded-2xl border p-4">
            <div className="mb-3 text-lg font-bold">Comments ({comments.length})</div>

            {comments.length === 0 ? (
              <p className="text-sm text-neutral-300">No comments yet.</p>
            ) : (
              <div className="space-y-3">
                {comments.map((c) => {
                  const mine = me?.id === c.user_id;
                  return (
                    <div key={c.id} className="rounded-2xl border p-4">
                      <div className="flex items-start justify-between gap-3">
                        <button
                          className="text-left hover:underline"
                          onClick={() => {
                            const u = c.profiles?.username;
                            if (u) router.push(`/profile/${encodeURIComponent(u)}?tab=activity`);
                          }}
                        >
                          <div className="font-bold">
                            {c.profiles?.display_name ?? "Unknown"}
                            <span className="ml-2 font-normal text-neutral-300">@{c.profiles?.username ?? "unknown"}</span>
                          </div>
                        </button>

                        <div className="text-right text-xs text-neutral-300">
                          <div>{new Date(c.created_at).toLocaleString()}</div>
                          {mine && (
                            <button
                              className="mt-2 rounded-lg border px-2 py-1 text-xs"
                              onClick={() => deleteComment(c.id)}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="mt-2 whitespace-pre-wrap text-sm">{c.content}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

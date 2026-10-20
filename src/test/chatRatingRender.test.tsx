import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Render tests for the chat rating row and the admin summary, against a
// stubbed Supabase client (same chain-stub shape as adminSpend.test).
const g = globalThis as Record<string, unknown>;
// Every submit_chat_rating call, by its RPC params.
const submits: Record<string, unknown>[] = [];

function chain(table: string) {
  const res = () => ({ data: (g.__tables as Record<string, unknown> | undefined)?.[table] ?? [], error: g.__err ?? null });
  const c: Record<string, unknown> = {};
  for (const k of ["select", "order", "gte", "lt", "eq", "not", "in", "limit"]) c[k] = () => c;
  // Direct writes are not a client path any more — fail loudly if used.
  c.insert = c.upsert = () => { throw new Error("direct write to chat_ratings"); };
  c.then = (f: (v: unknown) => unknown) => Promise.resolve(res()).then(f);
  return c;
}
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => chain(t),
    rpc: (name: string, params: Record<string, unknown>) => {
      if (name === "submit_chat_rating") {
        submits.push(params);
        return Promise.resolve({ data: null, error: g.__submitErr ?? null });
      }
      return Promise.resolve({ data: g.__rpc ?? [], error: null });
    },
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  },
}));

import ChatRating from "@/components/ChatRating";
import AdminChatRatings from "@/components/admin/AdminChatRatings";
import AdminChatHistory from "@/components/admin/AdminChatHistory";

afterEach(() => {
  cleanup();
  localStorage.clear();
  submits.length = 0;
  delete g.__submitErr;
  delete g.__tables;
  delete g.__err;
  delete g.__rpc;
});

describe("ChatRating row", () => {
  it("is hidden before 2 real replies and while a reply is in flight", () => {
    const { rerender } = render(<ChatRating sessionId="s1" lang="ge" assistantReplies={1} />);
    expect(screen.queryByTestId("chat-rating")).toBeNull();
    rerender(<ChatRating sessionId="s1" lang="ge" assistantReplies={2} visible={false} />);
    expect(screen.queryByTestId("chat-rating")).toBeNull();
    rerender(<ChatRating sessionId="s1" lang="ge" assistantReplies={2} />);
    expect(screen.getByText("როგორ შეაფასებ ჩატს?")).toBeTruthy();
  });

  it("star → comment → send inserts rating+comment once, then thanks; never again for the session", async () => {
    render(<ChatRating sessionId="s1" lang="ge" assistantReplies={3} page="/chat" />);
    fireEvent.click(screen.getByLabelText("4 ვარსკვლავი"));
    const input = screen.getByPlaceholderText("რა გავაუმჯობესოთ?");
    fireEvent.change(input, { target: { value: "  მეტი ფოტო  " } });
    fireEvent.click(screen.getByText("გაგზავნა"));
    expect(screen.getByText("გმადლობთ!")).toBeTruthy();
    await waitFor(() => expect(submits.length).toBe(1));
    expect(submits[0]).toEqual({ p_session_id: "s1", p_rating: 4, p_comment: "მეტი ფოტო", p_lang: "ge", p_page: "/chat" });
    cleanup();
    render(<ChatRating sessionId="s1" lang="ge" assistantReplies={5} />);
    expect(screen.queryByTestId("chat-rating")).toBeNull();
    expect(submits.length).toBe(1); // unmount after send does not double-insert
  });

  it("skip inserts the rating with no comment", async () => {
    render(<ChatRating sessionId="s2" lang="en" assistantReplies={2} />);
    fireEvent.click(screen.getByLabelText("2 stars"));
    fireEvent.click(screen.getByText("Skip"));
    expect(screen.getByText("Thank you!")).toBeTruthy();
    await waitFor(() => expect(submits.length).toBe(1));
    expect(submits[0]).toMatchObject({ p_session_id: "s2", p_rating: 2, p_comment: null, p_lang: "en", p_page: null });
  });

  it("closing after a tap (unmount) flushes the rating alone", async () => {
    const { unmount } = render(<ChatRating sessionId="s3" lang="ge" assistantReplies={2} />);
    fireEvent.click(screen.getByLabelText("5 ვარსკვლავი"));
    fireEvent.change(screen.getByPlaceholderText("რა გავაუმჯობესოთ?"), { target: { value: "unsent" } });
    unmount();
    await waitFor(() => expect(submits.length).toBe(1));
    expect(submits[0]).toMatchObject({ p_session_id: "s3", p_rating: 5, p_comment: null });
  });

  it("an RPC refusal ('invalid session') is silent: thanks shown, session done", async () => {
    g.__submitErr = { message: "invalid session", code: "P0001" };
    render(<ChatRating sessionId="fake" lang="ge" assistantReplies={2} />);
    fireEvent.click(screen.getByLabelText("3 ვარსკვლავი"));
    fireEvent.click(screen.getByText("გამოტოვება"));
    expect(screen.getByText("გმადლობთ!")).toBeTruthy();
    await waitFor(() => expect(submits.length).toBe(1));
    cleanup();
    render(<ChatRating sessionId="fake" lang="ge" assistantReplies={3} />);
    expect(screen.queryByTestId("chat-rating")).toBeNull();
  });

  it("✕ dismisses for good without inserting", () => {
    render(<ChatRating sessionId="s4" lang="ge" assistantReplies={2} />);
    fireEvent.click(screen.getByLabelText("დახურვა"));
    expect(screen.queryByTestId("chat-rating")).toBeNull();
    cleanup();
    render(<ChatRating sessionId="s4" lang="ge" assistantReplies={4} />);
    expect(screen.queryByTestId("chat-rating")).toBeNull();
    expect(submits.length).toBe(0);
  });
});

describe("AdminChatRatings summary", () => {
  it("renders average, count, distribution and latest comments", async () => {
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const older = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    g.__tables = {
      chat_ratings: [
        { session_id: "a", rating: 5, comment: "ძალიან კარგი", created_at: recent },
        { session_id: "b", rating: 4, comment: null, created_at: recent },
        { session_id: "c", rating: 1, comment: null, created_at: older },
      ],
    };
    render(<AdminChatRatings />);
    await waitFor(() => expect(screen.getByText("4.5")).toBeTruthy());
    expect(screen.getByText(/2 შეფასება · ბოლო 7 დღე/)).toBeTruthy();
    expect(screen.getByTestId("rating-dist-5").textContent).toContain("1");
    expect(screen.getByText("ძალიან კარგი")).toBeTruthy();
    fireEvent.click(screen.getByText("30 დღე"));
    expect(screen.getByText("3.3")).toBeTruthy();
    expect(screen.getByText(/3 შეფასება · ბოლო 30 დღე/)).toBeTruthy();
  });

  it("shows an error instead of crashing when the table is missing", async () => {
    g.__err = { message: "relation \"chat_ratings\" does not exist" };
    render(<AdminChatRatings />);
    await waitFor(() => expect(screen.getByText(/შეფასებები ვერ ჩაიტვირთა/)).toBeTruthy());
  });
});

describe("AdminChatHistory rating badge", () => {
  it("shows a badge only on rated sessions", async () => {
    const at = new Date().toISOString();
    g.__rpc = [
      { session_id: "rated", user_id: null, user_email: null, first_at: at, last_at: at, message_count: 4, last_user_snippet: "გამარჯობა" },
      { session_id: "plain", user_id: null, user_email: null, first_at: at, last_at: at, message_count: 2, last_user_snippet: "ფასი?" },
    ];
    g.__tables = { chat_ratings: [{ session_id: "rated", rating: 5, comment: null, created_at: at }] };
    render(<AdminChatHistory />);
    await waitFor(() => expect(screen.getByTestId("session-rating-rated").textContent).toContain("5★"));
    expect(screen.queryByTestId("session-rating-plain")).toBeNull();
    expect(screen.getByTestId("admin-chat-ratings")).toBeTruthy();
  });
});

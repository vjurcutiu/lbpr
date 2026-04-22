import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatPage from "@/features/chat/ChatPage";

const conversations = [
  {
    id: "session-1",
    title: "First thread",
    tenant_id: "tenant_demo",
    created_at: "2026-04-21T10:00:00.000Z",
    updated_at: "2026-04-21T10:05:00.000Z",
  },
  {
    id: "session-2",
    title: "Loaded later",
    tenant_id: "tenant_demo",
    created_at: "2026-04-21T11:00:00.000Z",
    updated_at: "2026-04-21T11:05:00.000Z",
  },
];

const chatStoreMock = vi.hoisted(() => ({
  appendMessage: vi.fn(),
  createConversation: vi.fn(),
  deleteConversation: vi.fn(),
  ensureConversation: vi.fn(),
  hasCachedMessages: vi.fn((_: string, id: string) => id === "session-1"),
  renameConversation: vi.fn(),
  subscribeConversations: vi.fn(),
  subscribeMessages: vi.fn(),
}));

vi.mock("@/features/auth/AuthProvider", () => ({
  useAuthContext: () => ({
    user: { uid: "user-1" },
    loading: false,
  }),
}));

vi.mock("@/features/chat/chatStore", () => chatStoreMock);

beforeEach(() => {
  vi.useFakeTimers();
  chatStoreMock.subscribeConversations.mockImplementation((_ns: string, cb: (rows: typeof conversations) => void) => {
    cb(conversations);
    return () => undefined;
  });
  chatStoreMock.subscribeMessages.mockImplementation((_ns: string, id: string, cb: (msgs: any[], meta: { source: string; hasCache: boolean }) => void) => {
    if (id === "session-1") {
      cb(
        [
          {
            role: "assistant",
            content: "Cached first thread",
            created_at: "2026-04-21T10:05:00.000Z",
          },
        ],
        { source: "cache", hasCache: true }
      );
      return () => undefined;
    }

    cb([], { source: "cache", hasCache: false });
    setTimeout(() => {
      cb(
        [
          {
            role: "assistant",
            content: "Loaded thread content",
            created_at: "2026-04-21T11:05:00.000Z",
          },
        ],
        { source: "remote", hasCache: true }
      );
    }, 25);
    return () => undefined;
  });
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("ChatPage", () => {
  it("shows a loading transition instead of the empty new-chat state when opening an existing conversation", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ChatPage />);

    expect(await screen.findByText("Cached first thread")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /loading conversation/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /loaded later/i }));

    expect(screen.getByRole("status", { name: /loading conversation/i })).toBeInTheDocument();
    expect(screen.queryByText(/Welcome to LexBot PRO/i)).not.toBeInTheDocument();

    vi.advanceTimersByTime(30);

    await waitFor(() => {
      expect(screen.getByText("Loaded thread content")).toBeInTheDocument();
    });
    expect(screen.queryByRole("status", { name: /loading conversation/i })).not.toBeInTheDocument();
  });
});

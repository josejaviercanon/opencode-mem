import { mock } from "bun:test";

const moduleUrl = (path) => new URL("../../src/" + path + ".js", import.meta.url).href;
const config = {
  injectProfile: true,
  chatMessage: {
    enabled: true,
    injectOn: "first",
    maxMemories: 0,
    excludeCurrentSession: false,
    filterInjectedPrompts: true,
    captureChildSessions: false,
  },
  compaction: { enabled: false },
  autoCaptureEnabled: false,
  webServerEnabled: false,
  autoUpdate: { enabled: false },
  storagePath: process.argv[2],
  opencodeModel: "inherit",
};
const formatCalls = [];
let listLimit = null;

mock.module(moduleUrl("config"), () => ({
  CONFIG: config,
  initConfig() {},
  isConfigured: () => true,
}));
mock.module(moduleUrl("services/client"), () => ({
  memoryClient: {
    warmup: async () => {},
    close: async () => {},
    listMemories: async (_tag, limit) => {
      listLimit = limit;
      return { success: true, memories: [] };
    },
  },
}));
mock.module(moduleUrl("services/tags"), () => ({
  getTags: () => ({
    project: { tag: "fixture-project" },
    user: { userEmail: "fixture-user@example.com" },
  }),
}));
// Record that loadMemoryContext still formats when project memories are empty.
mock.module(moduleUrl("services/context"), () => ({
  formatContextForPrompt: async (userId, projectMemories) => {
    formatCalls.push({
      userId,
      resultCount: projectMemories?.results?.length ?? 0,
    });
    return (
      "<memory_context>\n" +
      `<user_profile>\nprefs for ${userId}\n</user_profile>\n` +
      "</memory_context>"
    );
  },
}));
mock.module(moduleUrl("services/user-prompt/user-prompt-manager"), () => ({
  userPromptManager: {
    savePrompt: async () => {},
    setPromptModel: async () => {},
  },
}));
mock.module(moduleUrl("services/logger"), () => ({
  log() {},
  safeLog() {},
  serializeError: (error) => ({ error: error instanceof Error ? error.message : String(error) }),
}));
mock.module(moduleUrl("services/web-server"), () => ({
  startWebServer: async () => null,
  WebServer: class {},
}));
mock.module(moduleUrl("services/auto-update"), () => ({ startAutoUpdate() {} }));

const { OpenCodeMemPlugin } = await import(moduleUrl("index"));

const client = {
  provider: { list: async () => ({ data: { connected: [] } }) },
  session: {
    get: async ({ path }) => ({ data: { id: path.id, title: "regular task" } }),
    messages: async () => ({ data: [] }),
  },
};

const plugin = await OpenCodeMemPlugin({ directory: "/fixture-project", client });

const loaded = await plugin.memoryContext.load("ses-profile");

const v1Parts = [{ type: "text", text: "hello" }];
await plugin["chat.message"](
  { sessionID: "ses-profile-v1" },
  { message: { id: "msg-1" }, parts: v1Parts }
);

await plugin.dispose();

console.log(
  JSON.stringify({
    listLimit,
    formatCalls,
    loaded,
    v1Parts,
  })
);

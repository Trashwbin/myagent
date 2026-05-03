import { APP_CLIENT_SCRIPT } from "./client.js";

const markdown = await import("./markdown.js");

Object.assign(globalThis, {
  __myAgentMarkdown: {
    renderAssistantMarkdown: markdown.renderAssistantMarkdown,
    unmountAssistantMarkdown: markdown.unmountAssistantMarkdown,
  },
});

new Function(APP_CLIENT_SCRIPT)();

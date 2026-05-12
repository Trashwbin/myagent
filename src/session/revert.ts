import type { Message } from "../model/types.js";
import { restoreCheckpoint } from "../workspace/checkpoint.js";

export type RewindResult = {
  checkpointId: string;
  files: Array<{
    path: string;
    existed: boolean;
  }>;
};

export function findLastCheckpoint(messages: Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "tool_result" && msg.checkpointId) return msg.checkpointId;
  }
  return undefined;
}

export async function rewindSession(
  session: { cwd: string },
  checkpointId: string,
): Promise<RewindResult> {
  const checkpoint = await restoreCheckpoint(session.cwd, checkpointId);
  return {
    checkpointId: checkpoint.id,
    files: checkpoint.files.map((file) => ({
      path: file.path,
      existed: file.existed,
    })),
  };
}

export async function revertLast(session: {
  cwd: string;
  messages: Message[];
}): Promise<RewindResult> {
  const checkpointId = findLastCheckpoint(session.messages);
  if (!checkpointId) {
    throw new Error("No checkpoint found in session transcript");
  }
  return rewindSession(session, checkpointId);
}

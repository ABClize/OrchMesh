import { getToken } from "../../lib/session";
import { api } from "../../lib/api";

export async function createConversation(projectId: string | null = null) {
  const { data, error } = await api.POST("/api/conversations", {
    body: { project_id: projectId },
  });
  if (error || !data) throw new Error("创建对话失败");
  return data;
}

export async function sendPrompt(id: string, text: string) {
  const { error, response } = await api.POST(
    "/api/conversations/{conversation_id}/runs",
    { params: { path: { conversation_id: id } }, body: { text } },
  );
  if (error)
    throw new Error(
      response.status === 409
        ? "已有任务运行，请稍后再试。"
        : "发送失败，请检查连接后重试。",
    );
}

// Keep creation separate from submission so a failed first send can retry in
// the same conversation. No request is retried without another user action.
export function createDraftSender(projectId: string | null = null) {
  let conversation: string | null = null;
  const session = getToken();
  return async (text: string) => {
    if (getToken() !== session) throw new Error("登录状态已改变，请重新登录。");
    conversation ??= (await createConversation(projectId)).id;
    if (getToken() !== session) throw new Error("登录状态已改变，请重新登录。");
    await sendPrompt(conversation, text);
    return conversation;
  };
}

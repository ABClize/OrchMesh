import { getToken, watchSession } from "../../lib/session";
import { api } from "../../lib/api";

const pending = new Map<string, { text: string; id: string }>();
watchSession(() => pending.clear());

export async function createConversation(projectId: string | null = null) {
  const { data, error } = await api.POST("/api/conversations", {
    body: { project_id: projectId, creator: false },
  });
  if (error || !data) throw new Error("创建对话失败");
  return data;
}

export async function sendPrompt(
  id: string,
  text: string,
  reviewTools = false,
) {
  const previous = pending.get(id);
  const requestId = previous?.text === text ? previous.id : crypto.randomUUID();
  pending.set(id, { text, id: requestId });
  const { error, response } = await api.POST(
    "/api/conversations/{conversation_id}/runs",
    {
      params: { path: { conversation_id: id } },
      body: {
        text,
        review_tools: reviewTools,
        request_id: requestId,
      },
    },
  );
  if (!error || response.status < 500) pending.delete(id);
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
  return async (
    text: string,
    reviewTools = false,
    reasoning = "default",
    modelId?: string,
  ) => {
    if (getToken() !== session) throw new Error("登录状态已改变，请重新登录。");
    conversation ??= (await createConversation(projectId)).id;
    if (getToken() !== session) throw new Error("登录状态已改变，请重新登录。");
    const preference = await api.PUT(
      "/api/conversations/{conversation_id}/reasoning",
      {
        params: { path: { conversation_id: conversation } },
        body: { reasoning, ...(modelId ? { model_id: modelId } : {}) },
      },
    );
    if (preference.error) throw new Error("保存思考设置失败，请重试。");
    if (getToken() !== session) throw new Error("登录状态已改变，请重新登录。");
    await sendPrompt(conversation, text, reviewTools);
    return conversation;
  };
}

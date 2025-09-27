import { postJSON } from "@/shared/api";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at?: string;
};

export async function sendMessage(prompt: string, fileIds: string[] = []) {
  // Adjust to your FastAPI route contract
  return postJSON<{ messages: ChatMessage[] }>("/chat", { prompt, file_ids: fileIds });
}

import { create } from "zustand";
import type { Conversation } from "../types";

interface ConversationsState {
  list: Conversation[];
  search: string;
  setSearch: (q: string) => void;
  setList: (list: Conversation[]) => void;
}

const SAMPLE: Conversation[] = [
  {
    id: 1,
    name: "我的旅行",
    avatarPath: null,
    kind: "manual",
    encrypted: false,
    pinned: true,
    archived: false,
    unreadCount: 0,
    preview: "巴黎.jpg",
    previewKind: "image",
    updatedAt: Date.now() - 12 * 60_000,
  },
  {
    id: 2,
    name: "表情包",
    avatarPath: null,
    kind: "manual",
    encrypted: false,
    pinned: false,
    archived: false,
    unreadCount: 0,
    preview: "搞笑视频.mp4",
    previewKind: "video",
    updatedAt: Date.now() - 3 * 86_400_000,
  },
  {
    id: 3,
    name: "Mom 文件夹",
    avatarPath: null,
    kind: "folder_watch",
    encrypted: false,
    pinned: false,
    archived: false,
    unreadCount: 10,
    preview: "10 个新文件",
    previewKind: "text",
    updatedAt: Date.now() - 30 * 60_000,
  },
];

export const useConversationsStore = create<ConversationsState>((set) => ({
  list: SAMPLE,
  search: "",
  setSearch: (q) => set({ search: q }),
  setList: (list) => set({ list }),
}));

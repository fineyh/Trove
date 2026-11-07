/**
 * Dev-only fake backend for looking at the UI in a plain browser:
 *   npm run dev → http://localhost:1420/?mock   (add &locked to see the lock screen)
 *
 * Fakes `window.__TAURI_INTERNALS__` with canned libraries, conversations and
 * messages, and swaps `trove://` image URLs for generated placeholders.
 * Never active in a build (guarded by import.meta.env.DEV).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

if (import.meta.env.DEV && new URLSearchParams(location.search).has("mock")) install();

function install() {
  const q = new URLSearchParams(location.search);
  const now = Date.now();
  const H = 3_600_000;
  const D = 24 * H;

  let appUnlocked = !q.has("locked");
  let uiTheme = "system";
  const uiPrefs: Record<string, string> = {};
  const callbacks = new Map<number, (m: any) => void>();
  const settings: Record<string, string> = { offline_content: "show", map_tiles: "online", idle_lock_minutes: "15" };

  const libraries = [
    { id: "main", name: "我的收藏", icon: null, color: "indigo", isMain: true, encrypted: false, unlocked: true, unlockedBy: "app", hasRecovery: false, keyfilePath: null },
    { id: "trip", name: "旅行", icon: "lucide:plane", color: "teal", isMain: false, encrypted: false, unlocked: true, unlockedBy: "app", hasRecovery: false, keyfilePath: null },
    { id: "vault", name: "私密", icon: null, color: "pink", isMain: false, encrypted: true, unlocked: false, unlockedBy: null, hasRecovery: true, keyfilePath: null },
  ];

  const conv = (id: number, name: string, kind: string, ago: number, count: number, preview: string | null, previewKind: string | null, extra: any = {}) => ({
    id, name, hasAvatar: false, kind, pinned: false, archived: false, createdAt: now - 90 * D, updatedAt: now - ago,
    messageCount: count, preview, previewKind, sourceOffline: false, ...extra,
  });
  const conversations = [
    conv(1, "2024 京都", "folder_watch", 12 * 60_000, 214, "IMG_4021", "image", { pinned: true }),
    conv(2, "猫", "manual", 3 * H, 58, "又在睡觉", "text"),
    conv(3, "截图", "manual", 26 * H, 1320, "Screenshot 2026-11-05", "image"),
    conv(4, "家庭录像", "folder_watch", 4 * D, 87, "VID_0912", "video", { sourceOffline: true }),
    conv(5, "壁纸", "manual", 12 * D, 340, "aurora-4k", "image"),
    conv(6, "设计参考", "manual", 40 * D, 76, "dribbble-shot", "image"),
    conv(7, "文档扫描", "manual", 70 * D, 12, "合同.pdf", "other"),
  ];

  let mid = 1000;
  const img = (w: number, h: number, ago: number, caption: string, status = "ok") => ({
    id: ++mid, convId: 1, caption, playCount: 0, createdAt: now - ago,
    media: { id: mid, kind: "image", width: w, height: h, durationMs: null, sizeBytes: 3_400_000, ext: "jpg", status, hasThumb: true },
  });
  const vid = (ago: number, caption: string, plays = 0) => ({
    id: ++mid, convId: 1, caption, playCount: plays, createdAt: now - ago,
    media: { id: mid, kind: "video", width: 1920, height: 1080, durationMs: 42_000, sizeBytes: 48_000_000, ext: "mp4", status: "ok", hasThumb: true },
  });
  const text = (ago: number, caption: string) => ({ id: ++mid, convId: 1, caption, playCount: 0, createdAt: now - ago, media: null });
  const file = (ago: number, caption: string) => ({
    id: ++mid, convId: 1, caption, playCount: 0, createdAt: now - ago,
    media: { id: mid, kind: "other", width: null, height: null, durationMs: null, sizeBytes: 820_000, ext: "pdf", status: "ok", hasThumb: false },
  });
  const messages = [
    img(4000, 3000, 3 * D + 3 * H, "IMG_3990"),
    img(3000, 4000, 3 * D + 3 * H - 20_000, "IMG_3991"),
    img(4000, 3000, 3 * D + 3 * H - 40_000, "IMG_3992"),
    text(3 * D + 2 * H, "伏见稻荷，早上人还不多"),
    vid(3 * D + H, "VID_3993", 3),
    img(4000, 3000, 2 * D, "IMG_4001", "offline"),
    img(4000, 3000, 2 * D - 60_000, "IMG_4002", "missing"),
    file(D + 2 * H, "行程单.pdf"),
    img(1080, 1920, 50 * 60_000, "IMG_4020"),
    img(4000, 3000, 12 * 60_000, "IMG_4021"),
    text(10 * 60_000, "晚上去鸭川散步，灯笼一路亮到四条"),
  ];

  const volumes = [
    { id: 1, platformId: "C:", label: "系统", lastMount: "C:\\", currentMount: "C:\\", online: true, mediaCount: 1420, brokenCount: 1 },
    { id: 2, platformId: "E:", label: "资料盘", lastMount: "E:\\", currentMount: "E:\\", online: true, mediaCount: 640, brokenCount: 0 },
    { id: 3, platformId: "F:", label: "移动硬盘", lastMount: "F:\\", currentMount: null, online: false, mediaCount: 87, brokenCount: 0 },
  ];

  const handlers: Record<string, (a: any) => any> = {
    security_status: () => ({ appPassword: true, appUnlocked: appUnlocked, appRecovery: true, mainLibrary: "main", legacyPlainCopy: false, legacyProblem: null }),
    app_unlock: () => { appUnlocked = true; },
    app_lock: () => { appUnlocked = false; },
    get_ui_prefs: () => ({ theme: uiTheme, ...uiPrefs }),
    set_ui_pref: (a) => { if (a.key === "theme") uiTheme = a.value; else uiPrefs[a.key] = a.value; },
    get_all_settings: () => settings,
    set_setting: (a) => { settings[a.key] = a.value; },
    list_libraries: () => libraries,
    unlock_library: (a) => { const l = libraries.find((x) => x.id === a.lib || x.id === a.id); if (l) l.unlocked = true; },
    lock_library: (a) => { const l = libraries.find((x) => x.id === a.lib || x.id === a.id); if (l) l.unlocked = false; },
    list_conversations: () => conversations,
    list_messages: (a) => (a.args?.before ? [] : messages.map((m) => ({ ...m, convId: a.args.convId }))),
    list_conv_media: (a) => (a.args?.before ? [] : messages.filter((m) => m.media && m.media.kind !== "other").map((m) => ({ ...m, convId: a.args.convId }))),
    search: () => [],
    list_volumes: () => volumes,
    get_storage_stats: () => ({ dataDir: "C:\\Users\\me\\AppData\\Roaming\\com.trove.app", totalMedia: 2147, totalBytes: 38_600_000_000, byVolume: volumes.map((v) => ({ volumeId: v.id, label: v.label, mediaCount: v.mediaCount, sizeBytes: v.mediaCount * 18_000_000 })) }),
    list_broken_pointers: () => [{ convId: 1, convName: "2024 京都", items: [{ messageId: 1007, mediaId: 1007, kind: "image", hasThumb: true, lastKnownRelpath: "Photos/2024/IMG_4002.jpg", lastKnownVolumeLabel: "系统", detectedAt: now - D, sizeBytes: 3_400_000, messageCreatedAt: now - 2 * D }] }],
    auth_status: () => ({ hasIdentity: false, email: null, displayName: null, pictureUrl: null, vaultUnlocked: true }),
    check_for_update: () => {
      const beta = uiPrefs.update_channel === "beta";
      const checkedAt = Date.now();
      uiPrefs.update_last_check = String(checkedAt);
      return {
        available: true, currentVersion: "0.4.2", latestVersion: beta ? "0.5.0-beta.2" : "0.5.0", date: "2026-11-01",
        notes: "### 新增\n- 新的界面，深浅两套主题\n- 正式版 / 预览版两个更新通道\n### 修复\n- 弹窗文字几乎看不见",
        channel: beta ? "beta" : "stable", checkedAt,
      };
    },
    // Fakes a 24 MB download over ~4 s, then sits in "installing".
    install_update: (a) => {
      const send = callbacks.get(a.onEvent?.id);
      const total = 24_000_000;
      let i = 0;
      let downloaded = 0;
      const t = setInterval(() => {
        downloaded = Math.min(total, downloaded + 1_200_000);
        send?.({ index: i++, message: { event: "progress", downloaded, total } });
        if (downloaded >= total) {
          clearInterval(t);
          send?.({ index: i++, message: { event: "installing" } });
        }
      }, 200);
      return new Promise(() => {});
    },
    app_environment: () => ({ version: "0.4.2", channel: uiPrefs.update_channel ?? "stable", os: "Windows 10.0.26200", arch: "x86_64", webview: "131.0.2903.70" }),
    list_geotagged_media: () => [],
    thumbs_next: () => [],
    thumbs_remaining: () => 0,
    "plugin:event|listen": () => Math.floor(Math.random() * 1e9),
    "plugin:event|unlisten": () => null,
    "plugin:app|version": () => "0.4.2",
    "plugin:window|get_all_windows": () => ["main"],
  };

  let cb = 0;
  (window as any).__TAURI_INTERNALS__ = {
    transformCallback: (fn: (m: any) => void) => {
      callbacks.set(++cb, fn);
      return cb;
    },
    convertFileSrc: (p: string) => p,
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    invoke: async (cmd: string, args: any) => {
      const h = handlers[cmd];
      if (!h) {
        console.warn("[mock] unhandled", cmd, args);
        return null;
      }
      const r = h(args ?? {});
      return r instanceof Promise ? r : structuredClone(r);
    },
  };

  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };

  // trove:// images → generated placeholders (a soft gradient per id).
  const placeholder = (url: string) => {
    const id = Number(url.split("/").pop()) || 1;
    const hue = (id * 47) % 360;
    const w = 400;
    const h = 300;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,72%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},40%,48%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  };
  const fix = (el: Element) => {
    for (const attr of ["src", "poster"]) {
      const v = el.getAttribute(attr);
      if (v && v.startsWith("http://trove.localhost")) {
        if (el instanceof HTMLVideoElement && attr === "src") el.removeAttribute("src");
        else el.setAttribute(attr, placeholder(v));
      }
    }
  };
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes") fix(r.target as Element);
      r.addedNodes.forEach((n) => {
        if (n instanceof Element) {
          fix(n);
          n.querySelectorAll("img, video").forEach(fix);
        }
      });
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "poster"] });
}

export {};

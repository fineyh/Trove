/**
 * Dev-only fake backend for looking at the UI in a plain browser:
 *   npm run dev → http://localhost:1420/?mock   (add &locked to see the lock screen, &bootError[=kind] for a failed start)
 *
 * Fakes `window.__TAURI_INTERNALS__` with canned libraries, conversations and
 * messages, and swaps `trove://` image URLs for generated placeholders.
 * `__mock.addMessage()` in the console appends a message the way the folder
 * watcher would (a `conv:changed` event), to check the list keeps its place.
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
  const views: any[] = [];
  const presence: Record<number, number> = {};
  const settings: Record<string, string> = { offline_content: "show", map_tiles: "online", idle_lock_minutes: "15" };

  const libraries = [
    { id: "main", name: "主空间", icon: null, color: "indigo", isMain: true, encrypted: false, unlocked: true, unlockedBy: "app", hasRecovery: false, keyfilePath: null },
    { id: "trip", name: "旅行", icon: "lucide:plane", color: "teal", isMain: false, encrypted: false, unlocked: true, unlockedBy: "app", hasRecovery: false, keyfilePath: null },
    { id: "vault", name: "私密", icon: null, color: "pink", isMain: false, encrypted: true, unlocked: false, unlockedBy: null, hasRecovery: true, keyfilePath: null },
  ];

  const conv = (id: number, name: string, kind: string, ago: number, count: number, preview: string | null, previewKind: string | null, extra: any = {}) => ({
    id, name, hasAvatar: false, avatarFile: false, kind, pinned: false, archived: false, createdAt: now - 90 * D, updatedAt: now - ago,
    messageCount: count, preview, previewKind, sourceOffline: false, ...extra,
  });
  const conversations = [
    conv(1, "2024 京都", "folder_watch", 12 * 60_000, 214, "IMG_4021", "image", { pinned: true }),
    conv(2, "猫", "manual", 3 * H, 58, "又在睡觉", "text"),
    conv(3, "截图", "manual", 26 * H, 1320, "Screenshot 2026-11-05", "image"),
    conv(4, "家庭录像", "folder_watch", 4 * D, 87, "VID_0912", "video", { sourceOffline: true }),
    conv(5, "壁纸", "manual", 12 * D, 340, "aurora-4k", "image", { hasAvatar: true }),
    conv(6, "设计参考", "manual", 40 * D, 76, "dribbble-shot", "image"),
    conv(7, "文档扫描", "manual", 70 * D, 12, "合同.pdf", "other"),
  ];

  let mid = 1000;
  const img = (w: number, h: number, ago: number, caption: string, status = "ok") => ({
    id: ++mid, convId: 1, caption, playCount: 0, createdAt: now - ago,
    media: { id: mid, kind: "image", width: w, height: h, durationMs: null, sizeBytes: 3_400_000, ext: "jpg", status, hasThumb: true, hasGeo: true, takenAt: now - ago - 400 * D, takenOffset: 540 },
  });
  const vid = (ago: number, caption: string, plays = 0) => ({
    id: ++mid, convId: 1, caption, playCount: plays, createdAt: now - ago,
    media: { id: mid, kind: "video", width: 1920, height: 1080, durationMs: 42_000, sizeBytes: 48_000_000, ext: "mp4", status: "ok", hasThumb: true, hasGeo: true, takenAt: now - ago - 400 * D, takenOffset: 540 },
  });
  const text = (ago: number, caption: string) => ({ id: ++mid, convId: 1, caption, playCount: 0, createdAt: now - ago, media: null });
  const file = (ago: number, caption: string) => ({
    id: ++mid, convId: 1, caption, playCount: 0, createdAt: now - ago,
    media: { id: mid, kind: "other", width: null, height: null, durationMs: null, sizeBytes: 820_000, ext: "pdf", status: "ok", hasThumb: false, hasGeo: false, takenAt: null, takenOffset: null },
  });
  // Speech-like bars: syllables with pauses between phrases.
  const speech = (n: number, k: number) =>
    Array.from({ length: n }, (_, i) => {
      const phrase = Math.sin(i / 7 + k) > -0.6 ? 1 : 0.08;
      return Math.round(255 * phrase * (0.25 + 0.75 * Math.abs(Math.sin(i * 1.7 + k) * Math.cos(i * 0.45))));
    });
  const audio = (ago: number, caption: string, durationMs: number | null, ext = "m4a", peaks: number[] | null = speech(100, 1)) => ({
    id: ++mid, convId: 1, caption, playCount: 0, createdAt: now - ago,
    media: { id: mid, kind: "audio", width: null, height: null, durationMs, sizeBytes: 2_100_000, ext, status: "ok", hasThumb: false, hasGeo: false, takenAt: now - ago, takenOffset: 480, peaks: peaks ?? undefined },
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
    audio(D + H, "寺里的钟声", 47_000, "m4a", speech(100, 3)),
    audio(D + H - 60_000, "导游讲解", 1_512_000),
    audio(D + H - 120_000, "新录音 12", null, "opus", null),
    img(1080, 1920, 50 * 60_000, "IMG_4020"),
    img(4000, 3000, 12 * 60_000, "IMG_4021"),
    text(10 * 60_000, "晚上去鸭川散步，灯笼一路亮到四条"),
  ];

  // Geotagged media per library: a few places, each a scatter of points, so
  // the map has stacks that split as you zoom. Deterministic (seeded).
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const scatter = (firstId: number, places: [number, number, number, number, number][]) => {
    let id = firstId;
    const out: any[] = [];
    for (const [lat, lon, n, spreadKm, daysAgo] of places) {
      for (let i = 0; i < n; i++) {
        const r = (spreadKm / 111) * Math.sqrt(rnd());
        const t = rnd() * Math.PI * 2;
        const roll = rnd();
        out.push({
          mediaId: ++id, lat: lat + r * Math.sin(t), lon: lon + (r * Math.cos(t)) / Math.cos((lat * Math.PI) / 180),
          kind: roll < 0.12 ? "video" : "image", ext: roll < 0.12 ? "mp4" : "jpg",
          status: roll > 0.97 ? "offline" : "ok", hasThumb: roll < 0.99,
          convId: 1, messageId: id, createdAt: now - daysAgo * D - Math.floor(rnd() * 3 * D), takenAt: null, takenOffset: null,
        });
      }
    }
    return out;
  };
  const pin = (m: any, lat: number, lon: number) => ({
    mediaId: m.media.id, lat, lon, kind: m.media.kind, ext: m.media.ext, status: m.media.status,
    hasThumb: true, convId: 1, messageId: m.id, createdAt: m.createdAt,
    takenAt: m.media.takenAt, takenOffset: m.media.takenOffset,
  });
  const geo: Record<string, any[]> = {
    main: [
      // The mock conversation's own photos, so "show on map" has a target.
      ...messages.filter((m) => m.media && m.media.kind !== "other" && m.media.kind !== "audio").map((m, i) => (i < 4 ? pin(m, 34.9671 + i * 0.0004, 135.7727 + i * 0.0003) : pin(m, 35.0037 + i * 0.0006, 135.7722))),
      ...scatter(2000, [
        [34.9671, 135.7727, 38, 0.6, 3], // 伏见稻荷
        [35.0116, 135.7681, 54, 2.5, 2], // 京都市内
        [35.0394, 135.7292, 17, 0.4, 4], // 金阁寺
        [34.6851, 135.8048, 22, 1.2, 5], // 奈良
        [34.6687, 135.5013, 41, 3, 6], // 大阪
        [35.6764, 139.7631, 63, 9, 200], // 东京
        [35.3606, 138.7274, 9, 4, 203], // 富士山
        [30.2431, 120.1503, 72, 3, 420], // 杭州西湖
        [31.2304, 121.4737, 35, 6, 90], // 上海
        [39.9163, 116.3972, 28, 5, 700], // 北京
        [22.2793, 114.1628, 19, 3, 520], // 香港
      ]),
    ],
    trip: scatter(5000, [
      [48.8584, 2.2945, 46, 3, 300], // 巴黎
      [45.764, 4.8357, 12, 2, 296],
      [41.9028, 12.4964, 58, 3, 610], // 罗马
      [43.7696, 11.2558, 24, 1.5, 606], // 佛罗伦萨
      [41.3851, 2.1734, 33, 3, 950], // 巴塞罗那
      [64.1466, -21.9426, 21, 30, 1300], // 冰岛
    ]),
  };

  const volumes = [
    { id: 1, platformId: "C:", label: "系统", lastMount: "C:\\", currentMount: "C:\\", online: true, mediaCount: 1420, brokenCount: 1 },
    { id: 2, platformId: "E:", label: "资料盘", lastMount: "E:\\", currentMount: "E:\\", online: true, mediaCount: 640, brokenCount: 0 },
    { id: 3, platformId: "F:", label: "移动硬盘", lastMount: "F:\\", currentMount: null, online: false, mediaCount: 87, brokenCount: 0 },
  ];

  const handlers: Record<string, (a: any) => any> = {
    boot_error: () =>
      q.has("bootError")
        ? {
            kind: q.get("bootError") || "keyring_damaged",
            detail: "keyring.json 格式无效: expected value at line 1 column 1\nkeyring.json.bak 格式无效: EOF while parsing an object at line 3 column 0",
            dataDir: "C:\\Users\\me\\AppData\\Roaming\\com.trove.app",
          }
        : null,
    security_status: () => ({ appPassword: true, appUnlocked: appUnlocked, appRecovery: true, mainLibrary: "main", legacyPlainCopy: false, legacyProblem: null }),
    app_unlock: () => { appUnlocked = true; },
    app_lock: () => { appUnlocked = false; },
    get_ui_prefs: () => ({ theme: uiTheme, ...uiPrefs }),
    set_ui_pref: (a) => { if (a.key === "theme") uiTheme = a.value; else uiPrefs[a.key] = a.value; },
    get_all_settings: () => settings,
    // Viewing history (ADR-054): kept in __mock.views to look at in the console.
    stats_resume_pos: () => null,
    stats_view_begin: (a) => {
      if (settings.view_stats === "off") return null;
      views.push({ ...a, spans: {} as Record<number, number>, facts: null });
      return views.length;
    },
    stats_view_tick: (a) => {
      const v = views[a.viewId - 1];
      if (!v) return;
      if (a.spanStart != null) v.spans[a.spanStart] = a.spanEnd;
      v.facts = { coveredMs: a.coveredMs, lastPosMs: a.lastPosMs, durationMs: a.durationMs };
    },
    stats_presence_tick: (a) => { presence[a.startAt] = a.endAt; },
    // Statistics page: made-up but stable numbers per bucket (seeded by its start).
    stats_overview: (a) => {
      const edges: number[] = a.edges;
      const n = edges.length - 1;
      const span = edges[1] - edges[0];
      const hash = (x: number) => { let h = (x / 60_000) | 0; h = Math.imul(h ^ (h >>> 15), 2246822519); h = Math.imul(h ^ (h >>> 13), 3266489917); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
      const wallNow = now - new Date().getTimezoneOffset() * 60_000;
      const cleared = views.length === 0 && settings.stats_mock_cleared === "1";
      const per = span <= H ? 40 * 60_000 : span <= D ? 2.5 * H : 40 * H;
      const buckets = Array.from({ length: n }, (_, i) => {
        if (cleared || edges[i] > wallNow) return { totalMs: 0, videoMs: 0, imageMs: 0, audioMs: 0 };
        const hourShape = span <= H ? Math.max(0, Math.sin(((new Date(edges[i]).getUTCHours() - 7) / 24) * Math.PI * 2) + 0.3) : 1;
        const r = hash(edges[i]);
        const total = r < 0.15 && span <= D ? 0 : Math.round(per * Math.max(r, 0.3) * hourShape * (span > 2 * D ? n === 1 ? 3 : 1 : 1));
        const video = Math.round(total * (0.4 + hash(edges[i] + 1) * 0.5));
        return { totalMs: total, videoMs: video, imageMs: Math.round((total - video) * 1.1), audioMs: Math.round(total * 0.15) };
      });
      const totalMs = buckets.reduce((x, b) => x + b.totalMs, 0);
      const shape = Array.from({ length: 24 }, (_, h) => Math.max(0, Math.sin(((h - 7) / 24) * Math.PI * 2) + 0.25) + (h === 21 ? 0.6 : 0));
      const shapeSum = shape.reduce((x, y) => x + y, 0);
      const hours = shape.map((v) => Math.round((v / shapeSum) * totalMs));
      const media = messages.filter((m) => m.media && m.media.kind !== "other" && m.media.kind !== "audio");
      const weights = [0.24, 0.17, 0.12, 0.09, 0.07, 0.05];
      const topItems = totalMs === 0 ? [] : media.slice(0, weights.length).map((m, i) => ({
        messageId: m.id, mediaId: m.media!.id, convId: 1, convName: "2024 京都", kind: m.media!.kind, name: m.caption,
        hasThumb: true, watchMs: Math.round(totalMs * weights[i]), plays: m.media!.kind === "video" ? 6 - i : 3,
      })).sort((x, y) => y.watchMs - x.watchMs);
      const convShare = [0.42, 0.2, 0.14, 0.09, 0.05, 0.03];
      const topConvs = totalMs === 0 ? [] : conversations.slice(0, convShare.length).map((c, i) => ({ convId: c.id, name: c.name, watchMs: Math.round(totalMs * convShare[i]), plays: 20 - i * 4 }));
      const added = Array.from({ length: n }, (_, i) => {
        if (edges[i] > wallNow) return { image: 0, video: 0, audio: 0, other: 0 };
        const r = hash(edges[i] + 7);
        const k = span <= H ? 0.15 : span <= D ? 1 : 12;
        return r < 0.5 ? { image: 0, video: 0, audio: 0, other: 0 } : { image: Math.round(r * 20 * k), video: Math.round(r * 3 * k), audio: r > 0.8 ? 1 : 0, other: r > 0.9 ? 1 : 0 };
      });
      return {
        totalMs, buckets, hours, plays: Math.round(totalMs / 90_000), topItems, topConvs, added,
        itemsBefore: 2000, hasHistory: !cleared,
      };
    },
    // Recap: seeded per day, a few places around Kansai and beyond.
    stats_recap: (a) => {
      const days: number[] = a.days;
      const n = days.length - 1;
      const wallNow = now - new Date().getTimezoneOffset() * 60_000;
      const hash = (x: number) => { let h = (x / 60_000) | 0; h = Math.imul(h ^ (h >>> 15), 2246822519); h = Math.imul(h ^ (h >>> 13), 3266489917); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
      const cover = (id: number) => ({ messageId: id, mediaId: id, convId: 1 + (id % 5), kind: id % 7 === 0 ? "video" : "image" });
      const taken = Array.from({ length: n }, (_, i) => {
        if (days[i] > wallNow) return 0;
        const r = hash(days[i] + 3);
        const trip = i % 97 > 60 && i % 97 < 68;
        return r < 0.45 && !trip ? 0 : Math.round(r * (trip ? 90 : 14));
      });
      const dayCovers = taken.map((k, i) => (k > 0 ? cover(200 + i) : null));
      let busy = -1;
      taken.forEach((k, i) => { if (busy < 0 || k > taken[busy]) busy = i; });
      const withCover = dayCovers.filter(Boolean) as any[];
      const step = Math.max(1, Math.floor(withCover.length / 12));
      const covers = withCover.filter((_, i) => i % step === 0).slice(0, 12);
      const city = [[35.01, 135.76, 412], [34.69, 135.5, 96], [35.68, 139.76, 61], [31.23, 121.47, 28], [34.99, 135.9, 17], [-33.87, 151.21, 9], [43.06, 141.35, 4]];
      const geo = taken.reduce((x, y) => x + y, 0) > 0;
      return {
        taken, dayCovers, covers,
        busiest: busy >= 0 && taken[busy] > 0 ? { day: busy, count: taken[busy], covers: [0, 1, 2, 3, 4, 5].map((j) => cover(600 + busy * 6 + j)) } : null,
        places: geo ? city.map(([lat, lon, count], i) => ({ lat, lon, count, cover: cover(900 + i) })) : [],
        placeCount: geo ? 9 : 0, geoCount: geo ? 627 : 0,
        addedBytes: geo ? 41_800_000_000 * (n / 365) : 0, newConvs: n > 40 ? 6 : 1,
      };
    },
    stats_item_history: (a) => {
      const m = messages.find((x) => x.id === a.messageId);
      if (!m || !m.media) return { totalMs: 0, plays: 0, views: [], viewCount: 0 };
      const list = Array.from({ length: 9 }, (_, i) => ({
        startedAt: now - i * 26 * H - 3 * H, tzOffset: i === 6 ? 540 : -new Date().getTimezoneOffset(),
        watchMs: 5_000 + ((i * 7919) % 11) * 31_000, surface: i % 4 === 1 ? "popup" : i === 6 ? "map" : "viewer", counted: i !== 3,
      }));
      return { totalMs: list.reduce((x, v) => x + v.watchMs, 0), plays: list.filter((v) => v.counted).length, views: list, viewCount: list.length };
    },
    stats_clear: () => {
      settings.stats_mock_cleared = "1"; views.length = 0; for (const k of Object.keys(presence)) delete presence[k as any]; },
    set_setting: (a) => { settings[a.key] = a.value; },
    list_libraries: () => libraries,
    unlock_library: (a) => { const l = libraries.find((x) => x.id === a.lib || x.id === a.id); if (l) l.unlocked = true; },
    lock_library: (a) => { const l = libraries.find((x) => x.id === a.lib || x.id === a.id); if (l) l.unlocked = false; },
    list_conversations: () => conversations,
    update_conversation: (a) => {
      const c = conversations.find((x) => x.id === a.args.id);
      if (!c) return;
      if (a.args.name) c.name = a.args.name;
      if (a.args.pinned != null) c.pinned = a.args.pinned;
      if (a.args.clearAvatar) c.hasAvatar = false;
      else if (a.args.avatarPath) c.hasAvatar = true;
      c.updatedAt = Date.now();
    },
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
    list_geotagged_media: (a) => geo[a.lib] ?? [],
    thumbs_next: () => [],
    thumbs_remaining: () => 0,
    "plugin:event|listen": (a) => {
      const ids = listeners.get(a.event) ?? [];
      listeners.set(a.event, [...ids, a.handler]);
      return a.handler;
    },
    "plugin:event|unlisten": () => null,
    "plugin:app|version": () => "0.4.2",
    "plugin:window|get_all_windows": () => ["main"],
  };

  const listeners = new Map<string, number[]>();
  const emit = (event: string, payload: any) =>
    (listeners.get(event) ?? []).forEach((id) => callbacks.get(id)?.({ event, id, payload }));
  (window as any).__mock = {
    addMessage(convId = 1, caption = `新文件 ${new Date().toLocaleTimeString()}`) {
      messages.push(text(0 - (Date.now() - now), caption));
      emit("conv:changed", { lib: "main", convId, added: 1, broken: 0, renamed: 0 });
    },
    views,
    presence,
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

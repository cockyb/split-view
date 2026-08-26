import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowsClockwise,
  ArrowsOut,
  GearSix,
  GridFour,
  Plus
} from "@phosphor-icons/react";
import { hasChromeRuntime, sendRuntimeMessage } from "../shared/browser-api";
import {
  getSettings,
  getWorkspaceSnapshot,
  saveWorkspaceSnapshot,
  takePendingPayload
} from "../shared/storage";
import type {
  AppSettings,
  Layout,
  RuntimeMessage,
  StreamPreference,
  StreamSource,
  WorkspaceSnapshot
} from "../shared/types";
import { Bezel, BrandMark, IconButton } from "../ui/common";
import { SettingsSheet } from "../ui/settings-sheet";
import { focusAudio } from "./audio";
import { AddDialog } from "./add-dialog";
import { nextLayout, resolveLayout } from "./layout";
import { VideoTile } from "./video-tile";

function preferenceFor(sourceId: string): StreamPreference {
  return { sourceId, volume: 0.8, muted: true };
}

function reorder<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function PlayerApp() {
  const rootRef = useRef<HTMLElement>(null);
  const draggedId = useRef<string | undefined>(undefined);
  const hideTimer = useRef<number | undefined>(undefined);
  const sourcesRef = useRef<StreamSource[]>([]);
  const [ready, setReady] = useState(false);
  const [sources, setSources] = useState<StreamSource[]>([]);
  const [preferences, setPreferences] = useState<StreamPreference[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [layout, setLayout] = useState<Layout>("auto");
  const [aspectRatio, setAspectRatio] = useState(16 / 9);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>();
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>();
  const [toast, setToast] = useState("");

  sourcesRef.current = sources;

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => (current === message ? "" : current)), 4_000);
  }, []);

  useEffect(() => {
    void (async () => {
      const [nextSettings, pending, saved] = await Promise.all([
        getSettings(),
        takePendingPayload(),
        getWorkspaceSnapshot()
      ]);
      setSettings(nextSettings);
      setSnapshot(saved);
      let initialSources = pending?.sources ?? [];
      let initialLayout: Layout = nextSettings.defaultLayout;
      let initialPreferences: StreamPreference[] = initialSources.map((source) => preferenceFor(source.id));
      if (pending?.restore && saved) {
        const byId = new Map(saved.sources.map((source) => [source.id, source]));
        initialSources = saved.order.map((id) => byId.get(id)).filter(Boolean) as StreamSource[];
        initialLayout = saved.layout;
        initialPreferences = initialSources.map(
          (source) => saved.preferences.find((item) => item.sourceId === source.id) ?? preferenceFor(source.id)
        ).map((preference) => ({ ...preference, muted: true }));
      }
      setSources(initialSources);
      setPreferences(initialPreferences);
      setSelectedId(initialSources[0]?.id);
      setLayout(initialLayout);
      setSettingsOpen(Boolean(pending?.openSettings));
      setReady(true);
      await sendRuntimeMessage({ type: "PLAYER_READY" });
    })();
  }, []);

  const addSource = useCallback((source: StreamSource) => {
    const current = sourcesRef.current;
    const duplicate = current.find((item) => item.id === source.id);
    if (duplicate) {
      setSelectedId(duplicate.id);
      showToast("이미 추가한 방송으로 이동했어요");
      return;
    }
    if (current.length >= 4) {
      showToast("플레이어가 가득 찼어요 · 방송은 최대 4개까지 재생할 수 있어요");
      return;
    }
    setSources((items) => [...items, source]);
    setPreferences((items) => [...items, preferenceFor(source.id)]);
    setSelectedId(source.id);
  }, [showToast]);

  useEffect(() => {
    if (!hasChromeRuntime) return;
    const listener = (message: RuntimeMessage) => {
      if (message.type === "PLAYER_ADD_SOURCE") addSource(message.source);
      if (message.type === "PLAYER_OPEN_SETTINGS") setSettingsOpen(true);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [addSource]);

  useEffect(() => {
    if (!ready) return;
    void sendRuntimeMessage({ type: "PLAYER_STATE", count: sources.length });
    if (!settings?.saveWorkspace) return;
    const timer = window.setTimeout(() => {
      const next: WorkspaceSnapshot = {
        version: 1,
        sources,
        order: sources.map((source) => source.id),
        layout,
        preferences,
        savedAt: Date.now()
      };
      void saveWorkspaceSnapshot(next);
      setSnapshot(next);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [layout, preferences, ready, settings?.saveWorkspace, sources]);

  useEffect(() => {
    const closing = () => {
      void sendRuntimeMessage({ type: "PLAYER_CLOSING" });
    };
    window.addEventListener("beforeunload", closing);
    return () => window.removeEventListener("beforeunload", closing);
  }, []);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (height > 0) setAspectRatio(width / height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      const active = document.activeElement;
      const isControlFocused = active instanceof HTMLElement && Boolean(active.closest("button, input, select, details"));
      if (!isControlFocused) setControlsVisible(false);
    }, settings?.controlsTimeoutMs ?? 1800);
  }, [settings?.controlsTimeoutMs]);

  useEffect(() => {
    revealControls();
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [revealControls]);

  const selectSource = useCallback((sourceId: string) => {
    setSelectedId(sourceId);
    setPreferences((items) => focusAudio(items, sourceId));
    const video = document.querySelector<HTMLVideoElement>(`video[data-stream-video="${CSS.escape(sourceId)}"]`);
    if (video?.paused) void video.play();
  }, []);

  const updatePreference = useCallback((preference: StreamPreference) => {
    setPreferences((items) => {
      if (!preference.muted) return focusAudio(items.map((item) => item.sourceId === preference.sourceId ? preference : item), preference.sourceId);
      return items.map((item) => item.sourceId === preference.sourceId ? preference : item);
    });
  }, []);

  const removeSource = useCallback((sourceId: string) => {
    setSources((items) => items.filter((source) => source.id !== sourceId));
    setPreferences((items) => items.filter((preference) => preference.sourceId !== sourceId));
    setSelectedId((current) => {
      if (current !== sourceId) return current;
      const remaining = sourcesRef.current.filter((source) => source.id !== sourceId);
      return remaining[0]?.id;
    });
  }, []);

  const moveSelected = useCallback((delta: number) => {
    if (!selectedId) return;
    setSources((items) => {
      const from = items.findIndex((item) => item.id === selectedId);
      const to = Math.max(0, Math.min(items.length - 1, from + delta));
      return from < 0 || from === to ? items : reorder(items, from, to);
    });
  }, [selectedId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isInput = target?.matches("input, textarea, select, [contenteditable=true]");
      if (isInput && event.key !== "Escape" && event.key !== "Enter") return;
      revealControls();

      if (event.key === "Escape") {
        if (settingsOpen) setSettingsOpen(false);
        else if (addOpen) setAddOpen(false);
        return;
      }
      if (isInput) return;
      if (/^[1-4]$/.test(event.key)) {
        const source = sourcesRef.current[Number(event.key) - 1];
        if (source) selectSource(source.id);
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        const currentId = selectedId ?? sourcesRef.current[0]?.id;
        if (!currentId) return;
        const preference = preferences.find((item) => item.sourceId === currentId);
        if (preference?.muted) {
          selectSource(currentId);
          return;
        }
        const video = document.querySelector<HTMLVideoElement>(`video[data-stream-video="${CSS.escape(currentId)}"]`);
        if (video?.paused) void video.play();
        else video?.pause();
        return;
      }
      if (event.key.toLowerCase() === "m" && selectedId) {
        const preference = preferences.find((item) => item.sourceId === selectedId);
        if (preference) updatePreference({ ...preference, muted: !preference.muted });
        return;
      }
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        if (event.shiftKey) void document.documentElement.requestFullscreen();
        else if (selectedId) {
          void document.querySelector<HTMLElement>(`.video-tile[data-source-id="${CSS.escape(selectedId)}"]`)?.requestFullscreen();
        }
        return;
      }
      if (event.key.toLowerCase() === "l") setLayout((current) => nextLayout(current, sourcesRef.current.length));
      if (event.key.toLowerCase() === "a" || event.key === "+" || event.key === "=") setAddOpen(true);
      if (event.key === "[") moveSelected(-1);
      if (event.key === "]") moveSelected(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addOpen, moveSelected, preferences, revealControls, selectSource, selectedId, settingsOpen, updatePreference]);

  const resolvedLayout = resolveLayout(layout, sources.length, aspectRatio);
  const selectedIndex = Math.max(0, sources.findIndex((source) => source.id === selectedId));
  const restoreSaved = () => {
    if (!snapshot) return;
    const byId = new Map(snapshot.sources.map((source) => [source.id, source]));
    const restored = snapshot.order.map((id) => byId.get(id)).filter(Boolean) as StreamSource[];
    setSources(restored);
    setPreferences(restored.map((source) => ({
      ...(snapshot.preferences.find((item) => item.sourceId === source.id) ?? preferenceFor(source.id)),
      muted: true
    })));
    setSelectedId(restored[0]?.id);
    setLayout(snapshot.layout);
  };

  if (!ready || !settings) return <div className="player-boot" aria-label="Split View 시작 중"><BrandMark /></div>;

  return (
    <main
      ref={rootRef}
      className={`player-shell ${controlsVisible ? "ui-visible" : "ui-hidden"}`}
      onPointerMove={revealControls}
      onFocusCapture={revealControls}
    >
      {sources.length === 0 ? (
        <div className="empty-player">
          <Bezel className="empty-panel" coreClassName="empty-panel__core">
            <BrandMark />
            <p>방송 링크를 추가해 시작하세요</p>
            <button type="button" className="empty-add" onClick={() => setAddOpen(true)}>
              <Plus size={18} weight="light" /> 방송 링크 추가
            </button>
            {snapshot && snapshot.sources.length > 0 && (
              <button type="button" className="empty-restore" onClick={restoreSaved}>
                <ArrowsClockwise size={16} weight="light" /> 지난 구성 복원 · {snapshot.sources.length}개
              </button>
            )}
            <small>MULTI STREAM PLAYER</small>
          </Bezel>
        </div>
      ) : (
        <section className="video-grid" data-layout={resolvedLayout} aria-label="라이브 방송 그리드">
          {sources.map((source) => {
            const preference = preferences.find((item) => item.sourceId === source.id) ?? preferenceFor(source.id);
            const backgroundCap = sources.length >= 3 && source.id !== selectedId ? 720 : undefined;
            const maxQualityHeight = Math.min(
              settings.maxQualityHeight ?? Number.POSITIVE_INFINITY,
              backgroundCap ?? Number.POSITIVE_INFINITY
            );
            return (
              <VideoTile
                key={source.id}
                source={source}
                preference={preference}
                selected={source.id === selectedId}
                controlsVisible={controlsVisible}
                maxQualityHeight={Number.isFinite(maxQualityHeight) ? maxQualityHeight : undefined}
                onSelect={selectSource}
                onPreference={updatePreference}
                onRemove={removeSource}
                onToast={showToast}
                onDragStart={(id) => { draggedId.current = id; }}
                onDrop={(targetId) => {
                  const sourceId = draggedId.current;
                  if (!sourceId || sourceId === targetId) return;
                  setSources((items) => reorder(items, items.findIndex((item) => item.id === sourceId), items.findIndex((item) => item.id === targetId)));
                  draggedId.current = undefined;
                }}
              />
            );
          })}
          {sources.length === 3 && (
            <button type="button" className="quiet-add-slot" onClick={() => setAddOpen(true)}>
              <Plus size={22} weight="light" />
              <span>방송 추가</span>
            </button>
          )}
        </section>
      )}

      {sources.length > 0 && (
        <Bezel className="global-island" coreClassName="global-island__core" aria-hidden={!controlsVisible}>
          <IconButton label="방송 추가" onClick={() => setAddOpen(true)} disabled={sources.length >= 4}>
            <Plus size={19} weight="light" />
          </IconButton>
          <IconButton label="레이아웃 변경" onClick={() => setLayout((current) => nextLayout(current, sources.length))}>
            <GridFour size={19} weight="light" />
          </IconButton>
          <span className="selection-count" aria-label={`선택 타일 ${selectedIndex + 1}, 전체 ${sources.length}`}>
            {selectedIndex + 1} <i /> {sources.length}
          </span>
          <IconButton label="플레이어 전체화면" onClick={() => void document.documentElement.requestFullscreen()}>
            <ArrowsOut size={19} weight="light" />
          </IconButton>
          <IconButton label="설정" onClick={() => setSettingsOpen(true)}>
            <GearSix size={19} weight="light" />
          </IconButton>
        </Bezel>
      )}

      {addOpen && <AddDialog onAdd={addSource} onClose={() => setAddOpen(false)} />}
      <SettingsSheet open={settingsOpen} settings={settings} onChange={setSettings} onClose={() => setSettingsOpen(false)} />
      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
    </main>
  );
}

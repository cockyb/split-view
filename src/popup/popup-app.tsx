import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowCounterClockwise, ArrowRight, GearSix, LinkSimple, Plus } from "@phosphor-icons/react";
import { adapterForPlatform, adapterForUrl, normalizeStreamUrl } from "../adapters";
import { sendRuntimeMessage } from "../shared/browser-api";
import { toPlaybackIssue } from "../shared/errors";
import { getSettings } from "../shared/storage";
import type { AppSettings, LauncherContext, StreamMetadata, StreamSource } from "../shared/types";
import { Bezel, BrandMark, IconButton, PrimaryButton } from "../ui/common";
import { SettingsSheet } from "../ui/settings-sheet";

const EMPTY_CONTEXT: LauncherContext = {
  playerOpen: false,
  streamCount: 0
};

export function PopupApp() {
  const [context, setContext] = useState<LauncherContext>(EMPTY_CONTEXT);
  const [metadata, setMetadata] = useState<StreamMetadata>();
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [settings, setSettings] = useState<AppSettings>();
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    void Promise.all([
      sendRuntimeMessage<LauncherContext>({ type: "GET_LAUNCHER_CONTEXT" }),
      getSettings()
    ]).then(([response, nextSettings]) => {
      if (response.ok) setContext(response.data);
      setSettings(nextSettings);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!context.currentSource) {
      setMetadata(undefined);
      return;
    }
    let active = true;
    void adapterForPlatform(context.currentSource.platform)
      .resolveMetadata(context.currentSource)
      .then((value) => active && setMetadata(value))
      .catch(() => active && setMetadata(undefined));
    return () => {
      active = false;
    };
  }, [context.currentSource]);

  const inputValid = useMemo(() => input.trim().length > 0 && Boolean(adapterForUrl(input)), [input]);

  const openSource = async (source?: StreamSource, restore = false) => {
    setSubmitting(true);
    setError("");
    const response = await sendRuntimeMessage({ type: "OPEN_PLAYER", source, restore });
    setSubmitting(false);
    if (!response.ok) {
      setError(response.error);
      return;
    }
    window.close();
  };

  const submitUrl = async (event: FormEvent) => {
    event.preventDefault();
    if (!inputValid) {
      setError("지원하는 공개 라이브 링크를 입력해 주세요.");
      return;
    }
    try {
      await openSource(await normalizeStreamUrl(input));
    } catch (caught) {
      setError(toPlaybackIssue(caught).message);
    }
  };

  const currentPlatform = context.currentSource?.platform.toUpperCase();
  const live = metadata?.isLive && !metadata.isRestricted;

  return (
    <main className="popup-shell">
      <header className="popup-header">
        <BrandMark />
        <div className="popup-header__actions">
          {context.playerOpen && (
            <span className="running-status">실행 중 · {context.streamCount}개 재생</span>
          )}
          <IconButton label="설정" onClick={() => setSettingsOpen(true)}>
            <GearSix size={18} weight="light" />
          </IconButton>
        </div>
      </header>

      <section className="current-section" aria-busy={loading}>
        <Bezel className="current-card" coreClassName="current-card__core">
          {loading ? (
            <div className="card-loading" aria-label="현재 페이지 확인 중">
              <span /><span /><span />
            </div>
          ) : context.currentSource ? (
            <>
              <div className="current-card__meta">
                <span className={`live-label ${live ? "is-live" : ""}`}>
                  {live ? "LIVE" : metadata?.isRestricted ? "제한됨" : "확인 중"} · {currentPlatform}
                </span>
                <strong>{metadata?.channelName ?? context.currentSource.channelKey}</strong>
                <p>{metadata?.title ?? "방송 정보를 불러오는 중이에요"}</p>
              </div>
              <PrimaryButton
                disabled={submitting}
                onClick={() => void openSource(context.currentSource)}
                icon={context.playerOpen ? <Plus size={17} weight="light" /> : undefined}
              >
                {context.playerOpen ? "현재 플레이어에 추가" : "플레이어에서 열기"}
              </PrimaryButton>
            </>
          ) : (
            <div className="unsupported-card">
              <span className="unsupported-card__icon"><LinkSimple size={19} weight="light" /></span>
              <div>
                <strong>현재 페이지에서 방송을 찾지 못했어요</strong>
                <p>아래에 라이브 링크를 붙여넣어 시작할 수 있어요.</p>
              </div>
            </div>
          )}
        </Bezel>
      </section>

      <form className="url-form" onSubmit={(event) => void submitUrl(event)}>
        <label htmlFor="stream-url">다른 방송 추가</label>
        <Bezel className={`url-input-shell ${input.length > 0 && !inputValid ? "is-invalid" : ""}`} coreClassName="url-input-core">
          <input
            id="stream-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setError("");
            }}
            placeholder="공개 라이브 링크"
            aria-invalid={input.length > 0 && !inputValid}
          />
          <button type="submit" aria-label="방송 추가" disabled={!inputValid || submitting}>
            <ArrowRight size={18} weight="light" />
          </button>
        </Bezel>
        {error && <p className="form-error" role="alert">{error}</p>}
      </form>

      {context.snapshot && context.snapshot.sources.length > 0 && (
        <button
          type="button"
          className="restore-button"
          onClick={() => void openSource(undefined, true)}
          disabled={submitting}
        >
          <ArrowCounterClockwise size={16} weight="light" />
          지난 구성 복원 · {context.snapshot.sources.length}개 방송
        </button>
      )}

      {settings && (
        <SettingsSheet
          open={settingsOpen}
          settings={settings}
          onChange={setSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </main>
  );
}

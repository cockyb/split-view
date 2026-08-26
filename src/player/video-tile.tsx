import { useEffect, useRef, useState } from "react";
import {
  ArrowsOut,
  ArrowUUpLeft,
  Pause,
  Play,
  SpeakerHigh,
  SpeakerSlash,
  X
} from "@phosphor-icons/react";
import { requestOriginPermission } from "../shared/browser-api";
import { PlaybackError, toPlaybackIssue } from "../shared/errors";
import type {
  PlaybackIssue,
  QualityOption,
  StreamMetadata,
  StreamPreference,
  StreamSource
} from "../shared/types";
import { IconButton } from "../ui/common";
import { PlaybackController, type PlaybackState } from "./playback-engine";

interface VideoTileProps {
  source: StreamSource;
  preference: StreamPreference;
  selected: boolean;
  controlsVisible: boolean;
  maxQualityHeight?: number;
  onSelect(sourceId: string): void;
  onPreference(preference: StreamPreference): void;
  onRemove(sourceId: string): void;
  onToast(message: string): void;
  onDragStart(sourceId: string): void;
  onDrop(sourceId: string): void;
}

const EMPTY_METADATA: StreamMetadata = {
  title: "방송 정보를 불러오는 중이에요",
  channelName: "연결 중",
  isLive: true,
  isRestricted: false
};

export function VideoTile({
  source,
  preference,
  selected,
  controlsVisible,
  maxQualityHeight,
  onSelect,
  onPreference,
  onRemove,
  onToast,
  onDragStart,
  onDrop
}: VideoTileProps) {
  const tileRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controllerRef = useRef<PlaybackController | undefined>(undefined);
  const [metadata, setMetadata] = useState(EMPTY_METADATA);
  const [state, setState] = useState<PlaybackState>("resolving");
  const [issue, setIssue] = useState<PlaybackIssue>();
  const [qualities, setQualities] = useState<QualityOption[]>([]);
  const [qualityHeight, setQualityHeight] = useState<number>();
  const [autoQuality, setAutoQuality] = useState(true);
  const [showWaitingText, setShowWaitingText] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const controller = new PlaybackController(source, video, {
      onMetadata: setMetadata,
      onState: setState,
      onIssue: setIssue,
      onQualities(options, currentHeight, automatic) {
        setQualities(options);
        setQualityHeight(currentHeight);
        setAutoQuality(Boolean(automatic));
      },
      onToast
    });
    controllerRef.current = controller;
    void controller.start();
    return () => {
      controller.destroy();
      controllerRef.current = undefined;
    };
  }, [source.id]);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.muted = preference.muted;
    videoRef.current.volume = preference.volume;
  }, [preference.muted, preference.volume]);

  useEffect(() => {
    controllerRef.current?.setAutoQuality(maxQualityHeight);
  }, [maxQualityHeight]);

  useEffect(() => {
    if (state !== "connecting") {
      setShowWaitingText(false);
      return;
    }
    const timer = window.setTimeout(() => setShowWaitingText(true), 3_000);
    return () => window.clearTimeout(timer);
  }, [state]);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  };

  const toggleMute = () => {
    onPreference({ ...preference, muted: !preference.muted });
  };

  const requestPermission = async () => {
    if (!issue?.permissionOrigin) return;
    const granted = await requestOriginPermission(issue.permissionOrigin);
    if (!granted) {
      setIssue(toPlaybackIssue(new PlaybackError("permission_denied"), source.canonicalUrl));
      return;
    }
    await controllerRef.current?.retry();
  };

  const fullscreen = () => {
    void tileRef.current?.requestFullscreen();
  };

  const stateLabel = {
    resolving: "방송 정보 확인 중",
    permission: "접근 권한 필요",
    connecting: showWaitingText ? "스트림 연결 중" : "",
    playing: "",
    paused: "일시정지",
    retrying: "연결을 다시 잡고 있어요",
    error: "",
    ended: "방송이 종료됐어요"
  }[state];

  return (
    <article
      ref={tileRef}
      className={`video-tile ${selected ? "is-selected" : ""} ${controlsVisible ? "controls-visible" : "controls-hidden"}`}
      data-source-id={source.id}
      draggable
      onDragStart={() => onDragStart(source.id)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(source.id);
      }}
      onClick={() => onSelect(source.id)}
      onDoubleClick={fullscreen}
    >
      {metadata.thumbnailUrl && state !== "playing" && (
        <div className="tile-thumbnail" style={{ backgroundImage: `url("${metadata.thumbnailUrl.replaceAll('"', '')}")` }} />
      )}
      <video
        ref={videoRef}
        data-stream-video={source.id}
        playsInline
        muted
        autoPlay
        onPlaying={() => setState("playing")}
        onPause={() => setState("paused")}
        onEnded={() => setState("ended")}
      />

      <div className="tile-focus-label" aria-hidden="true">
        {selected ? "선택됨 · 오디오 포커스" : ""}
      </div>

      <header className="tile-top-overlay tile-controls" onClick={(event) => event.stopPropagation()}>
        <div className="tile-heading">
          <strong>{metadata.channelName}</strong>
          <span>{source.platform.toUpperCase()}</span>
          <p>{metadata.title}</p>
        </div>
        <div className="tile-actions">
          <label className="quality-select" title="화질 선택">
            <span className="sr-only">화질 선택</span>
            <select
              value={autoQuality ? "auto" : String(qualities.find((quality) => quality.height === qualityHeight)?.index ?? "auto")}
              onChange={(event) => {
                if (event.target.value === "auto") {
                  controllerRef.current?.setAutoQuality(maxQualityHeight);
                  setAutoQuality(true);
                } else {
                  controllerRef.current?.setQuality(Number(event.target.value));
                  setAutoQuality(false);
                }
              }}
            >
              <option value="auto">자동</option>
              {qualities.map((quality) => (
                <option key={quality.index} value={quality.index}>{quality.label}</option>
              ))}
            </select>
          </label>
          <IconButton label="타일 전체화면" onClick={fullscreen}>
            <ArrowsOut size={17} weight="light" />
          </IconButton>
          <IconButton label="방송 닫기" onClick={() => onRemove(source.id)}>
            <X size={17} weight="light" />
          </IconButton>
        </div>
      </header>

      {stateLabel && !issue && (
        <div className={`tile-status ${state === "paused" ? "tile-status--quiet" : ""}`} aria-live="polite">
          {state === "retrying" || state === "resolving" || state === "connecting" ? (
            <span className="dot-pulse" aria-hidden="true"><i /><i /><i /></span>
          ) : null}
          <span>{stateLabel}</span>
        </div>
      )}

      {issue && (
        <div className="tile-issue" role={issue.retryable ? "status" : "alert"} onClick={(event) => event.stopPropagation()}>
          <span className="eyebrow">{issue.code.replaceAll("_", " ")}</span>
          <strong>{issue.message}</strong>
          <div className="tile-issue__actions">
            {issue.code === "permission_required" ? (
              <button type="button" className="secondary-button" onClick={() => void requestPermission()}>접근 허용</button>
            ) : issue.retryable ? (
              <button type="button" className="secondary-button" onClick={() => void controllerRef.current?.retry()}>다시 시도</button>
            ) : null}
            <button type="button" className="text-button" onClick={() => window.open(source.canonicalUrl, "_blank", "noopener")}>플랫폼에서 열기</button>
          </div>
          <details>
            <summary>오류 상세</summary>
            <span>진단 ID {issue.diagnosticId}</span>
          </details>
        </div>
      )}

      <footer className="tile-bottom-overlay tile-controls" onClick={(event) => event.stopPropagation()}>
        <IconButton label={state === "paused" ? "재생" : "일시정지"} onClick={togglePlayback}>
          {state === "paused" ? <Play size={18} weight="fill" /> : <Pause size={18} weight="fill" />}
        </IconButton>
        <IconButton label={preference.muted ? "음소거 해제" : "음소거"} onClick={toggleMute}>
          {preference.muted ? <SpeakerSlash size={18} weight="light" /> : <SpeakerHigh size={18} weight="light" />}
        </IconButton>
        <input
          className="volume-slider"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={preference.volume}
          aria-label="음량"
          onChange={(event) => onPreference({ ...preference, volume: Number(event.target.value) })}
        />
        <span className="quality-label">{autoQuality ? "자동" : "고정"} · {qualityHeight ? `${qualityHeight}p` : "—"}</span>
        {videoRef.current && Number.isFinite(videoRef.current.duration) && videoRef.current.seekable.length > 0 && (
          <button type="button" className="live-button" onClick={() => controllerRef.current?.seekLive()}>
            <ArrowUUpLeft size={14} weight="light" /> 라이브로
          </button>
        )}
      </footer>
    </article>
  );
}

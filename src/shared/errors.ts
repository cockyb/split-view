import type { PlaybackErrorCode, PlaybackIssue } from "./types";

const MESSAGES: Record<PlaybackErrorCode, string> = {
  invalid_url: "지원하는 치지직 또는 SOOP 라이브 링크를 입력해 주세요.",
  network_lost: "연결을 다시 잡고 있어요",
  session_expired: "재생 세션을 새로 연결하고 있어요",
  quality_unavailable: "일반 화질로 전환했어요",
  permission_required: "이 방송의 CDN 접근 권한이 필요해요",
  permission_denied: "권한을 허용하면 재생할 수 있어요",
  offline: "지금은 방송 중이 아니에요",
  live_ended: "방송이 종료됐어요",
  login_required: "플랫폼 로그인이 필요한 방송이에요",
  restricted: "이 방송은 Split View에서 재생할 수 없어요",
  password_required: "비밀번호 방송은 아직 지원하지 않아요",
  adapter_contract_changed: "플랫폼 변경으로 재생 정보를 읽지 못했어요",
  playback_fatal: "재생을 시작하지 못했어요"
};

function diagnosticId(): string {
  return crypto.randomUUID().slice(0, 8).toUpperCase();
}

export class PlaybackError extends Error {
  readonly code: PlaybackErrorCode;
  readonly retryable: boolean;
  readonly status?: number;
  readonly permissionOrigin?: string;

  constructor(
    code: PlaybackErrorCode,
    options: {
      cause?: unknown;
      message?: string;
      retryable?: boolean;
      status?: number;
      permissionOrigin?: string;
    } = {}
  ) {
    super(options.message ?? MESSAGES[code], { cause: options.cause });
    this.name = "PlaybackError";
    this.code = code;
    this.retryable = options.retryable ?? ["network_lost", "session_expired", "playback_fatal"].includes(code);
    this.status = options.status;
    this.permissionOrigin = options.permissionOrigin;
  }
}

export function toPlaybackIssue(error: unknown, platformUrl?: string): PlaybackIssue {
  const normalized =
    error instanceof PlaybackError
      ? error
      : new PlaybackError("playback_fatal", { cause: error });

  return {
    code: normalized.code,
    message: normalized.message,
    diagnosticId: diagnosticId(),
    retryable: normalized.retryable,
    platformUrl,
    permissionOrigin: normalized.permissionOrigin
  };
}

export function errorForHttpStatus(status: number): PlaybackError {
  if (status === 401) return new PlaybackError("login_required", { status });
  if (status === 403) return new PlaybackError("restricted", { status });
  if (status === 404) return new PlaybackError("offline", { status });
  if (status >= 500) return new PlaybackError("network_lost", { status, retryable: true });
  return new PlaybackError("adapter_contract_changed", { status });
}

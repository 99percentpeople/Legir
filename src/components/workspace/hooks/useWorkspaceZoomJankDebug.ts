import { useEffect, useRef, useState } from "react";
import { useAppEvent } from "@/hooks/useAppEventBus";

const FRAME_BUDGET_MS = 1000 / 60;
const JANK_FRAME_THRESHOLD_MS = 20;
const SESSION_IDLE_MS = 180;
const SNAPSHOT_THROTTLE_MS = 120;

type ZoomSession = {
  id: number;
  startScale: number;
  targetScale: number;
  startedAt: number;
  lastActivityAt: number;
  lastFrameAt: number | null;
  lastPublishAt: number;
  firstScaleCommitAt: number | null;
  frameCount: number;
  totalFrameMs: number;
  blockedMs: number;
  maxFrameMs: number;
  lastFrameMs: number | null;
  jankFrameCount: number;
  droppedFrames: number;
  zoomChangeCount: number;
};

export type WorkspaceZoomJankSnapshot = {
  active: boolean;
  sessionId: number | null;
  startScale: number | null;
  targetScale: number | null;
  durationMs: number | null;
  responseMs: number | null;
  frameCount: number | null;
  avgFrameMs: number | null;
  blockedMs: number | null;
  maxFrameMs: number | null;
  lastFrameMs: number | null;
  jankFrameCount: number | null;
  droppedFrames: number | null;
  zoomChangeCount: number | null;
};

const createEmptySnapshot = (): WorkspaceZoomJankSnapshot => ({
  active: false,
  sessionId: null,
  startScale: null,
  targetScale: null,
  durationMs: null,
  responseMs: null,
  frameCount: null,
  avgFrameMs: null,
  blockedMs: null,
  maxFrameMs: null,
  lastFrameMs: null,
  jankFrameCount: null,
  droppedFrames: null,
  zoomChangeCount: null,
});

const toSnapshot = (
  session: ZoomSession,
  now: number,
  active: boolean,
): WorkspaceZoomJankSnapshot => ({
  active,
  sessionId: session.id,
  startScale: session.startScale,
  targetScale: session.targetScale,
  durationMs: Math.max(0, Math.round(now - session.startedAt)),
  responseMs:
    session.firstScaleCommitAt === null
      ? null
      : Math.max(0, Math.round(session.firstScaleCommitAt - session.startedAt)),
  frameCount: session.frameCount,
  avgFrameMs:
    session.frameCount > 0 ? session.totalFrameMs / session.frameCount : null,
  blockedMs: session.frameCount > 0 ? Math.round(session.blockedMs) : null,
  maxFrameMs: session.frameCount > 0 ? session.maxFrameMs : null,
  lastFrameMs: session.lastFrameMs,
  jankFrameCount: session.jankFrameCount,
  droppedFrames: session.droppedFrames,
  zoomChangeCount: session.zoomChangeCount,
});

export const useWorkspaceZoomJankDebug = (opts: {
  enabled: boolean;
  scale: number;
}) => {
  const { enabled, scale } = opts;
  const [snapshot, setSnapshot] = useState<WorkspaceZoomJankSnapshot | null>(
    null,
  );
  const prevScaleRef = useRef(scale);
  const sessionRef = useRef<ZoomSession | null>(null);
  const rafRef = useRef<number | null>(null);
  const sessionSeqRef = useRef(0);
  const enabledRef = useRef(enabled);

  const startMonitoringLoop = () => {
    if (rafRef.current !== null) {
      return;
    }

    const tick = (ts: number) => {
      const session = sessionRef.current;
      if (!session) {
        rafRef.current = null;
        return;
      }

      const previousFrameAt = session.lastFrameAt ?? session.startedAt;
      const delta = ts - previousFrameAt;

      session.frameCount += 1;
      session.totalFrameMs += delta;
      session.blockedMs += Math.max(0, delta - FRAME_BUDGET_MS);
      session.maxFrameMs = Math.max(session.maxFrameMs, delta);
      session.lastFrameMs = delta;
      if (delta >= JANK_FRAME_THRESHOLD_MS) {
        session.jankFrameCount += 1;
      }
      session.droppedFrames += Math.max(
        0,
        Math.round(delta / FRAME_BUDGET_MS) - 1,
      );

      session.lastFrameAt = ts;
      const isIdle = ts - session.lastActivityAt >= SESSION_IDLE_MS;
      const shouldPublish =
        isIdle || ts - session.lastPublishAt >= SNAPSHOT_THROTTLE_MS;

      if (shouldPublish) {
        session.lastPublishAt = ts;
        setSnapshot(toSnapshot(session, ts, !isIdle));
      }

      if (isIdle) {
        sessionRef.current = null;
        rafRef.current = null;
        return;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  };

  const upsertSession = (options: {
    at: number;
    startScale: number;
    targetScale: number;
    countStep: boolean;
    markCommitted: boolean;
  }) => {
    const { at, startScale, targetScale, countStep, markCommitted } = options;
    const current = sessionRef.current;
    const shouldStartNewSession =
      !current || at - current.lastActivityAt > SESSION_IDLE_MS;

    if (shouldStartNewSession) {
      sessionSeqRef.current += 1;
      sessionRef.current = {
        id: sessionSeqRef.current,
        startScale,
        targetScale,
        startedAt: at,
        lastActivityAt: at,
        lastFrameAt: null,
        lastPublishAt: 0,
        firstScaleCommitAt: markCommitted ? at : null,
        frameCount: 0,
        totalFrameMs: 0,
        blockedMs: 0,
        maxFrameMs: 0,
        lastFrameMs: null,
        jankFrameCount: 0,
        droppedFrames: 0,
        zoomChangeCount: countStep ? 1 : 0,
      };
      setSnapshot(toSnapshot(sessionRef.current, at, true));
      startMonitoringLoop();
      return;
    }

    current.targetScale = targetScale;
    current.lastActivityAt = at;
    if (markCommitted && current.firstScaleCommitAt === null) {
      current.firstScaleCommitAt = at;
    }
    if (countStep) {
      current.zoomChangeCount += 1;
    }
    setSnapshot(toSnapshot(current, at, true));
    startMonitoringLoop();
  };

  useEffect(() => {
    prevScaleRef.current = scale;
  }, []);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      sessionRef.current = null;
      setSnapshot(null);
      prevScaleRef.current = scale;
      return;
    }

    prevScaleRef.current = scale;
    setSnapshot(createEmptySnapshot());
  }, [enabled]);

  useAppEvent("workspace:zoomInput", (payload) => {
    if (!enabledRef.current) {
      return;
    }

    upsertSession({
      at: payload.at,
      startScale: payload.fromScale,
      targetScale: payload.targetScale,
      countStep: true,
      markCommitted: false,
    });
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (prevScaleRef.current === scale) {
      return;
    }

    const now = performance.now();
    const previousScale = prevScaleRef.current;
    prevScaleRef.current = scale;
    const current = sessionRef.current;
    const hasActiveInputSession =
      !!current && now - current.lastActivityAt <= SESSION_IDLE_MS;

    upsertSession({
      at: now,
      startScale: previousScale,
      targetScale: scale,
      countStep: !hasActiveInputSession,
      markCommitted: true,
    });
  }, [enabled, scale]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  return snapshot;
};

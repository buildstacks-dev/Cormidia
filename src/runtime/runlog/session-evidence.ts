import type { TurnResult } from "../types.js";
import type { SessionEvidence } from "./envelope.js";

/** Operator-facing transcript reference shared by every governed executor. */
export function sessionEvidence(session: TurnResult["session"]): SessionEvidence {
  if (session.runtime === "codex") {
    return {
      ...session,
      native_ref: `codex://threads/${encodeURIComponent(session.id)}`,
      transcript: "native_task",
      transcript_note: "Open the native Codex task for the full provider transcript.",
    };
  }
  if (session.runtime === "pi") {
    return {
      ...session,
      native_ref: session.id,
      transcript: "provider_session",
      transcript_note: "Provider session reference recorded; session.log is activity only.",
    };
  }
  if (session.runtime === "cursor") {
    return {
      ...session,
      native_ref: session.id,
      transcript: "provider_session",
      transcript_note: "Resume the chat with `cursor-agent --resume <id>`; session.log is activity only.",
    };
  }
  if (session.runtime === "opencode") {
    return {
      ...session,
      native_ref: session.id,
      transcript: "provider_session",
      transcript_note: "Provider session reference recorded; session.log is activity only.",
    };
  }
  if (session.runtime === "muse") {
    return {
      ...session,
      native_ref: session.id,
      transcript: "provider_session",
      transcript_note:
        "Provider session reference recorded; the durable muse session log is the transcript " +
        "and session.log is activity only.",
    };
  }
  if (session.runtime === "grok") {
    return {
      ...session,
      native_ref: session.id,
      transcript: "provider_session",
      transcript_note:
        "Provider session reference recorded; the transcript lives under the turn's " +
        "isolated $GROK_HOME/sessions and session.log is activity only.",
    };
  }
  return {
    ...session,
    transcript: "unavailable",
    transcript_note: "Claude SDK did not expose a full transcript reference; session.log is activity only.",
  };
}

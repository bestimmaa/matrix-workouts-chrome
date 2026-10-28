/** The `type` of an extension message, or undefined for anything that is not one. */
export const messageType = (message: unknown): unknown =>
  typeof message === "object" && message !== null ? (message as { type?: unknown }).type : undefined;

/** A GET for the workout API, forwarded by the worker. */
export interface ApiFetchMessage {
  type: "apiFetch";
  url: string;
  headers: Record<string, string>;
}

export interface ApiFetchReply {
  ok: boolean;
  status: number;
  body: unknown;
  /** Set only on a transport failure, and never contains request headers. */
  error?: string;
}

export function isApiFetch(message: unknown): message is ApiFetchMessage {
  return messageType(message) === "apiFetch" && typeof (message as ApiFetchMessage).url === "string";
}

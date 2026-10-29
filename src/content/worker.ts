/**
 * Send one message to the service worker and wait for its answer. An undefined
 * reply means the worker was not there to give one, which is an error, never a
 * value.
 */
export async function askWorker<T>(message: unknown): Promise<T> {
  const reply = (await chrome.runtime.sendMessage(message)) as T | undefined;
  if (reply === undefined) throw new Error("The extension's background worker did not respond.");
  return reply;
}

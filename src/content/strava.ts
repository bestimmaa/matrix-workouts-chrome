import { stravaUpload, type Workout } from "matrix-workouts-core";
import type { UploadMessage } from "../background/strava.js";
import type { StravaOutcome } from "../ui/dashboard.js";
import { askWorker } from "./worker.js";

/**
 * Hand one ride to the service worker for upload. Core decides what the upload says;
 * the worker holds the tokens and makes the requests, so the access token never
 * enters a page that runs code we do not control.
 *
 * Extension messages are JSON, which has no bytes, so the FIT file travels as base64.
 */
export function sendToStrava(workout: Workout): Promise<StravaOutcome> {
  const upload = stravaUpload(workout);
  const message: UploadMessage = {
    type: "stravaUpload",
    fields: upload.fields,
    filename: upload.file.filename,
    fileBase64: toBase64(upload.file.bytes),
  };
  return askWorker<StravaOutcome>(message);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

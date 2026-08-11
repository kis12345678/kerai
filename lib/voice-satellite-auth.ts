import { timingSafeEqual } from "node:crypto";

// Unlike TOOL_APPROVAL_SECRET (randomly generated per-process, only ever shared between this
// server and its own browser tab), a satellite device is separate hardware that needs the same
// secret baked into its own firmware ahead of time — so this one has to be a stable value the
// user sets once in .env.local and copies into the device's config, not something generated here.
export function isVoiceSatelliteConfigured(): boolean {
  return Boolean(process.env.VOICE_SATELLITE_SECRET);
}

export function checkVoiceSatelliteSecret(candidate: string): boolean {
  const expected = process.env.VOICE_SATELLITE_SECRET;
  if (!expected) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

import { tool } from "ai";
import { z } from "zod";

// The device-action vocabulary the voice brain can invoke — the same idea as IRIS's tool
// registry, but the tools resolve to nothing on the server. Each execute() just marks the action
// "queued": the SERVER decides *what* to do (it has the model), the PHONE decides *how* (it has
// the hardware). The returned tool calls are handed to the phone, which runs them natively.
//
// Keeping them execute-able (rather than execute-less) lets the model take an action AND still
// produce a short spoken sentence in the same turn, so the user hears a confirmation.

const queued = async () => ({ queued: true });

// The raw zod schemas, kept separately so the voice endpoint can re-validate the model's tool
// calls against them (small models sometimes emit out-of-enum values that must be dropped).
export const PHONE_ACTION_SCHEMAS = {
  callContact: z.object({ contact: z.string().describe("Contact name or phone number") }),
  sendSms: z.object({ contact: z.string(), message: z.string() }),
  sendWhatsApp: z.object({ contact: z.string(), message: z.string() }),
  openApp: z.object({
    app: z.string().describe("App name, e.g. YouTube, Spotify, Maps, Chrome, Settings"),
    query: z.string().optional().describe("Optional search/content to open within the app"),
  }),
  mediaControl: z.object({ action: z.enum(["play", "pause", "toggle", "next", "previous"]) }),
  toggleHardware: z.object({
    target: z.enum(["flashlight", "wifi", "bluetooth", "location", "hotspot"]),
    action: z.enum(["on", "off", "toggle", "open"]).default("toggle"),
  }),
  controlCall: z.object({ action: z.enum(["answer", "reject", "announce"]) }),
  readNotifications: z.object({ app: z.string().optional() }),
} as const;

export function createPhoneActionTools() {
  return {
    callContact: tool({
      description: "Place a phone call to a saved contact by name, or a raw number.",
      inputSchema: PHONE_ACTION_SCHEMAS.callContact,
      execute: queued,
    }),
    sendSms: tool({
      description: "Send an SMS text message to a contact or number.",
      inputSchema: PHONE_ACTION_SCHEMAS.sendSms,
      execute: queued,
    }),
    sendWhatsApp: tool({
      description: "Send a WhatsApp message to a contact by name.",
      inputSchema: PHONE_ACTION_SCHEMAS.sendWhatsApp,
      execute: queued,
    }),
    openApp: tool({
      description:
        "Open an app on the phone, optionally deep-linking to a search or content query " +
        "(e.g. open YouTube and search a song, open Maps to a place).",
      inputSchema: PHONE_ACTION_SCHEMAS.openApp,
      execute: queued,
    }),
    mediaControl: tool({
      description: "Control system-wide media playback (any app currently playing).",
      inputSchema: PHONE_ACTION_SCHEMAS.mediaControl,
      execute: queued,
    }),
    toggleHardware: tool({
      description: "Toggle a hardware setting or open its settings panel.",
      inputSchema: PHONE_ACTION_SCHEMAS.toggleHardware,
      execute: queued,
    }),
    controlCall: tool({
      description: "Answer or reject the currently ringing incoming call, or announce who's calling.",
      inputSchema: PHONE_ACTION_SCHEMAS.controlCall,
      execute: queued,
    }),
    readNotifications: tool({
      description: "Read the phone's recent notifications aloud, optionally filtered to one app.",
      inputSchema: PHONE_ACTION_SCHEMAS.readNotifications,
      execute: queued,
    }),
  };
}

export type PhoneAction = { name: string; args: Record<string, unknown> };

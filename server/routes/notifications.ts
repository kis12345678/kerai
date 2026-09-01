import { RequestHandler } from "express";
import { notifications } from "../lib/notifications.js";
import { strParam } from "../lib/utils.js";
import type { NotificationType } from "../lib/notifications.js";

/**
 * GET /api/notifications — list all notifications
 */
export const handleNotificationsList: RequestHandler = (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
  const unreadOnly = req.query.unread === "true";

  const notifs = unreadOnly ? notifications.getUnread(limit) : notifications.getAll(limit);
  const unreadCount = notifications.getUnreadCount();

  res.status(200).json({ notifications: notifs, total: notifs.length, unreadCount });
};

/**
 * GET /api/notifications/unread-count — get unread count only (lightweight)
 */
export const handleNotificationsUnreadCount: RequestHandler = (_req, res) => {
  const count = notifications.getUnreadCount();
  res.status(200).json({ unreadCount: count });
};

/**
 * POST /api/notifications — create a notification
 */
export const handleNotificationsCreate: RequestHandler = (req, res) => {
  const { type, title, message, source, actionUrl, metadata } = req.body as {
    type?: NotificationType;
    title?: string;
    message?: string;
    source?: string;
    actionUrl?: string;
    metadata?: Record<string, unknown>;
  };

  if (!title || !message) {
    res.status(400).json({ error: "title and message are required" });
    return;
  }

  const notif = notifications.create({
    type: type || "info",
    title,
    message,
    source,
    actionUrl,
    metadata,
  });

  res.status(201).json(notif);
};

/**
 * POST /api/notifications/:id/read — mark as read
 */
export const handleNotificationsRead: RequestHandler = (req, res) => {
  const id = strParam(req.params.id);
  notifications.markRead(id);
  res.status(200).json({ message: "Marked as read", id });
};

/**
 * POST /api/notifications/read-all — mark all as read
 */
export const handleNotificationsReadAll: RequestHandler = (_req, res) => {
  const count = notifications.markAllRead();
  res.status(200).json({ message: "All marked as read", count });
};

/**
 * DELETE /api/notifications/:id — delete a notification
 */
export const handleNotificationsDelete: RequestHandler = (req, res) => {
  const id = strParam(req.params.id);
  const deleted = notifications.delete(id);

  if (!deleted) {
    res.status(404).json({ error: `Notification "${id}" not found` });
    return;
  }

  res.status(200).json({ message: "Deleted", id });
};

/**
 * DELETE /api/notifications — clear all notifications
 */
export const handleNotificationsClear: RequestHandler = (_req, res) => {
  const count = notifications.clearAll();
  res.status(200).json({ message: "All notifications cleared", count });
};

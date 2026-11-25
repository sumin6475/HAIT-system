// Admin check: the x-admin-token header must equal ADMIN_TOKEN, or the request gets 401.

import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = req.header("x-admin-token");
  if (!token || token !== config.adminToken) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
}

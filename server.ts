import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key-for-dev";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";

const usersDb: Record<string, { email: string, credits: number, isPremium: boolean }> = {};
const SPECIAL_EMAILS = ['amliyarsachin248@gmail.com', 'amaliyarmanu5@gmail.com', 'sachinamliyar15@gmail.com', 'robotlinkan@gmail.com'];

async function startServer() {
  const app = express();
  const PORT = 3000;
  app.use(express.json());
  app.use(cookieParser());

  app.get("/api/user", (req, res) => {
    const mockEmail = req.cookies.mock_session;
    if (mockEmail) {
      if (!usersDb[mockEmail]) {
        const isSpecial = SPECIAL_EMAILS.includes(mockEmail);
        usersDb[mockEmail] = { email: mockEmail, credits: isSpecial ? Infinity : 20000, isPremium: isSpecial };
      }
      return res.json(usersDb[mockEmail]);
    }
    res.status(401).json({ error: "Unauthorized" });
  });

  app.post("/api/user/deduct", (req, res) => {
    const email = req.cookies.mock_session;
    if (!email || !usersDb[email]) return res.status(401).json({ error: "User not found" });
    const { amount } = req.body;
    if (usersDb[email].credits !== Infinity) usersDb[email].credits -= amount;
    res.json(usersDb[email]);
  });

  app.listen(PORT, "0.0.0.0", () => console.log(`Server running on http://localhost:${PORT}`));
}
startServer();

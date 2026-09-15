import { Router, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadRoot = path.resolve(
  process.env.UPLOAD_DIR || path.join(__dirname, "../../uploads")
);

fs.mkdirSync(uploadRoot, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadRoot),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    const base = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    cb(null, `${base}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype.split("/")[1] || "");
    if (ext && mime) cb(null, true);
    else cb(new Error("Apenas imagens são permitidas"));
  },
});

router.post("/", authMiddleware, upload.single("image"), async (req, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Nenhuma imagem enviada" });

    const publicBase = (process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 8787}`).replace(
      /\/$/,
      ""
    );
    const url = `${publicBase}/uploads/${req.file.filename}`;
    return res.json({ url, filename: req.file.filename });
  } catch (error) {
    console.error("Upload error:", error);
    const message = error instanceof Error ? error.message : "Erro ao enviar imagem";
    return res.status(500).json({ error: message });
  }
});

export default router;
export { uploadRoot };

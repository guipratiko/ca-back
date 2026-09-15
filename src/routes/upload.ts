import { Router, Response } from "express";
import multer from "multer";
import path from "path";
import { authMiddleware } from "../middleware/auth.js";
import { uploadFileToMediaService } from "../services/mediaService.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedExt = /jpeg|jpg|png|webp|gif|pdf|doc|docx|xls|xlsx|zip|mp4|mov|webm/;
    const ext = path.extname(file.originalname).toLowerCase().replace(".", "");
    const mimeOk =
      file.mimetype.startsWith("image/") ||
      file.mimetype.startsWith("video/") ||
      file.mimetype === "application/pdf" ||
      file.mimetype.includes("officedocument") ||
      file.mimetype.includes("msword") ||
      file.mimetype.includes("ms-excel") ||
      file.mimetype === "application/zip" ||
      file.mimetype === "application/x-zip-compressed";

    if (allowedExt.test(ext) || mimeOk) cb(null, true);
    else cb(new Error("Tipo de arquivo não permitido"));
  },
});

router.post(
  "/",
  authMiddleware,
  upload.single("image"),
  async (req, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "Nenhum arquivo enviado" });
      }

      const url = await uploadFileToMediaService(
        file.buffer,
        file.originalname,
        file.mimetype
      );

      return res.json({
        url,
        filename: path.basename(url),
        originalName: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
      });
    } catch (error) {
      console.error("Upload error:", error);
      const message =
        error instanceof Error ? error.message : "Erro ao enviar arquivo";
      return res.status(500).json({ error: message });
    }
  }
);

/** Alias para campo `file` (além de `image`) */
router.post(
  "/file",
  authMiddleware,
  upload.single("file"),
  async (req, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "Nenhum arquivo enviado" });
      }

      const url = await uploadFileToMediaService(
        file.buffer,
        file.originalname,
        file.mimetype
      );

      return res.json({
        url,
        filename: path.basename(url),
        originalName: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
      });
    } catch (error) {
      console.error("Upload error:", error);
      const message =
        error instanceof Error ? error.message : "Erro ao enviar arquivo";
      return res.status(500).json({ error: message });
    }
  }
);

export default router;

import "dotenv/config";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import articleRoutes from "./routes/articles.js";
import productRoutes from "./routes/products.js";
import categoryRoutes from "./routes/categories.js";
import lessonRoutes from "./routes/lessons.js";
import uploadRoutes from "./routes/upload.js";

const app = express();
const PORT = Number(process.env.PORT || 8787);

const corsOrigins =
  process.env.CORS_ORIGIN?.split(",").map((o) => o.trim()).filter(Boolean) || [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5500",
    "null",
  ];

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || corsOrigins.includes(origin) || corsOrigins.includes("*")) {
        return cb(null, true);
      }
      return cb(null, true); // site estático pode abrir de qualquer origem em dev
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "cacursos-blog-api" });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "cacursos-blog-api" });
});

app.use("/api/auth", authRoutes);
app.use("/api/articles", articleRoutes);
app.use("/api/products", productRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/lessons", lessonRoutes);
app.use("/api/upload", uploadRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: "Rota não encontrada" });
});

app.listen(PORT, () => {
  console.log(`CA Cursos API rodando na porta ${PORT}`);
  console.log(`Uploads: MidiaService (${process.env.MEDIA_SERVICE_URL || "não configurado"})`);
});

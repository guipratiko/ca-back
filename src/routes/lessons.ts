import { Router, Response } from "express";
import slugify from "slugify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, AuthRequest } from "../middleware/auth.js";
import { ArticleStatus } from "@prisma/client";

const router = Router();

const lessonSchema = z.object({
  title: z.string().min(2),
  slug: z.string().min(2).optional(),
  description: z.string().min(5),
  youtubeId: z.string().min(5),
  category: z.string().min(2),
  duration: z.string().optional(),
  views: z.string().optional(),
  sortOrder: z.number().int().optional(),
  status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
  publishedAt: z.string().nullable().optional(),
});

function generateSlug(title: string): string {
  return slugify(title, { lower: true, strict: true, locale: "pt" });
}

/** Aceita ID cru ou URL do YouTube. */
export function extractYoutubeId(input: string): string {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname.includes("youtu.be")) {
      return u.pathname.replace(/^\//, "").split("/")[0] || s;
    }
    const v = u.searchParams.get("v");
    if (v) return v;
    const embed = u.pathname.match(/\/(?:embed|shorts)\/([\w-]{11})/);
    if (embed) return embed[1];
  } catch {
    /* ignore */
  }
  const loose = s.match(/([\w-]{11})/);
  return loose ? loose[1] : s;
}

async function resolveUniqueSlug(baseSlug: string, excludeId?: string): Promise<string> {
  let slug = baseSlug;
  let counter = 2;
  while (true) {
    const existing = await prisma.openLesson.findUnique({ where: { slug } });
    if (!existing || existing.id === excludeId) return slug;
    slug = `${baseSlug}-${counter}`;
    counter++;
  }
}

function toPublicAula(lesson: {
  slug: string;
  title: string;
  description: string;
  youtubeId: string;
  category: string;
  duration: string;
  views: string;
  publishedAt: Date | null;
}) {
  const data = lesson.publishedAt
    ? lesson.publishedAt.toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  return {
    id: lesson.slug,
    yt: lesson.youtubeId,
    titulo: lesson.title,
    categoria: lesson.category,
    duracao: lesson.duration || "",
    views: lesson.views || "",
    data,
    desc: lesson.description,
  };
}

/** Feed público no formato CA.aulas (site estático). */
router.get("/public/feed", async (_req, res: Response) => {
  try {
    const lessons = await prisma.openLesson.findMany({
      where: { status: "PUBLISHED" },
      orderBy: [{ sortOrder: "asc" }, { publishedAt: "desc" }],
    });
    return res.json({ aulas: lessons.map(toPublicAula) });
  } catch (error) {
    console.error("Public lessons feed error:", error);
    return res.status(500).json({ error: "Erro ao listar aulas" });
  }
});

router.get("/", async (req, res: Response) => {
  try {
    const isAdmin = req.headers.authorization?.startsWith("Bearer ");
    const lessons = await prisma.openLesson.findMany({
      where: isAdmin ? undefined : { status: "PUBLISHED" },
      orderBy: [{ sortOrder: "asc" }, { publishedAt: "desc" }],
    });
    return res.json({ lessons });
  } catch (error) {
    console.error("List lessons error:", error);
    return res.status(500).json({ error: "Erro ao listar aulas" });
  }
});

router.get("/admin/all", authMiddleware, async (_req, res: Response) => {
  try {
    const lessons = await prisma.openLesson.findMany({
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
    });
    return res.json({ lessons });
  } catch (error) {
    console.error("Admin list lessons error:", error);
    return res.status(500).json({ error: "Erro ao listar aulas" });
  }
});

router.get("/admin/:id", authMiddleware, async (req, res: Response) => {
  try {
    const lesson = await prisma.openLesson.findUnique({
      where: { id: String(req.params.id) },
    });
    if (!lesson) return res.status(404).json({ error: "Aula não encontrada" });
    return res.json({ lesson });
  } catch (error) {
    console.error("Admin get lesson error:", error);
    return res.status(500).json({ error: "Erro ao buscar aula" });
  }
});

router.post("/", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const data = lessonSchema.parse(req.body);
    const slug = await resolveUniqueSlug(data.slug || generateSlug(data.title));
    const status = (data.status || "DRAFT") as ArticleStatus;
    const youtubeId = extractYoutubeId(data.youtubeId);
    const publishedAt =
      data.publishedAt === null
        ? null
        : data.publishedAt
          ? new Date(data.publishedAt)
          : status === "PUBLISHED"
            ? new Date()
            : null;

    const lesson = await prisma.openLesson.create({
      data: {
        title: data.title.trim(),
        slug,
        description: data.description.trim(),
        youtubeId,
        category: data.category.trim(),
        duration: data.duration?.trim() || "",
        views: data.views?.trim() || "",
        sortOrder: data.sortOrder ?? 0,
        status,
        publishedAt,
      },
    });
    return res.status(201).json({ lesson });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Dados inválidos", details: error.errors });
    }
    console.error("Create lesson error:", error);
    return res.status(500).json({ error: "Erro ao criar aula" });
  }
});

router.put("/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const data = lessonSchema.partial().parse(req.body);
    const existing = await prisma.openLesson.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Aula não encontrada" });

    let slug = existing.slug;
    if (data.slug && data.slug !== existing.slug) {
      slug = await resolveUniqueSlug(data.slug, id);
    } else if (data.title && data.title !== existing.title && !data.slug) {
      slug = await resolveUniqueSlug(generateSlug(data.title), id);
    }

    const status = (data.status ?? existing.status) as ArticleStatus;
    let publishedAt = existing.publishedAt;
    if (data.publishedAt === null) publishedAt = null;
    else if (data.publishedAt) publishedAt = new Date(data.publishedAt);
    else if (status === "PUBLISHED" && !publishedAt) publishedAt = new Date();

    const lesson = await prisma.openLesson.update({
      where: { id },
      data: {
        title: data.title?.trim() ?? existing.title,
        slug,
        description: data.description?.trim() ?? existing.description,
        youtubeId: data.youtubeId ? extractYoutubeId(data.youtubeId) : existing.youtubeId,
        category: data.category?.trim() ?? existing.category,
        duration: data.duration !== undefined ? data.duration.trim() : existing.duration,
        views: data.views !== undefined ? data.views.trim() : existing.views,
        sortOrder: data.sortOrder ?? existing.sortOrder,
        status,
        publishedAt,
      },
    });
    return res.json({ lesson });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Dados inválidos", details: error.errors });
    }
    console.error("Update lesson error:", error);
    return res.status(500).json({ error: "Erro ao atualizar aula" });
  }
});

router.delete("/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const existing = await prisma.openLesson.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Aula não encontrada" });
    await prisma.openLesson.delete({ where: { id } });
    return res.json({ message: "Aula excluída" });
  } catch (error) {
    console.error("Delete lesson error:", error);
    return res.status(500).json({ error: "Erro ao excluir aula" });
  }
});

export default router;

import { Router, Response } from "express";
import slugify from "slugify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, AuthRequest } from "../middleware/auth.js";
import { ArticleStatus } from "@prisma/client";

const router = Router();

const articleSchema = z.object({
  title: z.string().min(3),
  slug: z.string().min(3).optional(),
  excerpt: z.string().min(10),
  content: z.string().min(10),
  coverImage: z.string().nullable().optional(),
  category: z.string().min(2),
  author: z.string().min(2).optional(),
  glyph: z.string().optional(),
  featured: z.boolean().optional(),
  readingTime: z.number().int().positive().optional(),
  seoTitle: z.string().nullable().optional(),
  seoDescription: z.string().nullable().optional(),
  status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
});

function generateSlug(title: string): string {
  return slugify(title, { lower: true, strict: true, locale: "pt" });
}

async function resolveUniqueSlug(baseSlug: string, excludeId?: string): Promise<string> {
  let slug = baseSlug;
  let counter = 2;

  while (true) {
    const existing = await prisma.article.findUnique({ where: { slug } });
    if (!existing || existing.id === excludeId) return slug;
    slug = `${baseSlug}-${counter}`;
    counter++;
  }
}

function toPublicListItem(a: {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  coverImage: string | null;
  category: string;
  author: string;
  glyph: string;
  featured: boolean;
  readingTime: number;
  status: ArticleStatus;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  seoTitle?: string | null;
  seoDescription?: string | null;
}) {
  const data = a.publishedAt
    ? a.publishedAt.toISOString().slice(0, 10)
    : a.createdAt.toISOString().slice(0, 10);

  return {
    id: a.id,
    title: a.title,
    slug: a.slug,
    excerpt: a.excerpt,
    coverImage: a.coverImage,
    category: a.category,
    author: a.author,
    glyph: a.glyph,
    featured: a.featured,
    readingTime: a.readingTime,
    status: a.status,
    publishedAt: a.publishedAt,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    seoTitle: a.seoTitle ?? null,
    seoDescription: a.seoDescription ?? null,
    // formato legado do site estático
    titulo: a.title,
    resumo: a.excerpt,
    categoria: a.category,
    autor: a.author,
    destaque: a.featured,
    capa: a.coverImage || "",
    leitura: `${a.readingTime} min`,
    data,
  };
}

/** Público: listagem no formato do blog-merge do site */
router.get("/public/feed", async (_req, res: Response) => {
  try {
    const articles = await prisma.article.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
    });

    const posts = articles.map(toPublicListItem);
    const conteudo: Record<string, string> = {};
    articles.forEach((a) => {
      conteudo[a.slug] = a.content;
    });

    return res.json({ posts, conteudo });
  } catch (error) {
    console.error("Public feed error:", error);
    return res.status(500).json({ error: "Erro ao listar artigos" });
  }
});

router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const { category, page = "1", limit = "12", q } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string, 10) || 12));
    const skip = (pageNum - 1) * limitNum;

    const isAdmin = req.headers.authorization?.startsWith("Bearer ");

    const where: {
      status?: ArticleStatus;
      category?: string;
      OR?: Array<{
        title?: { contains: string; mode: "insensitive" };
        excerpt?: { contains: string; mode: "insensitive" };
        content?: { contains: string; mode: "insensitive" };
      }>;
    } = {};

    if (!isAdmin) where.status = "PUBLISHED";

    if (category && typeof category === "string") where.category = category;

    if (q && typeof q === "string" && q.trim()) {
      const term = q.trim();
      where.OR = [
        { title: { contains: term, mode: "insensitive" } },
        { excerpt: { contains: term, mode: "insensitive" } },
        { content: { contains: term, mode: "insensitive" } },
      ];
    }

    const [articles, total] = await Promise.all([
      prisma.article.findMany({
        where,
        orderBy: { publishedAt: "desc" },
        skip,
        take: limitNum,
      }),
      prisma.article.count({ where }),
    ]);

    return res.json({
      articles: articles.map(toPublicListItem),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error("List articles error:", error);
    return res.status(500).json({ error: "Erro ao listar artigos" });
  }
});

router.get("/slug/:slug", async (req, res: Response) => {
  try {
    const slug = String(req.params.slug);
    const article = await prisma.article.findUnique({ where: { slug } });

    if (!article || article.status !== "PUBLISHED") {
      return res.status(404).json({ error: "Artigo não encontrado" });
    }

    return res.json({ article: { ...toPublicListItem(article), content: article.content, conteudo: article.content } });
  } catch (error) {
    console.error("Get article error:", error);
    return res.status(500).json({ error: "Erro ao buscar artigo" });
  }
});

router.get("/admin/all", authMiddleware, async (_req, res: Response) => {
  try {
    const articles = await prisma.article.findMany({ orderBy: { updatedAt: "desc" } });
    return res.json({ articles });
  } catch (error) {
    console.error("Admin list error:", error);
    return res.status(500).json({ error: "Erro ao listar artigos" });
  }
});

router.get("/admin/:id", authMiddleware, async (req, res: Response) => {
  try {
    const id = String(req.params.id);
    const article = await prisma.article.findUnique({ where: { id } });
    if (!article) return res.status(404).json({ error: "Artigo não encontrado" });
    return res.json({ article });
  } catch (error) {
    console.error("Admin get error:", error);
    return res.status(500).json({ error: "Erro ao buscar artigo" });
  }
});

router.post("/", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const data = articleSchema.parse(req.body);
    const baseSlug = data.slug || generateSlug(data.title);
    const slug = await resolveUniqueSlug(baseSlug);
    const status = data.status || "DRAFT";

    const article = await prisma.article.create({
      data: {
        title: data.title,
        slug,
        excerpt: data.excerpt,
        content: data.content,
        coverImage: data.coverImage ?? null,
        category: data.category,
        author: data.author || "Equipe CA Cursos",
        glyph: data.glyph || "📝",
        featured: data.featured ?? false,
        readingTime: data.readingTime || 5,
        seoTitle: data.seoTitle ?? null,
        seoDescription: data.seoDescription ?? null,
        status,
        publishedAt: status === "PUBLISHED" ? new Date() : null,
      },
    });

    return res.status(201).json({ article });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Dados inválidos", details: error.errors });
    }
    console.error("Create article error:", error);
    return res.status(500).json({ error: "Erro ao criar artigo" });
  }
});

router.put("/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const data = articleSchema.partial().parse(req.body);

    const existing = await prisma.article.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Artigo não encontrado" });

    if (data.slug && data.slug !== existing.slug) {
      const slugTaken = await prisma.article.findUnique({ where: { slug: data.slug } });
      if (slugTaken) return res.status(409).json({ error: "Slug já está em uso" });
    }

    const status = data.status ?? existing.status;
    let publishedAt = existing.publishedAt;

    if (status === "PUBLISHED" && !existing.publishedAt) publishedAt = new Date();
    else if (status === "DRAFT") publishedAt = null;

    const article = await prisma.article.update({
      where: { id },
      data: { ...data, publishedAt },
    });

    return res.json({ article });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Dados inválidos", details: error.errors });
    }
    console.error("Update article error:", error);
    return res.status(500).json({ error: "Erro ao atualizar artigo" });
  }
});

router.delete("/:id", authMiddleware, async (req, res: Response) => {
  try {
    const id = String(req.params.id);
    const existing = await prisma.article.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Artigo não encontrado" });

    await prisma.article.delete({ where: { id } });
    return res.json({ message: "Artigo excluído com sucesso" });
  } catch (error) {
    console.error("Delete article error:", error);
    return res.status(500).json({ error: "Erro ao excluir artigo" });
  }
});

export default router;

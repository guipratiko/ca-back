import { Router, Response } from "express";
import slugify from "slugify";
import { z } from "zod";
import { Prisma, ArticleStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, AuthRequest } from "../middleware/auth.js";

const router = Router();

const courseSchema = z.object({
  title: z.string().min(2),
  slug: z.string().min(2).optional(),
  category: z.string().min(2),
  level: z.string().optional(),
  glyph: z.string().optional(),
  badge: z.string().nullable().optional(),
  featured: z.boolean().optional(),
  hours: z.number().int().nonnegative().optional(),
  lessons: z.number().int().nonnegative().optional(),
  students: z.number().int().nonnegative().optional(),
  rating: z.number().nonnegative().optional(),
  reviews: z.number().int().nonnegative().optional(),
  format: z.string().optional(),
  access: z.string().nullable().optional(),
  price: z.number().nonnegative(),
  compareAt: z.number().nonnegative().nullable().optional(),
  installments: z.string().nullable().optional(),
  boleto: z.string().nullable().optional(),
  deposit: z.string().nullable().optional(),
  priceNote: z.string().nullable().optional(),
  link: z.string().nullable().optional(),
  summary: z.string().min(5),
  forWho: z.array(z.string()).optional(),
  learns: z.array(z.string()).optional(),
  benefits: z.array(z.string()).optional(),
  classes: z.array(z.any()).optional(),
  modules: z.array(z.any()).optional(),
  faq: z.array(z.any()).optional(),
  sortOrder: z.number().int().optional(),
  status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
});

function generateSlug(title: string): string {
  return slugify(title, { lower: true, strict: true, locale: "pt" });
}

async function resolveUniqueSlug(baseSlug: string, excludeId?: string): Promise<string> {
  let slug = baseSlug;
  let counter = 2;
  while (true) {
    const existing = await prisma.course.findUnique({ where: { slug } });
    if (!existing || existing.id === excludeId) return slug;
    slug = `${baseSlug}-${counter}`;
    counter++;
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v)).filter((s) => s.trim());
}

function asJsonArray(value: unknown): Prisma.InputJsonValue {
  if (!Array.isArray(value)) return [];
  return value as Prisma.InputJsonValue;
}

/** Formato CA.cursos para o site estático */
function toPublicCurso(course: {
  slug: string;
  title: string;
  category: string;
  level: string;
  glyph: string;
  badge: string | null;
  featured: boolean;
  hours: number;
  lessons: number;
  students: number;
  rating: number;
  reviews: number;
  format: string;
  access: string | null;
  price: number;
  compareAt: number | null;
  installments: string | null;
  boleto: string | null;
  deposit: string | null;
  priceNote: string | null;
  link: string | null;
  summary: string;
  forWho: Prisma.JsonValue;
  learns: Prisma.JsonValue;
  benefits: Prisma.JsonValue;
  classes: Prisma.JsonValue;
  modules: Prisma.JsonValue;
  faq: Prisma.JsonValue;
}) {
  const out: Record<string, unknown> = {
    slug: course.slug,
    titulo: course.title,
    categoria: course.category,
    nivel: course.level,
    glyph: course.glyph,
    destaque: course.featured,
    badge: course.badge || "",
    horas: course.hours,
    aulas: course.lessons,
    alunos: course.students,
    nota: course.rating,
    avaliacoes: course.reviews,
    formato: course.format,
    acesso: course.access,
    preco: course.price,
    precoDe: course.compareAt,
    parcelas: course.installments,
    boleto: course.boleto,
    reserva: course.deposit,
    link: course.link,
    resumo: course.summary,
    para: asStringArray(course.forWho),
    aprende: asStringArray(course.learns),
    beneficios: asStringArray(course.benefits),
    turmas: Array.isArray(course.classes) ? course.classes : [],
    modulos: Array.isArray(course.modules) ? course.modules : [],
    faq: Array.isArray(course.faq) ? course.faq : [],
  };
  if (course.priceNote) out.precoNota = course.priceNote;
  return out;
}

router.get("/public/feed", async (_req, res: Response) => {
  try {
    const courses = await prisma.course.findMany({
      where: { status: "PUBLISHED" },
      orderBy: [{ sortOrder: "asc" }, { featured: "desc" }, { updatedAt: "desc" }],
    });
    return res.json({ cursos: courses.map(toPublicCurso) });
  } catch (error) {
    console.error("Public courses feed error:", error);
    return res.status(500).json({ error: "Erro ao listar cursos" });
  }
});

router.get("/", async (req, res: Response) => {
  try {
    const isAdmin = req.headers.authorization?.startsWith("Bearer ");
    const courses = await prisma.course.findMany({
      where: isAdmin ? undefined : { status: "PUBLISHED" },
      orderBy: [{ sortOrder: "asc" }, { featured: "desc" }, { updatedAt: "desc" }],
    });
    return res.json({ courses });
  } catch (error) {
    console.error("List courses error:", error);
    return res.status(500).json({ error: "Erro ao listar cursos" });
  }
});

router.get("/admin/all", authMiddleware, async (_req, res: Response) => {
  try {
    const courses = await prisma.course.findMany({
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
    });
    return res.json({ courses });
  } catch (error) {
    console.error("Admin list courses error:", error);
    return res.status(500).json({ error: "Erro ao listar cursos" });
  }
});

router.get("/admin/:id", authMiddleware, async (req, res: Response) => {
  try {
    const course = await prisma.course.findUnique({
      where: { id: String(req.params.id) },
    });
    if (!course) return res.status(404).json({ error: "Curso não encontrado" });
    return res.json({ course });
  } catch (error) {
    console.error("Admin get course error:", error);
    return res.status(500).json({ error: "Erro ao buscar curso" });
  }
});

router.post("/", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const data = courseSchema.parse(req.body);
    const slug = await resolveUniqueSlug(data.slug || generateSlug(data.title));
    const status = (data.status || "DRAFT") as ArticleStatus;

    const course = await prisma.course.create({
      data: {
        title: data.title.trim(),
        slug,
        category: data.category.trim(),
        level: data.level?.trim() || "Iniciante",
        glyph: data.glyph?.trim() || "📱",
        badge: data.badge?.trim() || null,
        featured: data.featured ?? false,
        hours: data.hours ?? 0,
        lessons: data.lessons ?? 0,
        students: data.students ?? 0,
        rating: data.rating ?? 0,
        reviews: data.reviews ?? 0,
        format: data.format?.trim() || "",
        access: data.access?.trim() || null,
        price: data.price,
        compareAt: data.compareAt ?? null,
        installments: data.installments?.trim() || null,
        boleto: data.boleto?.trim() || null,
        deposit: data.deposit?.trim() || null,
        priceNote: data.priceNote?.trim() || null,
        link: data.link?.trim() || null,
        summary: data.summary.trim(),
        forWho: asJsonArray(data.forWho),
        learns: asJsonArray(data.learns),
        benefits: asJsonArray(data.benefits),
        classes: asJsonArray(data.classes),
        modules: asJsonArray(data.modules),
        faq: asJsonArray(data.faq),
        sortOrder: data.sortOrder ?? 0,
        status,
      },
    });
    return res.status(201).json({ course });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Dados inválidos", details: error.errors });
    }
    console.error("Create course error:", error);
    return res.status(500).json({ error: "Erro ao criar curso" });
  }
});

router.put("/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const data = courseSchema.partial().parse(req.body);
    const existing = await prisma.course.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Curso não encontrado" });

    let slug = existing.slug;
    if (data.slug && data.slug !== existing.slug) {
      slug = await resolveUniqueSlug(data.slug, id);
    } else if (data.title && data.title !== existing.title && !data.slug) {
      slug = await resolveUniqueSlug(generateSlug(data.title), id);
    }

    const course = await prisma.course.update({
      where: { id },
      data: {
        title: data.title?.trim() ?? existing.title,
        slug,
        category: data.category?.trim() ?? existing.category,
        level: data.level?.trim() ?? existing.level,
        glyph: data.glyph?.trim() ?? existing.glyph,
        badge: data.badge !== undefined ? data.badge?.trim() || null : existing.badge,
        featured: data.featured ?? existing.featured,
        hours: data.hours ?? existing.hours,
        lessons: data.lessons ?? existing.lessons,
        students: data.students ?? existing.students,
        rating: data.rating ?? existing.rating,
        reviews: data.reviews ?? existing.reviews,
        format: data.format !== undefined ? data.format.trim() : existing.format,
        access: data.access !== undefined ? data.access?.trim() || null : existing.access,
        price: data.price ?? existing.price,
        compareAt: data.compareAt !== undefined ? data.compareAt : existing.compareAt,
        installments:
          data.installments !== undefined
            ? data.installments?.trim() || null
            : existing.installments,
        boleto: data.boleto !== undefined ? data.boleto?.trim() || null : existing.boleto,
        deposit: data.deposit !== undefined ? data.deposit?.trim() || null : existing.deposit,
        priceNote:
          data.priceNote !== undefined ? data.priceNote?.trim() || null : existing.priceNote,
        link: data.link !== undefined ? data.link?.trim() || null : existing.link,
        summary: data.summary?.trim() ?? existing.summary,
        forWho: data.forWho !== undefined ? asJsonArray(data.forWho) : undefined,
        learns: data.learns !== undefined ? asJsonArray(data.learns) : undefined,
        benefits: data.benefits !== undefined ? asJsonArray(data.benefits) : undefined,
        classes: data.classes !== undefined ? asJsonArray(data.classes) : undefined,
        modules: data.modules !== undefined ? asJsonArray(data.modules) : undefined,
        faq: data.faq !== undefined ? asJsonArray(data.faq) : undefined,
        sortOrder: data.sortOrder ?? existing.sortOrder,
        status: (data.status ?? existing.status) as ArticleStatus,
      },
    });
    return res.json({ course });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Dados inválidos", details: error.errors });
    }
    console.error("Update course error:", error);
    return res.status(500).json({ error: "Erro ao atualizar curso" });
  }
});

router.delete("/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const existing = await prisma.course.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Curso não encontrado" });
    await prisma.course.delete({ where: { id } });
    return res.json({ message: "Curso excluído" });
  } catch (error) {
    console.error("Delete course error:", error);
    return res.status(500).json({ error: "Erro ao excluir curso" });
  }
});

export default router;

import { Router, Response } from "express";
import slugify from "slugify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, AuthRequest } from "../middleware/auth.js";

const router = Router();

const categorySchema = z.object({
  name: z.string().min(2).max(80),
  slug: z.string().min(2).max(80).optional(),
  sortOrder: z.number().int().optional(),
  active: z.boolean().optional(),
});

function generateSlug(name: string): string {
  return slugify(name, { lower: true, strict: true, locale: "pt" });
}

async function resolveUniqueSlug(baseSlug: string, excludeId?: string): Promise<string> {
  let slug = baseSlug;
  let counter = 2;
  while (true) {
    const existing = await prisma.category.findUnique({ where: { slug } });
    if (!existing || existing.id === excludeId) return slug;
    slug = `${baseSlug}-${counter}`;
    counter++;
  }
}

/** Lista pública (ativas) */
router.get("/", async (_req, res: Response) => {
  try {
    const categories = await prisma.category.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { products: true } } },
    });
    return res.json({ categories });
  } catch (error) {
    console.error("List categories error:", error);
    return res.status(500).json({ error: "Erro ao listar categorias" });
  }
});

router.get("/admin/all", authMiddleware, async (_req, res: Response) => {
  try {
    const categories = await prisma.category.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { products: true } } },
    });
    return res.json({ categories });
  } catch (error) {
    console.error("Admin list categories error:", error);
    return res.status(500).json({ error: "Erro ao listar categorias" });
  }
});

router.get("/admin/:id", authMiddleware, async (req, res: Response) => {
  try {
    const category = await prisma.category.findUnique({
      where: { id: String(req.params.id) },
      include: { _count: { select: { products: true } } },
    });
    if (!category) return res.status(404).json({ error: "Categoria não encontrada" });
    return res.json({ category });
  } catch (error) {
    console.error("Admin get category error:", error);
    return res.status(500).json({ error: "Erro ao buscar categoria" });
  }
});

router.post("/", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const data = categorySchema.parse(req.body);
    const slug = await resolveUniqueSlug(data.slug || generateSlug(data.name));
    const category = await prisma.category.create({
      data: {
        name: data.name.trim(),
        slug,
        sortOrder: data.sortOrder ?? 0,
        active: data.active ?? true,
      },
    });
    return res.status(201).json({ category });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Dados inválidos", details: error.errors });
    }
    console.error("Create category error:", error);
    return res.status(500).json({ error: "Erro ao criar categoria" });
  }
});

router.put("/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const data = categorySchema.partial().parse(req.body);
    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Categoria não encontrada" });

    let slug = existing.slug;
    if (data.slug && data.slug !== existing.slug) {
      slug = await resolveUniqueSlug(data.slug, id);
    } else if (data.name && data.name !== existing.name && !data.slug) {
      slug = await resolveUniqueSlug(generateSlug(data.name), id);
    }

    const category = await prisma.category.update({
      where: { id },
      data: {
        name: data.name?.trim() ?? existing.name,
        slug,
        sortOrder: data.sortOrder ?? existing.sortOrder,
        active: data.active ?? existing.active,
      },
    });

    // Mantém o texto denormalizado nos produtos vinculados
    if (data.name && data.name.trim() !== existing.name) {
      await prisma.product.updateMany({
        where: { categoryId: id },
        data: { category: data.name.trim() },
      });
    }

    return res.json({ category });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Dados inválidos", details: error.errors });
    }
    console.error("Update category error:", error);
    return res.status(500).json({ error: "Erro ao atualizar categoria" });
  }
});

router.delete("/:id", authMiddleware, async (req, res: Response) => {
  try {
    const id = String(req.params.id);
    const existing = await prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (!existing) return res.status(404).json({ error: "Categoria não encontrada" });

    await prisma.product.updateMany({
      where: { categoryId: id },
      data: { categoryId: null },
    });
    await prisma.category.delete({ where: { id } });
    return res.json({
      message: "Categoria excluída com sucesso",
      detachedProducts: existing._count.products,
    });
  } catch (error) {
    console.error("Delete category error:", error);
    return res.status(500).json({ error: "Erro ao excluir categoria" });
  }
});

export default router;

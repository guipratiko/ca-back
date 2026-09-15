import { Router, Response } from "express";
import slugify from "slugify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, AuthRequest } from "../middleware/auth.js";
import { ArticleStatus } from "@prisma/client";

const router = Router();

const productSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2).optional(),
  description: z.string().min(10),
  price: z.number().nonnegative(),
  compareAt: z.number().nonnegative().nullable().optional(),
  image: z.string().nullable().optional(),
  category: z.string().min(2).optional(),
  featured: z.boolean().optional(),
  status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
  buttonLabel: z.string().optional(),
  buttonUrl: z.string().nullable().optional(),
});

function generateSlug(name: string): string {
  return slugify(name, { lower: true, strict: true, locale: "pt" });
}

async function resolveUniqueSlug(baseSlug: string, excludeId?: string): Promise<string> {
  let slug = baseSlug;
  let counter = 2;
  while (true) {
    const existing = await prisma.product.findUnique({ where: { slug } });
    if (!existing || existing.id === excludeId) return slug;
    slug = `${baseSlug}-${counter}`;
    counter++;
  }
}

router.get("/", async (req, res: Response) => {
  try {
    const isAdmin = req.headers.authorization?.startsWith("Bearer ");
    const where: { status?: ArticleStatus; category?: string } = {};
    if (!isAdmin) where.status = "PUBLISHED";
    if (typeof req.query.category === "string") where.category = req.query.category;

    const products = await prisma.product.findMany({
      where,
      orderBy: [{ featured: "desc" }, { updatedAt: "desc" }],
    });
    return res.json({ products });
  } catch (error) {
    console.error("List products error:", error);
    return res.status(500).json({ error: "Erro ao listar produtos" });
  }
});

router.get("/slug/:slug", async (req, res: Response) => {
  try {
    const product = await prisma.product.findUnique({ where: { slug: String(req.params.slug) } });
    if (!product || product.status !== "PUBLISHED") {
      return res.status(404).json({ error: "Produto não encontrado" });
    }
    return res.json({ product });
  } catch (error) {
    console.error("Get product error:", error);
    return res.status(500).json({ error: "Erro ao buscar produto" });
  }
});

router.get("/admin/all", authMiddleware, async (_req, res: Response) => {
  try {
    const products = await prisma.product.findMany({ orderBy: { updatedAt: "desc" } });
    return res.json({ products });
  } catch (error) {
    console.error("Admin list products error:", error);
    return res.status(500).json({ error: "Erro ao listar produtos" });
  }
});

router.get("/admin/:id", authMiddleware, async (req, res: Response) => {
  try {
    const product = await prisma.product.findUnique({ where: { id: String(req.params.id) } });
    if (!product) return res.status(404).json({ error: "Produto não encontrado" });
    return res.json({ product });
  } catch (error) {
    console.error("Admin get product error:", error);
    return res.status(500).json({ error: "Erro ao buscar produto" });
  }
});

router.post("/", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const data = productSchema.parse(req.body);
    const slug = await resolveUniqueSlug(data.slug || generateSlug(data.name));
    const status = data.status || "DRAFT";

    const product = await prisma.product.create({
      data: {
        name: data.name,
        slug,
        description: data.description,
        price: data.price,
        compareAt: data.compareAt ?? null,
        image: data.image ?? null,
        category: data.category || "Geral",
        featured: data.featured ?? false,
        status,
        buttonLabel: data.buttonLabel || "Quero este produto",
        buttonUrl: data.buttonUrl ?? null,
      },
    });

    return res.status(201).json({ product });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Dados inválidos", details: error.errors });
    }
    console.error("Create product error:", error);
    return res.status(500).json({ error: "Erro ao criar produto" });
  }
});

router.put("/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const data = productSchema.partial().parse(req.body);
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Produto não encontrado" });

    if (data.slug && data.slug !== existing.slug) {
      const taken = await prisma.product.findUnique({ where: { slug: data.slug } });
      if (taken) return res.status(409).json({ error: "Slug já está em uso" });
    }

    const product = await prisma.product.update({
      where: { id },
      data,
    });
    return res.json({ product });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Dados inválidos", details: error.errors });
    }
    console.error("Update product error:", error);
    return res.status(500).json({ error: "Erro ao atualizar produto" });
  }
});

router.delete("/:id", authMiddleware, async (req, res: Response) => {
  try {
    const id = String(req.params.id);
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Produto não encontrado" });
    await prisma.product.delete({ where: { id } });
    return res.json({ message: "Produto excluído com sucesso" });
  } catch (error) {
    console.error("Delete product error:", error);
    return res.status(500).json({ error: "Erro ao excluir produto" });
  }
});

export default router;

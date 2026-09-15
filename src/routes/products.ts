import { Router, Response } from "express";
import slugify from "slugify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, AuthRequest } from "../middleware/auth.js";
import { ArticleStatus, Prisma } from "@prisma/client";

const router = Router();

const productInclude = {
  categoryRef: { select: { id: true, name: true, slug: true } },
} as const;

const productSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2).optional(),
  description: z.string().min(10),
  price: z.number().nonnegative(),
  compareAt: z.number().nonnegative().nullable().optional(),
  image: z.string().nullable().optional(),
  images: z.array(z.string().min(1)).optional(),
  category: z.string().min(2).optional(),
  categoryId: z.string().nullable().optional(),
  featured: z.boolean().optional(),
  status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
  buttonLabel: z.string().optional(),
  buttonUrl: z.string().nullable().optional(),
  reference: z.string().min(1).max(80).nullable().optional(),
});

function generateSlug(name: string): string {
  return slugify(name, { lower: true, strict: true, locale: "pt" });
}

function normalizeImages(images?: string[] | null, image?: string | null): string[] {
  const list = [...(images || [])].map((u) => u.trim()).filter(Boolean);
  if (image?.trim() && !list.includes(image.trim())) list.unshift(image.trim());
  return [...new Set(list)];
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

async function resolveCategoryFields(input: {
  categoryId?: string | null;
  category?: string;
}): Promise<{ categoryId: string | null; category: string }> {
  if (input.categoryId) {
    const cat = await prisma.category.findUnique({ where: { id: input.categoryId } });
    if (!cat) {
      const err = new Error("Categoria inválida");
      (err as Error & { status: number }).status = 400;
      throw err;
    }
    return { categoryId: cat.id, category: cat.name };
  }
  if (input.categoryId === null) {
    return { categoryId: null, category: input.category?.trim() || "Geral" };
  }
  return { categoryId: null, category: input.category?.trim() || "Geral" };
}

function httpErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

router.get("/", async (req, res: Response) => {
  try {
    const isAdmin = req.headers.authorization?.startsWith("Bearer ");
    const where: Prisma.ProductWhereInput = {};
    if (!isAdmin) where.status = "PUBLISHED";

    if (typeof req.query.categoryId === "string" && req.query.categoryId) {
      where.categoryId = req.query.categoryId;
    } else if (typeof req.query.category === "string" && req.query.category) {
      where.OR = [
        { category: req.query.category },
        { categoryRef: { slug: req.query.category } },
        { categoryRef: { name: req.query.category } },
      ];
    }

    const minPrice = req.query.minPrice != null ? Number(req.query.minPrice) : undefined;
    const maxPrice = req.query.maxPrice != null ? Number(req.query.maxPrice) : undefined;
    if (
      (minPrice != null && Number.isFinite(minPrice)) ||
      (maxPrice != null && Number.isFinite(maxPrice))
    ) {
      where.price = {};
      if (minPrice != null && Number.isFinite(minPrice)) where.price.gte = minPrice;
      if (maxPrice != null && Number.isFinite(maxPrice)) where.price.lte = maxPrice;
    }

    const products = await prisma.product.findMany({
      where,
      include: productInclude,
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
    const product = await prisma.product.findUnique({
      where: { slug: String(req.params.slug) },
      include: productInclude,
    });
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
    const products = await prisma.product.findMany({
      include: productInclude,
      orderBy: { updatedAt: "desc" },
    });
    return res.json({ products });
  } catch (error) {
    console.error("Admin list products error:", error);
    return res.status(500).json({ error: "Erro ao listar produtos" });
  }
});

router.get("/admin/:id", authMiddleware, async (req, res: Response) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: String(req.params.id) },
      include: productInclude,
    });
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
    const images = normalizeImages(data.images, data.image);
    const cats = await resolveCategoryFields({
      categoryId: data.categoryId,
      category: data.category,
    });

    const product = await prisma.product.create({
      data: {
        name: data.name,
        slug,
        description: data.description,
        price: data.price,
        compareAt: data.compareAt ?? null,
        image: images[0] ?? null,
        images,
        category: cats.category,
        categoryId: cats.categoryId,
        featured: data.featured ?? false,
        status,
        buttonLabel: data.buttonLabel || "Quero este produto",
        buttonUrl: data.buttonUrl ?? null,
        reference: data.reference?.trim() || null,
      },
      include: productInclude,
    });

    return res.status(201).json({ product });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Dados inválidos", details: error.errors });
    }
    if (error instanceof Error && "status" in error) {
      return res.status(400).json({ error: httpErrorMessage(error, "Categoria inválida") });
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

    const patch: Prisma.ProductUpdateInput = {
      name: data.name,
      slug: data.slug,
      description: data.description,
      price: data.price,
      compareAt: data.compareAt,
      featured: data.featured,
      status: data.status as ArticleStatus | undefined,
      buttonLabel: data.buttonLabel,
      buttonUrl: data.buttonUrl,
      reference: data.reference === undefined ? undefined : data.reference?.trim() || null,
    };

    if (data.images !== undefined || data.image !== undefined) {
      const images = normalizeImages(
        data.images ?? existing.images,
        data.image !== undefined ? data.image : existing.image
      );
      patch.images = images;
      patch.image = images[0] ?? null;
    }

    if (data.categoryId !== undefined || data.category !== undefined) {
      const cats = await resolveCategoryFields({
        categoryId: data.categoryId,
        category: data.category,
      });
      patch.category = cats.category;
      patch.categoryRef = cats.categoryId
        ? { connect: { id: cats.categoryId } }
        : { disconnect: true };
    }

    const product = await prisma.product.update({
      where: { id },
      data: patch,
      include: productInclude,
    });
    return res.json({ product });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Dados inválidos", details: error.errors });
    }
    if (error instanceof Error && "status" in error) {
      return res.status(400).json({ error: httpErrorMessage(error, "Categoria inválida") });
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

import { Router, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, AuthRequest } from "../middleware/auth.js";

const router = Router();

export const DEFAULT_HOME_HERO = {
  eyebrow: "CA Cursos · Nota 4,8 no Google · +850 avaliações",
  titleBefore: "Em ",
  titleHighlight: "40 horas",
  titleAfter: ", você sai da teoria e começa a cobrar pelo primeiro conserto.",
  lead:
    "Bancada individual em Goiânia ou formação 100% online com 1 ano de acesso - você escolhe o formato, o conteúdo é o mesmo. Garantia de resultado em 60 dias.",
  primaryCtaLabel: "Ver cursos e valores",
  primaryCtaHref: "cursos.html",
  secondaryCtaLabel: "Assistir aula grátis",
  secondaryCtaHref: "aulas.html",
  proof: [
    { label: "Presencial", detail: "bancada individual" },
    { label: "Online", detail: "1 ano de acesso" },
    { label: "40h", detail: "curso iniciante" },
    { label: "60 dias", detail: "garantia de resultado" },
  ],
};

export const DEFAULT_PRODUCTS_BANNER = {
  imageUrl: "",
  eyebrow: "CA Tools · Vitrine oficial",
  titleBefore: "Produtos para a ",
  titleHighlight: "bancada",
  titleAfter: "",
  lead:
    "Kits, ferramentas e itens selecionados para quem está começando ou evoluindo na manutenção de celulares - no mesmo padrão visual do site.",
  primaryCtaLabel: "Ver produtos",
  primaryCtaHref: "#vitrine",
  secondaryCtaLabel: "Falar no WhatsApp",
};

const proofItemSchema = z.object({
  label: z.string().min(1),
  detail: z.string().min(1),
});

const homeHeroSchema = z.object({
  eyebrow: z.string().min(1),
  titleBefore: z.string(),
  titleHighlight: z.string().min(1),
  titleAfter: z.string(),
  lead: z.string().min(1),
  primaryCtaLabel: z.string().min(1),
  primaryCtaHref: z.string().min(1),
  secondaryCtaLabel: z.string().min(1),
  secondaryCtaHref: z.string().min(1),
  proof: z.array(proofItemSchema).min(1).max(6),
});

const productsBannerSchema = z.object({
  imageUrl: z.string().optional().nullable(),
  eyebrow: z.string().min(1),
  titleBefore: z.string(),
  titleHighlight: z.string().min(1),
  titleAfter: z.string().optional().nullable(),
  lead: z.string().min(1),
  primaryCtaLabel: z.string().min(1),
  primaryCtaHref: z.string().min(1),
  secondaryCtaLabel: z.string().min(1),
});

async function getOrDefault(key: string, fallback: object) {
  const row = await prisma.siteSetting.findUnique({ where: { key } });
  if (!row) return fallback;
  return { ...fallback, ...(row.value as object) };
}

router.get("/public", async (_req, res: Response) => {
  try {
    const [homeHero, productsBanner] = await Promise.all([
      getOrDefault("homeHero", DEFAULT_HOME_HERO),
      getOrDefault("productsBanner", DEFAULT_PRODUCTS_BANNER),
    ]);
    return res.json({ homeHero, productsBanner });
  } catch (error) {
    console.error("Public settings error:", error);
    return res.status(500).json({ error: "Erro ao carregar conteúdo" });
  }
});

router.get("/admin", authMiddleware, async (_req, res: Response) => {
  try {
    const [homeHero, productsBanner] = await Promise.all([
      getOrDefault("homeHero", DEFAULT_HOME_HERO),
      getOrDefault("productsBanner", DEFAULT_PRODUCTS_BANNER),
    ]);
    return res.json({ homeHero, productsBanner });
  } catch (error) {
    console.error("Admin settings error:", error);
    return res.status(500).json({ error: "Erro ao carregar conteúdo" });
  }
});

router.put("/home-hero", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const value = homeHeroSchema.parse(req.body);
    const setting = await prisma.siteSetting.upsert({
      where: { key: "homeHero" },
      update: { value },
      create: { key: "homeHero", value },
    });
    return res.json({ homeHero: setting.value });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Dados inválidos", details: error.errors });
    }
    console.error("Update home hero error:", error);
    return res.status(500).json({ error: "Erro ao salvar hero" });
  }
});

router.put("/products-banner", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = productsBannerSchema.parse(req.body);
    const value = {
      ...parsed,
      imageUrl: parsed.imageUrl?.trim() || "",
      titleAfter: parsed.titleAfter ?? "",
    };
    const setting = await prisma.siteSetting.upsert({
      where: { key: "productsBanner" },
      update: { value },
      create: { key: "productsBanner", value },
    });
    return res.json({ productsBanner: setting.value });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Dados inválidos", details: error.errors });
    }
    console.error("Update products banner error:", error);
    return res.status(500).json({ error: "Erro ao salvar banner" });
  }
});

export default router;

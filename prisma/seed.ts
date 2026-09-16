import "dotenv/config";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../src/lib/prisma.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readingMins(label: string): number {
  const n = parseInt(String(label).replace(/\D/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

function fallbackHtml(resumo: string): string {
  return `<p>${resumo}</p>
<h2>Por que isso importa na prática</h2>
<p>Este é um dos temas que mais aparecem nas dúvidas dos nossos alunos.</p>
<h2>Próximo passo</h2>
<p>Fale com a CA Cursos no WhatsApp e descubra qual trilha faz sentido para o seu nível.</p>`;
}

async function main() {
  const email = process.env.ADMIN_EMAIL || "admin@cacursos.com.br";
  const password = process.env.ADMIN_PASSWORD || "cacursos-admin";
  const name = process.env.ADMIN_NAME || "Admin CA Cursos";

  const hash = await bcrypt.hash(password, 10);
  await prisma.user.upsert({
    where: { email },
    update: { password: hash, name },
    create: { email, password: hash, name },
  });
  console.log(`Admin: ${email}`);

  const seedPath = path.join(__dirname, "seed-articles.json");
  const raw = JSON.parse(fs.readFileSync(seedPath, "utf8")) as {
    posts: Array<{
      slug: string;
      glyph: string;
      categoria: string;
      destaque: boolean;
      titulo: string;
      resumo: string;
      data: string;
      leitura: string;
      autor: string;
    }>;
    conteudo: Record<string, string>;
  };

  for (const p of raw.posts) {
    const content = raw.conteudo[p.slug] || fallbackHtml(p.resumo);
    const publishedAt = p.data ? new Date(`${p.data}T12:00:00.000Z`) : new Date();

    await prisma.article.upsert({
      where: { slug: p.slug },
      update: {
        title: p.titulo,
        excerpt: p.resumo,
        content,
        category: p.categoria,
        author: p.autor,
        glyph: p.glyph,
        featured: !!p.destaque,
        readingTime: readingMins(p.leitura),
        status: "PUBLISHED",
        publishedAt,
      },
      create: {
        title: p.titulo,
        slug: p.slug,
        excerpt: p.resumo,
        content,
        category: p.categoria,
        author: p.autor,
        glyph: p.glyph,
        featured: !!p.destaque,
        readingTime: readingMins(p.leitura),
        status: "PUBLISHED",
        publishedAt,
      },
    });
    console.log(`Artigo: ${p.slug}`);
  }

  const lessonsPath = path.join(__dirname, "seed-lessons.json");
  const lessons = JSON.parse(fs.readFileSync(lessonsPath, "utf8")) as Array<{
    slug: string;
    youtubeId: string;
    title: string;
    category: string;
    duration: string;
    views: string;
    data: string;
    description: string;
    sortOrder: number;
  }>;

  for (const a of lessons) {
    const publishedAt = a.data ? new Date(`${a.data}T12:00:00.000Z`) : new Date();
    await prisma.openLesson.upsert({
      where: { slug: a.slug },
      update: {
        title: a.title,
        description: a.description,
        youtubeId: a.youtubeId,
        category: a.category,
        duration: a.duration,
        views: a.views,
        sortOrder: a.sortOrder,
        status: "PUBLISHED",
        publishedAt,
      },
      create: {
        slug: a.slug,
        title: a.title,
        description: a.description,
        youtubeId: a.youtubeId,
        category: a.category,
        duration: a.duration,
        views: a.views,
        sortOrder: a.sortOrder,
        status: "PUBLISHED",
        publishedAt,
      },
    });
    console.log(`Aula: ${a.slug}`);
  }

  console.log("Seed concluído.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

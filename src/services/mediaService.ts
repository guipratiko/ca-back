interface MediaServiceUploadResponse {
  success?: boolean;
  fullUrl?: string;
  url?: string;
  message?: string;
  error?: string;
}

function getMediaServiceConfig() {
  const baseUrl = (process.env.MEDIA_SERVICE_URL || "").replace(/\/$/, "");
  const token = process.env.MEDIA_SERVICE_TOKEN || "";
  return { baseUrl, token };
}

export function isMediaServiceConfigured(): boolean {
  const { baseUrl, token } = getMediaServiceConfig();
  return Boolean(baseUrl && token);
}

export async function uploadFileToMediaService(
  buffer: Buffer,
  originalName: string,
  mimetype: string
): Promise<string> {
  const { baseUrl, token } = getMediaServiceConfig();

  if (!baseUrl || !token) {
    throw new Error(
      "Media Service não configurado. Defina MEDIA_SERVICE_URL e MEDIA_SERVICE_TOKEN."
    );
  }

  const extension = originalName.includes(".")
    ? originalName.split(".").pop()
    : "bin";
  const fileName = `cacursos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;

  const formData = new FormData();
  formData.append(
    "file",
    new Blob([new Uint8Array(buffer)], { type: mimetype }),
    fileName
  );

  const response = await fetch(`${baseUrl}/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  const data = (await response.json().catch(() => null)) as MediaServiceUploadResponse | null;

  if (!response.ok || !data?.success) {
    throw new Error(
      data?.message || data?.error || "Falha ao enviar arquivo para o Media Service."
    );
  }

  const url = data.fullUrl || data.url;
  if (!url) {
    throw new Error("Media Service não retornou a URL do arquivo.");
  }

  return normalizeMediaUrl(url);
}

function normalizeMediaUrl(url: string): string {
  let normalized = url.startsWith("http") ? url : `https://${url.replace(/^\/+/, "")}`;

  if (normalized.startsWith("http://") && !normalized.includes("localhost")) {
    normalized = normalized.replace("http://", "https://");
  }

  return normalized;
}

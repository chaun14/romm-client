import { Gamepad2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { buildImageUrl, platformSlug } from "../../lib/format";
import type { Platform } from "../../types";
import { RetryImage } from "../common/RemoteImage";

export function PlatformImage({ platform, baseUrl }: { platform: Platform; baseUrl: string }) {
  const slug = platformSlug(platform);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const candidates = useMemo(() => {
    const values = [slug ? `${baseUrl}/assets/platforms/${slug}.svg` : "", slug ? `${baseUrl}/assets/platforms/${slug}.ico` : ""].filter(Boolean) as string[];
    return Array.from(new Set(values.map((value) => buildImageUrl(value, baseUrl))));
  }, [baseUrl, slug]);

  useEffect(() => {
    setCandidateIndex(0);
  }, [candidates]);

  if (!candidates.length) {
    return <Gamepad2 className="h-10 w-10 text-brand-soft" />;
  }

  return (
    <RetryImage
      src={candidates[candidateIndex]}
      alt={platform.display_name || platform.name || slug || "Platform"}
      className="h-full w-full object-contain"
      fallbackClassName="h-10 w-10 text-brand-soft"
      fallback={<Gamepad2 className="h-10 w-10 text-brand-soft" />}
      onFailed={() => {
        setCandidateIndex((current) => (current < candidates.length - 1 ? current + 1 : current));
      }}
    />
  );
}

import { Gamepad2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { ImageProps } from "../../types";

export function useRemoteImage(src: string) {
  const [dataUrl, setDataUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!src) {
      setDataUrl("");
      setFailed(false);
      return;
    }

    setDataUrl("");
    setFailed(false);

    api.images
      .fetchDataUrl(src)
      .then((result) => {
        if (cancelled) return;
        if (result.success && result.data) {
          setDataUrl(result.data);
        } else {
          setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [src]);

  return { dataUrl, failed };
}

export function RemoteImage({ src, alt, className, fallbackClassName, fallback }: ImageProps) {
  const { dataUrl, failed } = useRemoteImage(src);

  if (failed) return fallback ? <>{fallback}</> : <Gamepad2 className={fallbackClassName} />;
  if (!dataUrl) return <div className="h-full w-full animate-pulse bg-panel-soft" />;

  return <img src={dataUrl} alt={alt} className={className} />;
}

export function RetryImage(props: ImageProps & { onFailed: () => void }) {
  const { dataUrl, failed } = useRemoteImage(props.src);

  useEffect(() => {
    if (failed) props.onFailed();
  }, [failed, props]);

  if (failed) return <>{props.fallback}</>;
  if (!dataUrl) return <div className="h-full w-full animate-pulse rounded bg-panel-soft" />;

  return <img src={dataUrl} alt={props.alt} className={props.className} />;
}

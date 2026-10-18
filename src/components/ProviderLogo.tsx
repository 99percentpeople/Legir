import { useState } from "react";
import { Network } from "lucide-react";

import { isAiProviderId } from "@/services/ai/providers/catalog";
import { cn } from "@/utils/cn";

function CatalogLogo({ catalogId }: { catalogId: string }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    "loading",
  );

  return (
    <>
      {status !== "loaded" && (
        <Network aria-hidden className="col-start-1 row-start-1 size-full" />
      )}
      {status !== "error" && (
        <img
          src={`https://models.dev/logos/${encodeURIComponent(catalogId)}.svg`}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className={cn(
            "col-start-1 row-start-1 size-full object-contain dark:invert",
            status !== "loaded" && "opacity-0",
          )}
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
        />
      )}
    </>
  );
}

export function ProviderLogo(props: {
  /** The models.dev provider ID, independent of the saved connection ID. */
  catalogId?: string;
  className?: string;
  size?: number | string;
  title?: string;
}) {
  const { catalogId, className, size = 14, title } = props;

  return (
    <span
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      title={title}
      className={cn(
        "inline-grid shrink-0 place-items-center align-middle",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {catalogId && isAiProviderId(catalogId) ? (
        <CatalogLogo key={catalogId} catalogId={catalogId} />
      ) : (
        <Network aria-hidden className="size-full" />
      )}
    </span>
  );
}

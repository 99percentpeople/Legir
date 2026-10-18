import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
} from "react";
import { ChevronDown, Loader2, Plus, RefreshCw } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { ProviderLogo } from "@/components/ProviderLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getModelsDevProviders,
  getModelsDevRevision,
  initializeModelsDev,
  refreshModelsDev,
  subscribeModelsDev,
} from "@/services/ai/providers/modelsDev";
import type { AiProviderSpec } from "@/services/ai/providers/catalog";

export function AddAiConnection({
  onAdd,
}: {
  onAdd: (provider?: AiProviderSpec) => void;
}) {
  const { t } = useLanguage();
  useSyncExternalStore(subscribeModelsDev, getModelsDevRevision);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() =>
      searchRef.current?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [open]);
  useEffect(() => {
    void initializeModelsDev();
    void refreshModelsDev().catch(() => setError(true));
  }, []);
  const refresh = async () => {
    setRefreshing(true);
    setError(false);
    try {
      await refreshModelsDev({ force: true });
    } catch {
      setError(true);
    } finally {
      setRefreshing(false);
    }
  };
  const preserveSearchFocus = (event: PointerEvent<HTMLDivElement>) => {
    if (document.activeElement === searchRef.current) event.preventDefault();
  };
  const providers = getModelsDevProviders().filter((spec) =>
    `${spec.label} ${spec.id}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <DropdownMenu
          open={open}
          onOpenChange={(value) => {
            setOpen(value);
            if (!value) setQuery("");
          }}
        >
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              <Plus className="h-4 w-4" />
              {t("settings.llm.add_connection")}
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            ref={menuRef}
            align="start"
            className="flex w-72 max-w-[calc(100vw-2rem)] flex-col overflow-hidden"
            aria-label={t("settings.llm.choose_provider")}
          >
            <div className="p-1">
              <Input
                ref={searchRef}
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("settings.llm.search_providers")}
                aria-label={t("settings.llm.search_providers")}
                className="h-8"
                onKeyDown={(event) => {
                  if (event.key === "Escape" || event.key === "Tab") return;
                  event.stopPropagation();
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    const items =
                      menuRef.current?.querySelectorAll<HTMLElement>(
                        '[role="menuitem"]',
                      );
                    (event.key === "ArrowDown"
                      ? items?.[0]
                      : items?.[items.length - 1]
                    )?.focus();
                  }
                }}
              />
            </div>
            <div className="max-h-64 min-h-0 overflow-y-auto">
              {providers.map((spec) => (
                <DropdownMenuItem
                  key={spec.id}
                  onSelect={() => onAdd(spec)}
                  onPointerMove={preserveSearchFocus}
                >
                  <ProviderLogo catalogId={spec.id} size={16} />
                  <span className="truncate">{spec.label}</span>
                </DropdownMenuItem>
              ))}
              {!providers.length && (
                <p className="text-muted-foreground p-2 text-xs">
                  {t("settings.llm.no_providers")}
                </p>
              )}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => onAdd()}
              onPointerMove={preserveSearchFocus}
            >
              <Plus className="h-4 w-4" />
              {t("settings.llm.custom_connection")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void refresh()}
          disabled={refreshing}
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {t("settings.llm.refresh_catalog")}
        </Button>
      </div>
      {error && (
        <p role="status" className="text-muted-foreground text-xs">
          {t("settings.llm.catalog_offline")}
        </p>
      )}
    </div>
  );
}

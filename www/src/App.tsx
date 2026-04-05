import React from "react";
import { ArrowRight, FileText, Shield, Sparkles } from "lucide-react";
import { FeatureCard } from "@/components/home/FeatureCard";
import { HomeHeader } from "@/components/home/HomeHeader";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";

const resolveAppUrl = () => {
  const configuredUrl = import.meta.env.VITE_APP_URL?.trim();
  if (configuredUrl) return configuredUrl;
  if (typeof window === "undefined") return "/";

  const { protocol, host, hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://localhost:5173";
  }

  if (host.startsWith("www.")) {
    return `${protocol}//app.${host.slice(4)}`;
  }

  return `${protocol}//app.${host}`;
};

const App: React.FC = () => {
  const { t } = useLanguage();

  const handleOpenApp = React.useCallback(() => {
    window.location.href = resolveAppUrl();
  }, []);

  return (
    <div className="bg-background flex min-h-screen flex-col transition-colors duration-200">
      <HomeHeader />

      <div className="flex flex-1 flex-col items-center justify-center gap-12 p-6 pt-24">
        <div className="animate-in fade-in slide-in-from-bottom-4 max-w-3xl space-y-4 text-center duration-700">
          <h1 className="from-primary bg-linear-to-r to-blue-600 bg-clip-text pb-2 text-4xl font-extrabold tracking-tight text-transparent lg:text-6xl">
            {t("home.title")}
          </h1>
          <p className="text-muted-foreground text-xl">{t("home.subtitle")}</p>
        </div>

        <div className="animate-in fade-in slide-in-from-bottom-8 flex flex-col items-center gap-4 delay-150 duration-700">
          <Button size="lg" className="gap-2 shadow-lg" onClick={handleOpenApp}>
            {t("home.desktop.open_pdf")}
            <ArrowRight size={18} />
          </Button>
        </div>

        <div className="animate-in fade-in slide-in-from-bottom-8 mt-4 grid w-full max-w-5xl grid-cols-1 gap-6 delay-300 duration-700 md:grid-cols-3">
          <FeatureCard
            icon={<Sparkles className="text-purple-500" size={24} />}
            title={t("home.feature.ai.title")}
            desc={t("home.feature.ai.desc")}
          />
          <FeatureCard
            icon={<FileText className="text-blue-500" size={24} />}
            title={t("home.feature.editor.title")}
            desc={t("home.feature.editor.desc")}
          />
          <FeatureCard
            icon={<Shield className="text-green-500" size={24} />}
            title={t("home.feature.local.title")}
            desc={t("home.feature.local.desc")}
          />
        </div>
      </div>

      <div className="text-muted-foreground border-border bg-muted/20 border-t py-6 text-center text-sm">
        <p>
          {t("home.footer.copyright", {
            year: new Date().getFullYear(),
            appName: process.env.APP_NAME,
          })}
        </p>
      </div>
    </div>
  );
};

export default App;

import { FileText, History, Shield, Sparkles } from "lucide-react";
import PDFUploader from "@/components/PDFUploader";
import { Button } from "@/components/ui/button";
import { FeatureCard } from "./FeatureCard";
import { LandingHeader } from "./LandingHeader";
import type { LandingTranslation } from "./types";

interface WebLandingViewProps {
  hasSavedSession?: boolean;
  onOpen?: () => Promise<void>;
  onResume?: () => void;
  onUpload: (file: File) => void;
  t: LandingTranslation;
}

export function WebLandingView({
  hasSavedSession,
  onOpen,
  onResume,
  onUpload,
  t,
}: WebLandingViewProps) {
  return (
    <div className="bg-background flex min-h-screen flex-col transition-colors duration-200">
      <LandingHeader />

      <div className="flex flex-1 flex-col items-center justify-center gap-12 p-6 pt-24">
        <div className="animate-in fade-in slide-in-from-bottom-4 max-w-3xl space-y-4 text-center duration-700">
          <h1 className="from-primary bg-linear-to-r to-blue-600 bg-clip-text pb-2 text-4xl font-extrabold tracking-tight text-transparent lg:text-6xl">
            {t("landing.title")}
          </h1>
          <p className="text-muted-foreground text-xl">
            {t("landing.subtitle")}
          </p>
        </div>

        <div className="animate-in fade-in slide-in-from-bottom-8 flex w-full max-w-2xl flex-col items-center gap-4 delay-150 duration-700">
          <PDFUploader onUpload={onUpload} onOpen={onOpen} />

          {hasSavedSession && onResume ? (
            <Button
              onClick={onResume}
              variant="outline"
              className="border-primary/50 hover:border-primary text-primary mt-2 w-full gap-2 border-dashed md:w-auto"
            >
              <History size={16} />
              {t("landing.resume_session")}
            </Button>
          ) : null}
        </div>

        <div className="animate-in fade-in slide-in-from-bottom-8 mt-4 grid w-full max-w-5xl grid-cols-1 gap-6 delay-300 duration-700 md:grid-cols-3">
          <FeatureCard
            icon={<Sparkles className="text-purple-500" size={24} />}
            title={t("landing.feature.ai.title")}
            desc={t("landing.feature.ai.desc")}
          />
          <FeatureCard
            icon={<FileText className="text-blue-500" size={24} />}
            title={t("landing.feature.editor.title")}
            desc={t("landing.feature.editor.desc")}
          />
          <FeatureCard
            icon={<Shield className="text-green-500" size={24} />}
            title={t("landing.feature.local.title")}
            desc={t("landing.feature.local.desc")}
          />
        </div>
      </div>

      <div className="text-muted-foreground border-border bg-muted/20 border-t py-6 text-center text-sm">
        <p>
          {t("landing.footer.copyright", {
            year: new Date().getFullYear(),
            appName: process.env.APP_NAME,
          })}
        </p>
      </div>
    </div>
  );
}

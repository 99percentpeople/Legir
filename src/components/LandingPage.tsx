import React from "react";
import {
  Sparkles,
  FileText,
  Shield,
  FileType,
  Globe,
  Check,
  History,
} from "lucide-react";
import { Button } from "./ui/button";
import { ModeToggle } from "./toolbar/mode-toggle";
import { LanguageToggle } from "./toolbar/language-toggle";
import PDFUploader from "./PDFUploader";
import { useLanguage } from "./language-provider";

interface LandingPageProps {
  onUpload: (file: File) => void;
  hasSavedSession?: boolean;
  onResume?: () => void;
}

const LandingPage: React.FC<LandingPageProps> = ({
  onUpload,
  hasSavedSession,
  onResume,
}) => {
  const { t, language, setLanguage } = useLanguage();

  return (
    <div className="bg-background flex min-h-screen flex-col transition-colors duration-200">
      {/* Header */}
      <div className="border-border bg-card/50 fixed top-0 z-50 flex h-16 w-full items-center justify-between border-b px-6 backdrop-blur-sm">
        <div className="text-foreground flex items-center gap-2 text-xl font-bold">
          <div className="bg-primary text-primary-foreground rounded-md p-1.5">
            <FileType size={20} strokeWidth={2.5} />
          </div>
          <span>FormForge AI</span>
        </div>
        <div className="flex items-center gap-2">
          <LanguageToggle />
          <ModeToggle />
        </div>
      </div>

      {/* Main Content */}
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
          <PDFUploader onUpload={onUpload} />

          {hasSavedSession && onResume && (
            <Button
              onClick={onResume}
              variant="outline"
              className="border-primary/50 hover:border-primary text-primary mt-2 w-full gap-2 border-dashed md:w-auto"
            >
              <History size={16} />
              {t("landing.resume_session")}
            </Button>
          )}
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

      {/* Footer */}
      <div className="text-muted-foreground border-border bg-muted/20 border-t py-6 text-center text-sm">
        <p>
          &copy; {new Date().getFullYear()} FormForge AI. All rights reserved.
        </p>
      </div>
    </div>
  );
};

const FeatureCard = ({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) => (
  <div className="bg-card hover:bg-accent/50 border-border group flex flex-col items-center gap-3 rounded-xl border p-6 text-center transition-colors">
    <div className="bg-background ring-border rounded-full p-3 shadow-sm ring-1 transition-transform duration-300 group-hover:scale-110">
      {icon}
    </div>
    <h3 className="text-lg font-semibold">{title}</h3>
    <p className="text-muted-foreground text-sm leading-relaxed">{desc}</p>
  </div>
);

export default LandingPage;

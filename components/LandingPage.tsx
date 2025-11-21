
import React from 'react';
import { Sparkles, FileText, Shield, FileType, Globe, Check } from 'lucide-react';
import { Button } from './ui/button';
import { ModeToggle } from './mode-toggle';
import PDFUploader from './PDFUploader';
import { useLanguage } from './language-provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

interface LandingPageProps {
  onUpload: (file: File) => void;
}

const LandingPage: React.FC<LandingPageProps> = ({ onUpload }) => {
  const { t, language, setLanguage } = useLanguage();

  return (
    <div className="min-h-screen bg-background flex flex-col transition-colors duration-200">
      {/* Header */}
      <div className="h-16 border-b border-border flex items-center justify-between px-6 bg-card/50 backdrop-blur-sm fixed top-0 w-full z-50">
        <div className="flex items-center gap-2 font-bold text-xl text-foreground">
            <div className="bg-primary text-primary-foreground p-1.5 rounded-md">
                <FileType size={20} strokeWidth={2.5} />
            </div>
            <span>FormForge AI</span>
        </div>
        <div className="flex items-center gap-2">
           <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                title={t('settings.language')}
              >
                <Globe size={20} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setLanguage('en')} className="justify-between">
                English
                {language === 'en' && <Check size={14} />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLanguage('zh')} className="justify-between">
                中文
                {language === 'zh' && <Check size={14} />}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

           <ModeToggle />
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 pt-24 gap-12">
         <div className="text-center space-y-4 max-w-3xl animate-in fade-in slide-in-from-bottom-4 duration-700">
            <h1 className="text-4xl font-extrabold tracking-tight lg:text-6xl bg-gradient-to-r from-primary to-blue-600 bg-clip-text text-transparent pb-2">
               {t('landing.title')}
            </h1>
            <p className="text-xl text-muted-foreground">
               {t('landing.subtitle')}
            </p>
         </div>
         
         <div className="w-full max-w-2xl animate-in fade-in slide-in-from-bottom-8 duration-700 delay-150">
            <PDFUploader onUpload={onUpload} />
         </div>
         
         <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl w-full mt-4 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-300">
            <FeatureCard 
                icon={<Sparkles className="text-purple-500" size={24} />}
                title={t('landing.feature.ai.title')}
                desc={t('landing.feature.ai.desc')}
            />
             <FeatureCard 
                icon={<FileText className="text-blue-500" size={24} />}
                title={t('landing.feature.editor.title')}
                desc={t('landing.feature.editor.desc')}
            />
             <FeatureCard 
                icon={<Shield className="text-green-500" size={24} />}
                title={t('landing.feature.local.title')}
                desc={t('landing.feature.local.desc')}
            />
         </div>
      </div>

      {/* Footer */}
      <div className="py-6 text-center text-sm text-muted-foreground border-t border-border bg-muted/20">
        <p>&copy; {new Date().getFullYear()} FormForge AI. All rights reserved.</p>
      </div>
    </div>
  );
};

const FeatureCard = ({ icon, title, desc }: { icon: React.ReactNode, title: string, desc: string }) => (
    <div className="bg-card hover:bg-accent/50 transition-colors border border-border p-6 rounded-xl flex flex-col items-center text-center gap-3 group">
        <div className="p-3 bg-background rounded-full shadow-sm group-hover:scale-110 transition-transform duration-300 ring-1 ring-border">
            {icon}
        </div>
        <h3 className="font-semibold text-lg">{title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
    </div>
);

export default LandingPage;

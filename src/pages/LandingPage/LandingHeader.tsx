import { FileType } from "lucide-react";
import { LanguageToggle } from "@/components/toolbar/language-toggle";
import { ModeToggle } from "@/components/toolbar/mode-toggle";

type LandingHeaderProps = {
  rightSlot?: React.ReactNode;
};

export function LandingHeader({ rightSlot }: LandingHeaderProps) {
  return (
    <div className="border-border bg-card/50 fixed top-0 z-50 flex h-16 w-full items-center justify-between border-b px-6 backdrop-blur-sm">
      <div className="text-foreground flex items-center gap-2 text-xl font-bold">
        <div className="bg-primary text-primary-foreground rounded-md p-1.5">
          <FileType size={20} strokeWidth={2.5} />
        </div>
        <span>{process.env.APP_NAME}</span>
      </div>
      <div className="flex items-center gap-2">
        {rightSlot ?? (
          <>
            <LanguageToggle />
            <ModeToggle />
          </>
        )}
      </div>
    </div>
  );
}

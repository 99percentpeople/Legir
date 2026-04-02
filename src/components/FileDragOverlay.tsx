import { FileText } from "lucide-react";

interface FileDragOverlayProps {
  open: boolean;
}

const FileDragOverlay: React.FC<FileDragOverlayProps> = ({ open }) => {
  if (!open) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-50 bg-black/18 backdrop-blur-[2px]">
      <div className="border-primary/50 absolute inset-5 rounded-[28px] border-2 border-dashed" />
      <div className="absolute inset-0 flex items-center justify-center p-6">
        <div className="text-primary flex h-24 w-24 items-center justify-center rounded-full bg-white/60 shadow-lg dark:bg-white/8">
          <FileText size={48} strokeWidth={2.2} />
        </div>
      </div>
    </div>
  );
};

export default FileDragOverlay;

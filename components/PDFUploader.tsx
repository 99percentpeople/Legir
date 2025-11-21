
import React, { useCallback } from 'react';
import { Upload, FileText } from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { buttonVariants } from './ui/button';
import { cn } from '../lib/utils';
import { useLanguage } from './language-provider';

interface PDFUploaderProps {
  onUpload: (file: File) => void;
}

const PDFUploader: React.FC<PDFUploaderProps> = ({ onUpload }) => {
  const { t } = useLanguage();
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const files = e.dataTransfer.files;
      if (files.length > 0 && files[0].type === 'application/pdf') {
        onUpload(files[0]);
      }
    },
    [onUpload]
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onUpload(e.target.files[0]);
    }
  };

  return (
    <div 
      className="w-full"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
        <Card className="border-dashed border-2 border-muted-foreground/25 hover:border-primary/50 transition-colors bg-card/50 backdrop-blur-sm shadow-sm">
            <CardContent className="p-12 flex flex-col items-center text-center">
                <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6 text-primary animate-in zoom-in duration-500">
                    <FileText size={40} />
                </div>
                <h2 className="text-2xl font-bold text-foreground mb-2">{t('uploader.title')}</h2>
                <p className="text-muted-foreground mb-8 max-w-md">{t('uploader.desc')}</p>
                
                <label className={cn(buttonVariants({ size: "lg" }), "cursor-pointer shadow-lg hover:shadow-primary/25 transition-all")}>
                    <Upload size={20} className="mr-2" />
                    {t('uploader.btn')}
                    <input 
                    type="file" 
                    accept="application/pdf" 
                    className="hidden" 
                    onChange={handleFileInput}
                    />
                </label>
            </CardContent>
        </Card>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {t('uploader.note')}
        </p>
    </div>
  );
};

export default PDFUploader;

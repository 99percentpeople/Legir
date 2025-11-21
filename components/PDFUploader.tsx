import React, { useCallback } from 'react';
import { Upload, FileText } from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { buttonVariants } from './ui/button';
import { cn } from '../lib/utils';

interface PDFUploaderProps {
  onUpload: (file: File) => void;
}

const PDFUploader: React.FC<PDFUploaderProps> = ({ onUpload }) => {
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
      className="flex-1 flex items-center justify-center bg-muted/30 p-4 transition-colors duration-200"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <div className="max-w-xl w-full text-center">
        <Card className="border-dashed border-2 hover:border-primary/50 transition-colors">
            <CardContent className="p-12 flex flex-col items-center">
                <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6 text-primary">
                    <FileText size={40} />
                </div>
                <h2 className="text-2xl font-bold text-foreground mb-2">Upload your PDF Form</h2>
                <p className="text-muted-foreground mb-8">Drag and drop your file here, or click to browse</p>
                
                <label className={cn(buttonVariants({ size: "lg" }), "cursor-pointer")}>
                    <Upload size={20} className="mr-2" />
                    Select PDF File
                    <input 
                    type="file" 
                    accept="application/pdf" 
                    className="hidden" 
                    onChange={handleFileInput}
                    />
                </label>
            </CardContent>
        </Card>
        <p className="mt-6 text-sm text-muted-foreground">
          Your files are processed locally and securely.
        </p>
      </div>
    </div>
  );
};

export default PDFUploader;
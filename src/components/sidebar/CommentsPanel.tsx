import React, { useState } from 'react';
import { MessageSquare, Trash2, Calendar, Search } from 'lucide-react';
import { Annotation } from '../../types';
import { useLanguage } from '../language-provider';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

interface CommentsPanelProps {
  annotations: Annotation[];
  onSelectAnnotation: (id: string) => void;
  onDeleteAnnotation: (id: string) => void;
  onUpdateAnnotation: (id: string, updates: Partial<Annotation>) => void;
  selectedAnnotationId: string | null;
}

const CommentsPanel: React.FC<CommentsPanelProps> = ({
  annotations,
  onSelectAnnotation,
  onDeleteAnnotation,
  onUpdateAnnotation,
  selectedAnnotationId,
}) => {
  const { t, dayjsLocale } = useLanguage();
  const [searchTerm, setSearchTerm] = useState('');

  const notes = annotations.filter((a) => a.type === 'note');

  // Filter notes based on search term
  const filteredNotes = notes.filter(note => {
      if (!searchTerm) return true;
      return (note.text || '').toLowerCase().includes(searchTerm.toLowerCase());
  });

  // Group by page
  const groupedNotes = filteredNotes.reduce((acc, note) => {
    const page = note.pageIndex + 1;
    if (!acc[page]) acc[page] = [];
    acc[page].push(note);
    return acc;
  }, {} as Record<number, Annotation[]>);

  const sortedPages = Object.keys(groupedNotes)
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <MessageSquare size={16} />
          {t('sidebar.comments')} ({notes.length})
        </h3>
        
        <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground h-3.5 w-3.5" />
            <Input 
                type="text" 
                placeholder={t('sidebar.search_comments')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-8 pl-8 text-xs w-full bg-background"
            />
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <div className="p-4 space-y-6">
          {filteredNotes.length === 0 ? (
            <div className="text-center text-muted-foreground text-sm py-8">
               {searchTerm ? t('sidebar.no_results') : t('sidebar.no_comments')}
            </div>
          ) : (
            sortedPages.map((page) => (
              <div key={page} className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground sticky top-0 bg-background py-1 z-10">
                  Page {page}
                </div>
                <div className="space-y-3">
                  {groupedNotes[page].map((note) => (
                    <div
                      key={note.id}
                      className={`group relative border rounded-md p-3 transition-all ${
                        selectedAnnotationId === note.id
                          ? 'border-primary bg-primary/5 shadow-sm'
                          : 'border-border hover:border-primary/50'
                      }`}
                      onClick={() => onSelectAnnotation(note.id)}
                    >
                      <div className="flex justify-between items-start gap-2 mb-2">
                        <div className="flex items-center gap-1.5">
                          <div 
                            className="w-2 h-2 rounded-full" 
                            style={{ backgroundColor: note.color || '#ff0000' }}
                          />
                          <span className="text-xs font-medium">Note</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteAnnotation(note.id);
                          }}
                        >
                          <Trash2 size={12} className="text-destructive" />
                        </Button>
                      </div>
                      
                      <textarea
                        id={`comment-input-${note.id}`}
                        className="w-full bg-transparent text-sm resize-none outline-none min-h-[60px] text-foreground placeholder:text-muted-foreground/50"
                        value={note.text || ''}
                        placeholder="Add a comment..."
                        onChange={(e) =>
                          onUpdateAnnotation(note.id, { text: e.target.value })
                        }
                        onClick={(e) => e.stopPropagation()}
                      />
                      
                      <div className="mt-2 pt-2 border-t border-border/50 flex items-center justify-between text-[10px] text-muted-foreground">
                         <span className="flex items-center gap-1">
                            <Calendar size={10} />
                            {dayjs(new Date()).locale(dayjsLocale).format('MMM D, YYYY')}
                         </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default CommentsPanel;

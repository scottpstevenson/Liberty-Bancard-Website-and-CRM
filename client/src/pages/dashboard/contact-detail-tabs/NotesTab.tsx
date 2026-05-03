import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Plus } from "lucide-react";
import type { Note } from "@shared/schema";
import { formatRelativeTime } from "./shared";

interface NotesTabProps {
  sortedNotes: Note[];
  noteContent: string;
  setNoteContent: (v: string) => void;
  addNote: () => void;
}

export function NotesTab({ sortedNotes, noteContent, setNoteContent, addNote }: NotesTabProps) {
  return (
    <>
      <Card className="mb-4">
        <CardContent className="pt-4 pb-4">
          <div className="space-y-2">
            <Textarea
              value={noteContent}
              onChange={e => setNoteContent(e.target.value)}
              placeholder="Write a note..."
              rows={3}
              data-testid="textarea-add-note"
            />
            <Button onClick={addNote} disabled={!noteContent.trim()} data-testid="button-submit-note">
              <Plus className="h-4 w-4 mr-1" /> Add Note
            </Button>
          </div>
        </CardContent>
      </Card>

      {sortedNotes.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">No notes yet</p>
      ) : (
        <div className="space-y-3">
          {sortedNotes.map(note => (
            <Card key={note.id} data-testid={`card-note-${note.id}`}>
              <CardContent className="py-4">
                <p className="text-sm whitespace-pre-wrap" data-testid={`text-note-content-${note.id}`}>
                  {note.content}
                </p>
                <div className="flex flex-wrap gap-2 mt-2 text-xs text-muted-foreground">
                  {note.authorName && (
                    <span data-testid={`text-note-author-${note.id}`}>{note.authorName}</span>
                  )}
                  <span data-testid={`text-note-time-${note.id}`}>
                    {formatRelativeTime(note.createdAt!)}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
